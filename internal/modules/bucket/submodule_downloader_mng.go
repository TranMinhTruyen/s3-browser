package bucket

import (
	"S3Browser/internal/modules/global"
	"S3Browser/internal/pkg/cnst"
	"S3Browser/internal/pkg/utils"
	"S3Browser/models"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"github.com/aws/aws-sdk-go-v2/feature/s3/transfermanager"
	"github.com/wailsapp/wails/v3/pkg/application"
	"golang.org/x/sync/errgroup"
)

// submoduleDownloaderMng downloads objects. Every object in flight is a cancelable job
// (jobs); dests holds the paths running downloads write to, guarded by destsMu, so two
// objects with the same base name never write to the same file.
type submoduleDownloaderMng struct {
	logger                      *slog.Logger
	app                         *application.App
	global                      *global.Module
	submoduleDownloadHistoryMng *submoduleDownloadHistoryMng
	jobs                        sync.Map
	destsMu                     sync.Mutex
	dests                       map[string]struct{}
}

// newSubmoduleDownloaderMng wires the downloader to the app, connections and history.
func newSubmoduleDownloaderMng(
	app *application.App,
	logger *slog.Logger,
	global *global.Module,
	submoduleDownloadHistoryMng *submoduleDownloadHistoryMng,
) *submoduleDownloaderMng {
	return &submoduleDownloaderMng{
		logger:                      logger.With("submodules", "downloader_mng"),
		app:                         app,
		global:                      global,
		submoduleDownloadHistoryMng: submoduleDownloadHistoryMng,
		dests:                       make(map[string]struct{}),
	}
}

// downloaderJob is a running single-object download that can be canceled.
type downloaderJob struct {
	cancel context.CancelFunc
}

// downloadResult is the outcome of one object, turned into a message after all finish.
type downloadResult struct {
	key  string
	dest string
	err  error
	// history is the final history record to save; nil if the record couldn't be created.
	history *models.DownloadHistoryItem
}

// downloadConcurrency limits both the objects downloaded at once and the parts fetched at once per object.
// So up to downloadConcurrency^2 (36) connections can be open. Not lowered: no measurement shows a gain,
// and fewer connections would slow a few large objects.
const downloadConcurrency = 6

// downloadObject asks the user where to save, then downloads every object in input.Objects.
//   - One object: a "Save file" dialog is shown and the object is written to the chosen path.
//   - Several objects: a folder picker is shown and each object is written into that folder
//     under its base name.
//
// It blocks until all downloads finish and returns one message per object
// (success, canceled or error). If the user closes the dialog, it returns an empty output.
func (m *submoduleDownloaderMng) downloadObject(input models.DownloadObjInput) models.Output[any] {
	output := models.NewOutput[any]()

	// Counts this call as a running transfer, so the profile can't be deleted meanwhile.
	// All downloads finish inside this call (g.Wait below), so the release goes here.
	s3Conn, releaseConn, ok := m.global.AcquireConn(input.ConnectionId)

	if !ok {
		m.logger.Error("get connection profile failed")
		return output.ThrowError(notConnectedMessage(input.ProfileName))
	}
	defer releaseConn()

	if len(input.Objects) == 0 {
		return output
	}

	var (
		destDir string
		err     error
	)

	// Several objects -> choose a folder; a single object -> choose the file path.
	if len(input.Objects) > 1 {
		destDir, err = m.app.Dialog.OpenFile().
			CanChooseDirectories(true).
			CanChooseFiles(false).
			CanCreateDirectories(true).
			PromptForSingleSelection()
	} else {
		destDir, err = m.app.Dialog.SaveFile().SetFilename(path.Base(input.Objects[0])).PromptForSingleSelection()
	}

	if err != nil {
		m.logger.Error("get destination path error", slog.Any("detail", err.Error()))
		return output.ThrowError(models.NewParamsMessage(cnst.MessageTypeError, cnst.Bucket, S3E009, err.Error(),
			map[string]any{"path": destDir}))
	}

	// Empty path means the user canceled the dialog.
	if destDir == "" {
		m.logger.Warn("no destination path select")
		return output
	}

	tm := transfermanager.New(s3Conn.Client, func(o *transfermanager.Options) {
		o.Concurrency = downloadConcurrency
	})

	// Buffered so goroutines never block on send; results are read only after g.Wait().
	// Downloads use the app context, not a call context: the call blocks behind a native
	// dialog, and each file is canceled through its own job or through cancelAllDownloads.
	results := make(chan downloadResult, len(input.Objects))
	// A plain errgroup.Group (no shared context): one failed object must not cancel the others.
	var g errgroup.Group
	g.SetLimit(downloadConcurrency)
	// A single object goes to the exact path the user chose (the dialog already asked
	// about overwriting); objects saved into a folder must not replace files already there.
	multi := len(input.Objects) > 1
	for _, key := range input.Objects {
		dest := destDir
		if multi {
			dest = filepath.Join(destDir, path.Base(key))
		}
		// The same ID is used for the job, the history record, the progress events and,
		// on a name clash, the file name.
		id := utils.GenerateUUID()
		// Reserve the name now, in order, so objects with the same base name don't clash.
		dest, release := m.reserveDest(dest, id, multi)

		// Always return nil: errors are reported per object through results.
		g.Go(func() error {
			defer release()
			r := m.downloadOne(m.app.Context(), id, tm, input.Bucket, key, dest)
			r.dest = dest
			if r.history != nil {
				m.finishHistory(&r)
			}
			results <- r
			return nil
		})
	}
	_ = g.Wait()
	close(results)

	// Turn each result into a message for the frontend.
	for r := range results {
		switch {
		case r.err == nil:
			m.logger.Info(fmt.Sprintf("Download file %s success, destination %s", r.key, r.dest))
			output.AddMessage(
				models.NewParamsMessage(cnst.MessageTypeSuccess, cnst.Bucket, S3S004, "", map[string]any{
					"object": r.key,
					"dest":   r.dest,
				}),
			)
		case errors.Is(r.err, context.Canceled):
			m.logger.Warn(fmt.Sprintf("Download object: %s is canceled", r.key))
			output.AddMessage(
				models.NewParamsMessage(cnst.MessageTypeWarn, cnst.Bucket, S3W002, "", map[string]any{
					"object": r.key,
				}),
			)
		default:
			m.logger.Error(fmt.Sprintf("Download object: %s error", r.key))
			output.AddMessage(
				models.NewParamsMessage(cnst.MessageTypeError, cnst.Bucket, S3E012, r.err.Error(), map[string]any{
					"object": r.key,
				}),
			)
		}
	}
	return output
}

// cancelDownloadOne cancels the running download with the given ID.
// Unknown or already finished IDs are ignored.
func (m *submoduleDownloaderMng) cancelDownloadOne(id string) models.Output[any] {
	if v, ok := m.jobs.LoadAndDelete(id); ok {
		v.(downloaderJob).cancel()
		m.logger.Info(fmt.Sprintf("download %s is canceled", id))
	}
	return models.NewOutput[any]()
}

// cancelAllDownloads cancels every running download.
func (m *submoduleDownloaderMng) cancelAllDownloads() models.Output[any] {
	m.jobs.Range(func(k, v any) bool {
		v.(downloaderJob).cancel()
		m.logger.Info(fmt.Sprintf("download %s is canceled", k))
		return true
	})
	m.logger.Info("all downloads is canceled")
	return models.NewOutput[any]()
}

// reserveDest returns a path for a new download based on dest and marks it as in use
// until release is called. If dest is taken it becomes "name(<id>).ext"; id is the job's
// unique ID, so that path is never taken. A path is taken when a running download writes
// to it or, if avoidExisting is set, when a file (or its .part) already exists on disk.
func (m *submoduleDownloaderMng) reserveDest(dest, id string, avoidExisting bool) (string, func()) {
	m.destsMu.Lock()
	defer m.destsMu.Unlock()

	candidate := dest
	if m.destTaken(candidate, avoidExisting) {
		candidate = suffixedPath(dest, id)
	}
	k := destKey(candidate)
	m.dests[k] = struct{}{}

	return candidate, func() {
		m.destsMu.Lock()
		delete(m.dests, k)
		m.destsMu.Unlock()
	}
}

// destKey is the key of p in dests. Windows file names are case-insensitive, so
// "Report.pdf" and "report.pdf" must count as the same file there.
func destKey(p string) string {
	if runtime.GOOS == "windows" {
		return strings.ToLower(p)
	}
	return p
}

// destTaken reports whether p cannot be used. The caller must hold destsMu.
// The dests check and the reservation must be one step under the lock. The disk check (Lstat, cheap,
// only for multi download) sits here too for simplicity; the lock only contends with release.
func (m *submoduleDownloaderMng) destTaken(p string, checkDisk bool) bool {
	if _, ok := m.dests[destKey(p)]; ok {
		return true
	}
	if !checkDisk {
		return false
	}
	return pathExists(p) || pathExists(p+".part")
}

// pathExists reports whether p exists, without following a symlink.
func pathExists(p string) bool {
	_, err := os.Lstat(p)
	return err == nil
}

// suffixedPath turns "dir/report.pdf" into "dir/report(<suffix>).pdf".
// A dot file such as ".env" has no extension, so it becomes ".env(<suffix>)".
func suffixedPath(p, suffix string) string {
	dir, file := filepath.Split(p)
	ext := filepath.Ext(file)
	stem := strings.TrimSuffix(file, ext)
	if stem == "" {
		stem, ext = file, ""
	}
	return filepath.Join(dir, stem+"("+suffix+")"+ext)
}

// downloadOne downloads a single object to dest.
// It registers a cancelable job, creates a history record, emits progress events while
// downloading and returns the final status. It does not update the history record itself;
// the caller does that with finishHistory.
func (m *submoduleDownloaderMng) downloadOne(
	parent context.Context,
	id string,
	tm *transfermanager.Client,
	bucket, key, dest string,
) downloadResult {
	ctx, cancel := context.WithCancel(parent)

	// Register the job so it can be canceled; remove it when the download ends.
	m.jobs.Store(id, downloaderJob{cancel: cancel})
	defer func() { cancel(); m.jobs.Delete(id) }()

	saved, err := m.submoduleDownloadHistoryMng.createDownloadHistory(models.DownloadHistoryItem{
		ID:       id,
		FileName: key,
		DestPath: dest,
	})

	if err != nil {
		m.logger.Error("create history error", slog.Any("detail", err.Error()))
		return downloadResult{key: key, err: fmt.Errorf("create history: %w", err)}
	}

	// Tell the frontend a new download has started.
	m.app.Event.Emit(EventLoadDownloadHistory, saved)

	size, err := download(ctx, tm, bucket, key, dest, func(done, total int64) {
		m.app.Event.Emit(
			EventDownloadObjectProgress,
			models.DownloadProgressOutput{DownloadId: id, Downloaded: done, Total: total},
		)
	})

	// Map the error to a history status. If the context was canceled, report
	// context.Canceled instead of whatever error the S3 call returned.
	status := DOWNLOADED
	if err != nil {
		status = DOWNLOAD_ERROR
		if ctx.Err() != nil {
			status = CANCELED
			err = context.Canceled
		}
	}

	// The destination is only recorded for a finished download.
	destPath := ""
	if err == nil {
		destPath = saved.DestPath
	}

	return downloadResult{
		key: key,
		err: err,
		history: &models.DownloadHistoryItem{
			ID:       id,
			DestPath: destPath,
			Status:   status,
			Size:     float64(size),
			Version:  saved.Version,
		},
	}
}

// finishHistory writes the final status from r.history to the history record and
// notifies the frontend. If the update fails, the error replaces r.err.
func (m *submoduleDownloaderMng) finishHistory(r *downloadResult) {
	updated, err := m.submoduleDownloadHistoryMng.updateDownloadHistory(*r.history)

	if err != nil {
		r.err = err
		return
	}

	m.app.Event.Emit(EventLoadDownloadHistory, updated)
}
