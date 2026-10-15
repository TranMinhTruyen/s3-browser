package bucket

import (
	"S3Browser/internal/modules/global"
	"S3Browser/internal/pkg/cnst"
	"S3Browser/internal/pkg/db/sqlc"
	"S3Browser/internal/pkg/utils"
	"S3Browser/models"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awshttp "github.com/aws/aws-sdk-go-v2/aws/transport/http"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/wailsapp/wails/v3/pkg/application"
	"golang.org/x/sync/errgroup"
)

type submoduleDownloaderMng struct {
	logger                      *slog.Logger
	app                         *application.App
	global                      *global.Module
	submoduleDownloadHistoryMng *submoduleDownloadHistoryMng
	jobs                        sync.Map
	destsMu                     sync.Mutex
	dests                       map[string]struct{}
}

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

type job struct {
	connID string
	cancel context.CancelFunc
}

type downloadResult struct {
	key    string
	dest   string
	err    error
	update *sqlc.UpdateStatusDownloadHistoryByIdParams
}

const (
	chunkSize   = 64 << 20
	concurrency = 6
)

// downloadObject asks the user where to save, then downloads every object in input.Objects.
//   - One object: a "Save file" dialog is shown and the object is written to the chosen path.
//   - Several objects: a folder picker is shown and each object is written into that folder
//     under its base name.
//
// It blocks until all downloads finish and returns one message per object
// (success, canceled or error). If the user closes the dialog, it returns an empty output.
func (m *submoduleDownloaderMng) downloadObject(input models.DownloadObjInput) models.Output[any] {
	output := models.NewOutput[any]()

	s3Conn, ok := m.global.GetConnContainer(input.ConnectionId)

	if ok == false {
		m.logger.Error("get connection profile failed")
		return output.ThrowError(
			models.NewParamsMessage(cnst.MessageTypeError, cnst.Bucket, S3E006, "", map[string]any{
				"name": input.ProfileName,
			}),
		)
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

	// Buffered so goroutines never block on send; results are read only after g.Wait().
	results := make(chan downloadResult, len(input.Objects))
	// A plain errgroup.Group (no shared context): one failed object must not cancel the others.
	var g errgroup.Group
	g.SetLimit(concurrency)
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
			r := m.downloadOne(m.app.Context(), id, input.ConnectionId, s3Conn.Client, input.Bucket, key, dest)
			r.dest = dest
			if r.update != nil {
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
				models.NewParamsMessage(cnst.MessageTypeError, cnst.Bucket, S3W002, "", map[string]any{
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
		v.(job).cancel()
	}
	m.logger.Info(fmt.Sprintf("download %s is canceled", id))
	return models.NewOutput[any]()
}

// cancelAllDownloads cancels every running download.
func (m *submoduleDownloaderMng) cancelAllDownloads() models.Output[any] {
	m.jobs.Range(func(k, v any) bool {
		v.(job).cancel()
		m.logger.Info(fmt.Sprintf("download %s is canceled", k))
		return true
	})
	m.logger.Info(fmt.Sprintf("all downloads is canceled"))
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
func (m *submoduleDownloaderMng) destTaken(p string, checkDisk bool) bool {
	if _, ok := m.dests[destKey(p)]; ok {
		return true
	}
	if !checkDisk {
		return false
	}
	return pathExists(p) || pathExists(p+".part")
}

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
	id, connID string,
	c *s3.Client,
	bucket, key, dest string,
) downloadResult {
	ctx, cancel := context.WithCancel(parent)

	// Register the job so it can be canceled; remove it when the download ends.
	m.jobs.Store(id, job{connID: connID, cancel: cancel})
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

	err = download(ctx, c, bucket, key, dest, func(done, total int64) {
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

	return downloadResult{
		key: key,
		err: err,
		update: &sqlc.UpdateStatusDownloadHistoryByIdParams{
			ID:      id,
			Status:  status,
			Version: saved.Version,
		},
	}
}

// finishHistory writes the final status from r.update to the history record and
// notifies the frontend. If the update fails, the error replaces r.err.
func (m *submoduleDownloaderMng) finishHistory(r *downloadResult) {
	updated, err := m.submoduleDownloadHistoryMng.updateDownloadHistory(models.DownloadHistoryItem{
		ID:      r.update.ID,
		Status:  r.update.Status,
		Version: r.update.Version,
	})

	if err != nil {
		r.err = err
		return
	}

	m.app.Event.Emit(EventLoadDownloadHistory, updated)
}

// download saves the object to dest by fetching it in parallel byte ranges of chunkSize.
// progress is called periodically with the bytes received so far and the total size.
// On failure or cancellation, no file is left at dest.
func download(ctx context.Context, c *s3.Client, bucket, key, dest string, progress func(done, total int64)) error {
	if progress == nil {
		progress = func(int64, int64) {} // allow callers that don't track progress
	}

	// Step 1: get size and ETag without downloading the content.
	head, err := c.HeadObject(ctx, &s3.HeadObjectInput{Bucket: &bucket, Key: &key})
	if err != nil {
		return err
	}
	size, etag := aws.ToInt64(head.ContentLength), aws.ToString(head.ETag)

	// Step 2: write to a temporary file so dest never ends up incomplete.
	part := dest + ".part"
	f, err := os.Create(part)
	if err != nil {
		return err
	}
	defer func() {
		// if already closed at the end of the function, this just returns an ignored error
		f.Close()
		if err != nil {
			// failed or canceled: delete the temporary file
			os.Remove(part)
		}
	}()

	// Pre-size the file so each part can write at any offset.
	if err = f.Truncate(size); err != nil {
		return err
	}

	// downloaded is the total number of bytes received across all parts.
	// It is atomic because several goroutines add to it and read it concurrently.
	var downloaded atomic.Int64
	stop := reportEvery(200*time.Millisecond, func() {
		progress(downloaded.Load(), size)
	})
	defer stop()

	// Step 3: download in parallel.
	// errgroup runs at most `concurrency` parts at once. If one part fails,
	// gctx is canceled so the remaining parts stop, and g.Wait() returns the first error.
	g, gctx := errgroup.WithContext(ctx)
	g.SetLimit(concurrency)
	for start := int64(0); start < size; start += chunkSize {
		end := min(start+chunkSize, size) - 1
		g.Go(func() error {
			return fetchChunk(gctx, c, bucket, key, etag, f, start, end, &downloaded)
		})
	}
	if err = g.Wait(); err != nil {
		return err
	}

	// Step 4: the file must be closed before renaming (Windows can't rename an open file).
	if err = f.Close(); err != nil {
		return err
	}
	return os.Rename(part, dest)
}

// fetchChunk downloads the byte range [start, end] of the object and writes it into f at offset start.
func fetchChunk(
	ctx context.Context,
	c *s3.Client,
	bucket, key, etag string,
	f *os.File,
	start, end int64,
	downloaded *atomic.Int64,
) error {
	in := &s3.GetObjectInput{Bucket: &bucket, Key: &key, Range: aws.String(fmt.Sprintf("bytes=%d-%d", start, end))}
	if etag != "" {
		// Only return data if the object is still the same version as when the download started.
		// If it was overwritten, S3 responds with 412 instead of sending new data,
		// so we never produce a file that mixes old and new content.
		in.IfMatch = &etag
	}

	out, err := c.GetObject(ctx, in)
	if err != nil {
		if httpStatus(err) == http.StatusPreconditionFailed {
			return errors.New("object has changed on server during download")
		}
		return fmt.Errorf("get bytes %d-%d: %w", start, end, err)
	}
	defer out.Body.Close()

	// Every block of data read from S3 is written to two places at once:
	//   - NewOffsetWriter: into the file, starting at offset start
	//   - counter: adds the byte count to downloaded for progress reporting
	n, err := io.Copy(io.MultiWriter(io.NewOffsetWriter(f, start), counter{downloaded}), out.Body)

	if err == nil && n != end-start+1 {
		err = io.ErrUnexpectedEOF // connection closed early, fewer bytes than expected
	}

	if err != nil {
		return fmt.Errorf("read bytes %d-%d: %w", start, end, err)
	}

	return nil
}

// counter is an io.Writer that doesn't store data anywhere;
// it only adds the number of received bytes to n (used for progress).
type counter struct{ n *atomic.Int64 }

func (c counter) Write(p []byte) (int, error) {
	c.n.Add(int64(len(p)))
	return len(p), nil
}

// httpStatus returns the HTTP status code carried by an AWS SDK error.
// It returns 0 if the error didn't come from an HTTP response (e.g. network failure).
func httpStatus(err error) int {
	var re *awshttp.ResponseError
	if errors.As(err, &re) {
		return re.HTTPStatusCode()
	}
	return 0
}

// reportEvery calls fn every d in a separate goroutine.
//
// The returned stop() function:
//  1. stops the ticker,
//  2. calls fn one last time (so the UI shows the final value),
//  3. waits for the goroutine to exit, so fn is never called after stop() returns.
func reportEvery(d time.Duration, fn func()) (stop func()) {
	t := time.NewTicker(d)
	quit := make(chan struct{})

	go func() {
		defer t.Stop()
		for {
			select {
			case <-t.C:
				fn()
			case <-quit:
				return
			}
		}
	}()

	return func() {
		quit <- struct{}{}
		fn()
	}
}
