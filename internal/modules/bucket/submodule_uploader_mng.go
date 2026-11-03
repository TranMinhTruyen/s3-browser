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
	"path/filepath"
	"sync"
	"sync/atomic"

	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/wailsapp/wails/v3/pkg/application"
	"golang.org/x/sync/errgroup"
)

// submoduleUploaderMng uploads files. State is shared by all tabs: one uploadObject call at
// a time (busy), and every file in flight is a cancelable job (jobs) so the user can stop
// one file or the whole batch.
type submoduleUploaderMng struct {
	logger *slog.Logger
	app    *application.App
	global *global.Module
	// progress batches the progress of all running uploads into one event.
	progress *utils.BatchReporter[models.UploadProgressOutput]
	// jobs holds the cancelable files in flight.
	jobs jobRegistry
	// busy is set while an uploadObject call runs; only one runs at a time, across all tabs.
	busy atomic.Bool
	// batchCancel cancels the running uploadObject call, including its key check;
	// nil when no call runs.
	batchMu     sync.Mutex
	batchCancel context.CancelFunc
}

// newSubmoduleUploaderMng wires the uploader to the Wails app and the shared connections.
func newSubmoduleUploaderMng(
	app *application.App,
	logger *slog.Logger,
	globalModule *global.Module,
) *submoduleUploaderMng {
	return &submoduleUploaderMng{
		logger: logger.With("submodules", "uploader_mng"),
		app:    app,
		global: globalModule,
		progress: utils.NewBatchReporter(app.Context, func(items []models.UploadProgressOutput) {
			app.Event.Emit(EventUploadProgressBatch, models.UploadProgressBatchOutput{Items: items})
		}),
	}
}

// pickPaths opens the native dialog to choose files; empty paths means the user canceled.
func (m *submoduleUploaderMng) pickPaths() ([]string, error) {
	dialog := m.app.Dialog.OpenFile().CanChooseFiles(true).CanChooseDirectories(false)
	// The app has one window; attach to it so the dialog is modal (Current may be nil).
	if window := m.app.Window.Current(); window != nil {
		dialog.AttachToWindow(window)
	}
	return dialog.PromptForMultipleSelection()
}

const (
	// uploadFileConcurrency is the most files uploaded at the same time, across all groups.
	uploadFileConcurrency = 5
	// maxFilesPerFolder is the most files uploaded from one folder (group).
	maxFilesPerFolder = 50
	// largeFileMaxCount is the most large files uploaded from one folder (group).
	largeFileMaxCount = 4
	// maxTotalFiles is the most files one drop or one uploadObject call holds.
	maxTotalFiles = 1000
)

// largeFileSize is the size above which a file is "large" (10 GiB).
const largeFileSize int64 = 10 << 30

// uploadResult is the outcome of one file, turned into a message after all files finish.
type uploadResult struct {
	path string
	key  string
	err  error
}

// uploadObject uploads every item to bucket, uploadFileConcurrency files at a time.
// It blocks until all uploads finish and returns one message per item: success,
// canceled or error. A failed or canceled file doesn't stop the others.
// Only one call runs at a time; a call made while another runs is rejected.
//
// The limits are enforced here and not only in the frontend. The items are grouped by the
// folder of their RelKey, and the call is rejected if:
//   - a RelKey could leave the prefix;
//   - it holds more than maxTotalFiles items;
//   - a group holds more than maxFilesPerFolder items;
//   - a group holds more than largeFileMaxCount files over largeFileSize
//     (sizes are read from disk, not from the caller).
func (m *submoduleUploaderMng) uploadObject(input models.UploadObjInput) models.Output[any] {
	output := models.NewOutput[any]()

	if len(input.ObjList) == 0 {
		return output
	}
	if len(input.ObjList) > maxTotalFiles {
		return output.ThrowError(
			models.NewParamsMessage(cnst.MessageTypeError, cnst.Bucket, S3E023, "", map[string]any{
				"max": maxTotalFiles,
			}),
		)
	}
	items, badPath := cleanUploadItems(input.ObjList)
	if badPath != "" {
		m.logger.Error("invalid upload key", slog.String("path", badPath))
		return output.ThrowError(
			models.NewParamsMessage(cnst.MessageTypeError, cnst.Bucket, S3E019, "", map[string]any{
				"name": filepath.Base(badPath),
			}),
		)
	}
	groups, violation := groupUploadItems(items)
	if violation != nil {
		m.logger.Error("upload breaks a limit", slog.String("code", violation[0].MessageCode))
		return output.ThrowError(violation...)
	}
	if !m.busy.CompareAndSwap(false, true) {
		m.logger.Warn("another upload is running, skip")
		return output.ThrowError(
			models.NewParamsMessage(cnst.MessageTypeWarn, cnst.Bucket, S3W005, "", nil),
		)
	}
	defer m.busy.Store(false)

	// Counts this call as a running transfer, so the profile can't be deleted meanwhile.
	// All uploads finish inside this call (g.Wait below), so the release goes here.
	conn, releaseConn, ok := m.global.AcquireConn(input.ConnectionId)
	if !ok {
		m.logger.Error("get connection profile failed")
		return output.ThrowError(notConnectedMessage(input.ProfileName))
	}
	defer releaseConn()

	// Credentials that can't be renewed and run out soon may end the transfer midway: warn, but go on.
	output.AddMessage(transferExpiryWarning(conn, input.ProfileName)...)

	// One context for the whole call, so cancelAllUploads also stops the key check
	// below and the files that haven't started yet. It is not a Wails call context: this
	// call blocks while the user works, so it only ends on cancelAllUploads or app shutdown.
	ctx, cancel := context.WithCancel(m.app.Context())
	m.setBatchCancel(cancel)
	defer func() { m.setBatchCancel(nil); cancel() }()

	prefix := normalizePrefix(input.Prefix)
	// Find which keys (relative to prefix) are already used, before any upload starts,
	// so the keys can be picked below without a lock.
	used := existingKeys(ctx, conn.Client, input.Bucket, prefix, items)

	// Pick the ID and key of every item first, in order, so no lock is needed.
	ids := make([]string, len(items))
	for i := range items {
		// The same ID is used for the job, the progress events and a renamed key.
		ids[i] = utils.GenerateUUID()
		items[i].Key = prefix + items[i].RelKey
		if _, taken := used[items[i].RelKey]; taken {
			items[i].Key = prefix + renameKey(items[i].RelKey, ids[i])
		}
		used[items[i].RelKey] = struct{}{}
	}

	// Each goroutine writes only its own index, so no lock is needed. Results are read
	// after g.Wait(), which waits for every group (and each group waits for its files).
	results := make([]uploadResult, len(items))
	// One goroutine per group hands its files out, but all groups share one semaphore, so at
	// most uploadFileConcurrency files upload at a time. A plain errgroup.Group (no shared
	// context): one failed file must not cancel the others.
	sem := make(chan struct{}, uploadFileConcurrency)
	var g errgroup.Group
	for _, indexes := range groups {
		g.Go(func() error {
			var wg sync.WaitGroup
			defer wg.Wait()
			for _, i := range indexes {
				select {
				case sem <- struct{}{}:
				case <-ctx.Done():
					// Canceled while waiting: uploadOne reports it without uploading.
					results[i] = m.uploadOne(ctx, ids[i], conn.Client, input.Bucket, items[i])
					continue
				}
				wg.Add(1)
				go func() {
					defer func() { <-sem; wg.Done() }()
					results[i] = m.uploadOne(ctx, ids[i], conn.Client, input.Bucket, items[i])
				}()
			}
			return nil
		})
	}
	_ = g.Wait()

	// Turn each result into a message for the frontend.
	for _, r := range results {
		name := filepath.Base(r.path)
		switch {
		case r.err == nil:
			m.logger.Info(fmt.Sprintf("upload file %s success, key %s", r.path, r.key))
			output.AddMessage(
				models.NewParamsMessage(cnst.MessageTypeSuccess, cnst.Bucket, S3S006, "", map[string]any{
					"name": name,
					"key":  r.key,
				}),
			)
		case errors.Is(r.err, context.Canceled):
			m.logger.Warn(fmt.Sprintf("upload file %s is canceled", r.path))
			output.AddMessage(
				models.NewParamsMessage(cnst.MessageTypeWarn, cnst.Bucket, S3W004, "", map[string]any{
					"name": name,
				}),
			)
		case isCredentialsExpired(r.err):
			m.logger.Error(fmt.Sprintf("upload file %s: credentials expired", r.path))
			output.AddMessage(expiredMessage(input.ProfileName, r.err))
		default:
			m.logger.Error(fmt.Sprintf("upload file %s error", r.path), slog.Any("detail", r.err.Error()))
			output.AddMessage(
				models.NewParamsMessage(cnst.MessageTypeError, cnst.Bucket, S3E017, r.err.Error(), map[string]any{
					"name": name,
				}),
			)
		}
	}

	return output
}

// uploadOne uploads a single file. It registers a cancelable job (so cancelUploadOne can
// stop just this file) and emits progress events while uploading. The job is removed and
// its context released on return, so nothing leaks. If the job was canceled, the result's error
// is context.Canceled.
func (m *submoduleUploaderMng) uploadOne(
	parent context.Context,
	id string,
	client *s3.Client,
	bucket string,
	item models.UploadObj,
) uploadResult {
	// Register the job so it can be canceled; remove it when the upload ends.
	ctx, done := m.jobs.start(parent, id)
	defer done()

	// This stats the file again (groupUploadItems did it too): one cheap call per file, and
	// keeping it here avoids passing sizes around. The size is for the UI only (uploadFile reads it
	// again from the open file); a stat error is not fatal here because uploadFile reports it.
	var total int64
	if info, statErr := os.Stat(item.Path); statErr == nil {
		total = info.Size()
	}
	m.app.Event.Emit(EventUploadObjectStarted, models.UploadStartedOutput{
		UploadId: id,
		FileName: filepath.Base(item.Path),
		Key:      item.Key,
		Bucket:   bucket,
		Total:    total,
	})

	// A batch canceled before this file started (e.g. during the key check) sends nothing.
	err := ctx.Err()
	if err == nil {
		_, err = uploadFile(ctx, client, bucket, item.Key, item.Path, id, m.progress)
	}

	// If the context was canceled, report context.Canceled instead of whatever error
	// the S3 call returned.
	if err != nil && ctx.Err() != nil {
		err = context.Canceled
	}

	status := models.UploadStatusSuccess
	switch {
	case errors.Is(err, context.Canceled):
		status = models.UploadStatusCanceled
	case err != nil:
		status = models.UploadStatusError
	}
	m.app.Event.Emit(EventUploadObjectFinished, models.UploadFinishedOutput{UploadId: id, Status: status})

	return uploadResult{path: item.Path, key: item.Key, err: err}
}

// cancelUploadOne cancels the running upload with the given ID.
// Unknown or already finished IDs are ignored.
func (m *submoduleUploaderMng) cancelUploadOne(id string) models.Output[any] {
	if m.jobs.cancel(id) {
		m.logger.Info(fmt.Sprintf("upload %s is canceled", id))
	}
	return models.NewOutput[any]()
}

// setBatchCancel stores the cancel func of the running uploadObject call (nil when it ends).
func (m *submoduleUploaderMng) setBatchCancel(cancel context.CancelFunc) {
	m.batchMu.Lock()
	m.batchCancel = cancel
	m.batchMu.Unlock()
}

// cancelAllUploads cancels every running upload, and the running uploadObject call
// (its key check and the files not started yet).
func (m *submoduleUploaderMng) cancelAllUploads() models.Output[any] {
	m.batchMu.Lock()
	if m.batchCancel != nil {
		m.batchCancel()
	}
	m.batchMu.Unlock()
	m.jobs.cancelAll(func(id string) { m.logger.Info(fmt.Sprintf("upload %s is canceled", id)) })
	m.logger.Info("all uploads is canceled")
	return models.NewOutput[any]()
}
