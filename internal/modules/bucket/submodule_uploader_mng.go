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
	"strings"
	"sync"
	"sync/atomic"

	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/wailsapp/wails/v3/pkg/application"
	"golang.org/x/sync/errgroup"
)

// uploadHost is what the uploader needs from the application: a context that ends when
// the app shuts down, and a way to send events to the frontend. Tests replace it.
type uploadHost interface {
	Context() context.Context
	Emit(name string, data ...any)
}

// appHost is the uploadHost backed by the Wails application.
type appHost struct{ app *application.App }

func (h appHost) Context() context.Context { return h.app.Context() }

func (h appHost) Emit(name string, data ...any) { h.app.Event.Emit(name, data...) }

type submoduleUploaderMng struct {
	logger *slog.Logger
	host   uploadHost
	// getClient returns the S3 client of a connection; ok is false if it isn't connected.
	getClient func(connID string) (client s3Uploader, ok bool)
	jobs      sync.Map
	// busy is set while an uploadObject call runs; only one runs at a time, across all tabs.
	busy atomic.Bool
	// batchCancel cancels the running uploadObject call, including its key check;
	// nil when no call runs.
	batchMu     sync.Mutex
	batchCancel context.CancelFunc
}

func newSubmoduleUploaderMng(
	app *application.App,
	logger *slog.Logger,
	global *global.Module,
) *submoduleUploaderMng {
	return &submoduleUploaderMng{
		logger: logger.With("submodules", "uploader_mng"),
		host:   appHost{app: app},
		getClient: func(connID string) (s3Uploader, bool) {
			conn, ok := global.GetConnContainer(connID)
			if !ok {
				return nil, false
			}
			return conn.Client, true
		},
	}
}

type uploaderJob struct {
	connID string
	cancel context.CancelFunc
}

const (
	uploadFileConcurrency = 5
	// maxUploadFiles is the most files one uploadObject call accepts, and the most files
	// a drop keeps. The frontend asks the user before trimming a larger drop to this many.
	maxUploadFiles = 5
	// largeFileSize is the size above which a file is "large" (5 GiB). If an upload holds
	// a large file, only the largest file of the upload is sent.
	largeFileSize int64 = 5 << 30
)

type uploadResult struct {
	id   string
	path string
	key  string
	size int64
	err  error
}

// uploadObject uploads every item to bucket, uploadFileConcurrency files at a time.
// It blocks until all uploads finish and returns one message per item: success,
// canceled or error. A failed or canceled file doesn't stop the others.
// Only one call runs at a time; a call made while another runs is rejected.
//
// The size and key rules are enforced here and not only in the frontend:
//   - more than maxUploadFiles items is rejected;
//   - a RelKey that could leave the prefix is rejected;
//   - if any item is larger than largeFileSize, only the largest item is uploaded
//     (sizes are read from disk, not from the caller) and a warning is added.
func (m *submoduleUploaderMng) uploadObject(input models.UploadObjInput) models.Output[any] {
	output := models.NewOutput[any]()

	if len(input.ObjList) == 0 {
		return output
	}
	if len(input.ObjList) > maxUploadFiles {
		return output.ThrowError(
			models.NewParamsMessage(cnst.MessageTypeError, cnst.Bucket, S3E018, "", map[string]any{
				"max": maxUploadFiles,
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
	if !m.busy.CompareAndSwap(false, true) {
		m.logger.Warn("another upload is running, skip")
		return output.ThrowError(
			models.NewParamsMessage(cnst.MessageTypeWarn, cnst.Bucket, S3W005, "", nil),
		)
	}
	defer m.busy.Store(false)

	if largest, limited := limitToLargest(items); limited {
		m.logger.Warn("upload holds a file over the size limit, upload the largest only",
			slog.String("path", largest.Path))
		// Warn only if other files are really dropped by this rule.
		if len(items) > 1 {
			output.AddMessage(
				models.NewParamsMessage(cnst.MessageTypeWarn, cnst.Bucket, S3W007, "", map[string]any{
					"name": filepath.Base(largest.Path),
				}),
			)
		}
		items = []models.UploadObj{largest}
	}

	client, ok := m.getClient(input.ConnectionId)
	if !ok {
		m.logger.Error("get connection profile failed")
		return output.ThrowError(
			models.NewParamsMessage(cnst.MessageTypeError, cnst.Bucket, S3E006, "", map[string]any{
				"name": input.ProfileName,
			}),
		)
	}

	// One context for the whole call, so cancelAllUploads also stops the key check
	// below and the files that haven't started yet.
	ctx, cancel := context.WithCancel(m.host.Context())
	m.setBatchCancel(cancel)
	defer func() { m.setBatchCancel(nil); cancel() }()

	prefix := normalizePrefix(input.Prefix)
	// Find which keys (relative to prefix) are already used, before any upload starts,
	// so the keys can be picked below without a lock.
	used := existingKeys(ctx, client, input.Bucket, prefix, items)

	// Each goroutine writes only its own index, so no lock is needed.
	results := make([]uploadResult, len(items))
	// A plain errgroup.Group (no shared context): one failed file must not cancel the others.
	var g errgroup.Group
	g.SetLimit(uploadFileConcurrency)
	for i, item := range items {
		// The same ID is used for the job, the progress events and a renamed key.
		id := utils.GenerateUUID()
		item.Key = prefix + item.RelKey
		if _, taken := used[item.RelKey]; taken {
			item.Key = prefix + renameKey(item.RelKey, id)
		}
		used[item.RelKey] = struct{}{}

		// Always return nil: errors are reported per file through results.
		g.Go(func() error {
			results[i] = m.uploadOne(ctx, id, input.ConnectionId, client, input.Bucket, item)
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

// cleanUploadItems returns a copy of items with a safe RelKey set on each. If a RelKey
// is not safe it returns the path of that item as badPath.
func cleanUploadItems(items []models.UploadObj) (clean []models.UploadObj, badPath string) {
	clean = make([]models.UploadObj, len(items))
	for i, item := range items {
		rel, ok := cleanRelKey(item.RelKey, item.Path)
		if !ok {
			return nil, item.Path
		}
		item.RelKey = rel
		clean[i] = item
	}
	return clean, ""
}

// limitToLargest implements the large file rule: if any item is bigger than largeFileSize
// it returns limited = true and the biggest item (the first one on a tie); otherwise
// limited = false. Sizes are read from disk; an item that can't be read counts as 0.
func limitToLargest(items []models.UploadObj) (largest models.UploadObj, limited bool) {
	var maxSize int64 = -1
	for _, item := range items {
		var size int64
		if info, err := os.Stat(item.Path); err == nil {
			size = info.Size()
		}
		if size > maxSize {
			maxSize = size
			largest = item
		}
	}
	return largest, maxSize > largeFileSize
}

// renameKey puts id in front of the file name of relKey, keeping its folders:
// "a/b/c.txt" -> "a/b/<id>_c.txt".
func renameKey(relKey, id string) string {
	dir, name := "", relKey
	if i := strings.LastIndex(relKey, "/"); i >= 0 {
		dir, name = relKey[:i+1], relKey[i+1:]
	}
	return dir + id + "_" + name
}

// dropContext is the part of the Wails window event context used for a drop.
type dropContext interface {
	DropTargetDetails() *application.DropTargetDetails
	DroppedFiles() []string
}

// handleFilesDropped forwards files dropped on an object list to the frontend.
// The drop target carries the tab ID in data-tab-id; drops elsewhere are ignored.
func (m *submoduleUploaderMng) handleFilesDropped(event *application.WindowEvent) {
	// The context is nil for an event that didn't come from a real drop.
	if ctx := event.Context(); ctx != nil {
		m.handleDrop(ctx)
	}
}

// handleDrop reads the drop target and the dropped paths from ctx and forwards them.
func (m *submoduleUploaderMng) handleDrop(ctx dropContext) {
	target := ctx.DropTargetDetails()
	if target == nil {
		return
	}
	m.dropFiles(target.Attributes["data-tab-id"], ctx.DroppedFiles())
}

// dropFiles expands the dropped paths (folders included) into at most maxUploadFiles
// files and sends them to the frontend. An empty tabID (a drop outside a tab) is ignored.
func (m *submoduleUploaderMng) dropFiles(tabID string, dropped []string) {
	if tabID == "" {
		return
	}
	files, truncated, skipped := expandDropped(dropped, maxUploadFiles)
	m.host.Emit(EventFilesDropped, models.FilesDroppedOutput{
		TabId:         tabID,
		Files:         files,
		Truncated:     truncated,
		Skipped:       skipped,
		MaxFiles:      maxUploadFiles,
		LargeFileSize: largeFileSize,
	})
}

// uploadOne uploads a single file. It registers a cancelable job and emits progress
// events while uploading. If the job was canceled, the result's error is context.Canceled.
func (m *submoduleUploaderMng) uploadOne(
	parent context.Context,
	id, connID string,
	client s3Uploader,
	bucket string,
	item models.UploadObj,
) uploadResult {
	ctx, cancel := context.WithCancel(parent)

	// Register the job so it can be canceled; remove it when the upload ends.
	m.jobs.Store(id, uploaderJob{connID: connID, cancel: cancel})
	defer func() { cancel(); m.jobs.Delete(id) }()

	// The size is for the UI only (uploadFile reads it again from the open file); a stat
	// error is not fatal here because uploadFile reports it.
	var total int64
	if info, statErr := os.Stat(item.Path); statErr == nil {
		total = info.Size()
	}
	m.host.Emit(EventUploadObjectStarted, models.UploadStartedOutput{
		UploadId: id,
		FileName: filepath.Base(item.Path),
		Key:      item.Key,
		Bucket:   bucket,
		Total:    total,
	})

	// A batch canceled before this file started (e.g. during the key check) sends nothing.
	var size int64
	err := ctx.Err()
	if err == nil {
		size, err = uploadFile(ctx, client, bucket, item.Key, item.Path, func(done, total int64) {
			m.host.Emit(
				EventUploadObjectProgress,
				models.UploadProgressOutput{UploadId: id, Uploaded: done, Total: total},
			)
		})
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
	m.host.Emit(EventUploadObjectFinished, models.UploadFinishedOutput{UploadId: id, Status: status})

	return uploadResult{id: id, path: item.Path, key: item.Key, size: size, err: err}
}

// cancelUploadOne cancels the running upload with the given ID.
// Unknown or already finished IDs are ignored.
func (m *submoduleUploaderMng) cancelUploadOne(id string) models.Output[any] {
	if v, ok := m.jobs.LoadAndDelete(id); ok {
		v.(uploaderJob).cancel()
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
	m.jobs.Range(func(k, v any) bool {
		v.(uploaderJob).cancel()
		m.logger.Info(fmt.Sprintf("upload %s is canceled", k))
		return true
	})
	m.logger.Info("all uploads is canceled")
	return models.NewOutput[any]()
}

// normalizePrefix turns p into the form used for keys: no leading "/", and a trailing
// "/" unless it is empty (the bucket root). Windows separators are converted to "/".
func normalizePrefix(p string) string {
	p = strings.TrimLeft(strings.ReplaceAll(p, `\`, "/"), "/")
	if p != "" && !strings.HasSuffix(p, "/") {
		p += "/"
	}
	return p
}

// existingKeys checks, uploadFileConcurrency at a time, whether an object with key
// prefix + RelKey already exists in bucket, for each item. Each distinct RelKey is
// checked once. It returns the RelKeys (without prefix) except those the bucket
// answered 404 for: a key that couldn't be checked is treated as existing, so its file
// gets a renamed key and nothing is overwritten.
func existingKeys(
	ctx context.Context,
	client s3Uploader,
	bucket, prefix string,
	items []models.UploadObj,
) map[string]struct{} {
	var names []string
	seen := make(map[string]struct{}, len(items))
	for _, item := range items {
		if _, ok := seen[item.RelKey]; !ok {
			seen[item.RelKey] = struct{}{}
			names = append(names, item.RelKey)
		}
	}

	// Each goroutine writes only its own index, so no lock is needed.
	errs := make([]error, len(names))
	var g errgroup.Group
	g.SetLimit(uploadFileConcurrency)
	for i, name := range names {
		g.Go(func() error {
			key := prefix + name
			_, errs[i] = client.HeadObject(ctx, &s3.HeadObjectInput{Bucket: &bucket, Key: &key})
			return nil
		})
	}
	_ = g.Wait()

	existing := make(map[string]struct{}, len(items))
	for i, name := range names {
		if errs[i] != nil && UnwrapAwsError(errs[i]) == "NotFound" {
			continue
		}
		existing[name] = struct{}{}
	}
	return existing
}
