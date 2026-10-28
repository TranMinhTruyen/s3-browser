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
	"slices"
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
	// getClient returns the S3 client of a connection and marks a transfer running on it
	// until release is called; ok is false if it isn't connected.
	getClient func(connID string) (client s3Uploader, release func(), ok bool)
	jobs      sync.Map
	// busy is set while an uploadObject call runs; only one runs at a time, across all tabs.
	busy atomic.Bool
	// batchCancel cancels the running uploadObject call, including its key check;
	// nil when no call runs.
	batchMu     sync.Mutex
	batchCancel context.CancelFunc
	// pickPaths opens the native dialog to choose files; empty paths means the user
	// canceled. A field (not a uploadHost method) so tests can replace it.
	pickPaths func() ([]string, error)
}

func newSubmoduleUploaderMng(
	app *application.App,
	logger *slog.Logger,
	global *global.Module,
) *submoduleUploaderMng {
	return &submoduleUploaderMng{
		logger: logger.With("submodules", "uploader_mng"),
		host:   appHost{app: app},
		getClient: func(connID string) (s3Uploader, func(), bool) {
			conn, release, ok := global.AcquireConn(connID)
			if !ok {
				return nil, nil, false
			}
			return conn.Client, release, true
		},
		pickPaths: func() ([]string, error) {
			dialog := app.Dialog.OpenFile().CanChooseFiles(true).CanChooseDirectories(false)
			// The app has one window; attach to it so the dialog is modal (Current may be nil).
			if window := app.Window.Current(); window != nil {
				dialog.AttachToWindow(window)
			}
			return dialog.PromptForMultipleSelection()
		},
	}
}

type uploaderJob struct {
	cancel context.CancelFunc
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

// largeFileSize is the size above which a file is "large" (10 GiB). It is a variable so
// tests can lower it instead of creating 10 GiB files.
var largeFileSize int64 = 10 << 30

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
	client, releaseConn, ok := m.getClient(input.ConnectionId)
	if !ok {
		m.logger.Error("get connection profile failed")
		return output.ThrowError(
			models.NewParamsMessage(cnst.MessageTypeError, cnst.Bucket, S3E006, "", map[string]any{
				"name": input.ProfileName,
			}),
		)
	}
	defer releaseConn()

	// One context for the whole call, so cancelAllUploads also stops the key check
	// below and the files that haven't started yet.
	ctx, cancel := context.WithCancel(m.host.Context())
	m.setBatchCancel(cancel)
	defer func() { m.setBatchCancel(nil); cancel() }()

	prefix := normalizePrefix(input.Prefix)
	// Find which keys (relative to prefix) are already used, before any upload starts,
	// so the keys can be picked below without a lock.
	used := existingKeys(ctx, client, input.Bucket, prefix, items)

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

	// Each goroutine writes only its own index, so no lock is needed.
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
					results[i] = m.uploadOne(ctx, ids[i], client, input.Bucket, items[i])
					continue
				}
				wg.Add(1)
				go func() {
					defer func() { <-sem; wg.Done() }()
					results[i] = m.uploadOne(ctx, ids[i], client, input.Bucket, items[i])
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

// groupUploadItems groups the indexes of items by the folder of their RelKey, in order of
// first appearance, and checks the per group limits. Sizes are read from disk; a file that
// can't be read counts as small (the upload reports it). If a limit is broken it returns
// the error message for it.
func groupUploadItems(items []models.UploadObj) (groups [][]int, violation []models.Message) {
	pos := map[string]int{}
	names := []string{}
	for i, item := range items {
		dir := relKeyDir(item.RelKey)
		p, ok := pos[dir]
		if !ok {
			p = len(groups)
			pos[dir] = p
			names = append(names, dir)
			groups = append(groups, nil)
		}
		groups[p] = append(groups[p], i)
	}

	for p, indexes := range groups {
		if len(indexes) > maxFilesPerFolder {
			return nil, []models.Message{
				models.NewParamsMessage(cnst.MessageTypeError, cnst.Bucket, S3E018, "", map[string]any{
					"folder": names[p],
					"max":    maxFilesPerFolder,
				}),
			}
		}
		large := 0
		for _, i := range indexes {
			if info, err := os.Stat(items[i].Path); err == nil && info.Size() > largeFileSize {
				large++
			}
		}
		if large > largeFileMaxCount {
			return nil, []models.Message{
				models.NewParamsMessage(cnst.MessageTypeError, cnst.Bucket, S3E022, "", map[string]any{
					"folder": names[p],
					"max":    largeFileMaxCount,
					"size":   largeFileSize >> 30,
				}),
			}
		}
	}
	return groups, nil
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

// dropKindPicker is the data-drop-kind of the drop zone inside the upload picker modal.
const dropKindPicker = "picker"

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
	attrs := target.Attributes
	event := EventFilesDropped
	if attrs["data-drop-kind"] == dropKindPicker {
		event = EventPickerFilesDropped
	}
	m.dropFiles(event, attrs["data-tab-id"], ctx.DroppedFiles())
}

// dropFiles expands the dropped paths and emits the result as event. An empty tabID
// (a drop outside a tab) is ignored.
func (m *submoduleUploaderMng) dropFiles(event, tabID string, dropped []string) {
	if tabID == "" {
		return
	}
	m.host.Emit(event, buildFilesDropped(tabID, dropped))
}

// buildFilesDropped expands paths (folders included) into groups of files, with the
// limits the frontend must apply.
func buildFilesDropped(tabID string, paths []string) models.FilesDroppedOutput {
	res := expandDropped(paths)
	return models.FilesDroppedOutput{
		TabId:             tabID,
		Groups:            res.groups,
		Skipped:           res.skipped,
		TotalFiles:        res.total,
		OverMaxTotal:      res.overTotal,
		Capped:            res.capped,
		MaxFilesPerFolder: maxFilesPerFolder,
		LargeFileSize:     largeFileSize,
		LargeFileMaxCount: largeFileMaxCount,
		MaxTotalFiles:     maxTotalFiles,
	}
}

// pickFiles opens the native file dialog (multiple files) and returns the chosen files
// as groups with their limits, sorted by file name. If the user cancels, Body is empty
// (no groups) and Result stays true. The dialog blocks until closed, so it has no timeout.
func (m *submoduleUploaderMng) pickFiles(ctx context.Context) models.Output[models.FilesDroppedOutput] {
	output := models.NewOutput[models.FilesDroppedOutput]()
	if ctx.Err() != nil {
		output.Result = false
		return output
	}
	paths, err := m.pickPaths()
	if err != nil {
		m.logger.Error("pick files error", slog.Any("detail", err.Error()))
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Bucket, S3E029, err.Error()))
	}
	if len(paths) == 0 {
		return output
	}
	// The dialog doesn't guarantee an order, so sort for a stable list.
	slices.SortFunc(paths, func(a, b string) int {
		byName := strings.Compare(strings.ToLower(filepath.Base(a)), strings.ToLower(filepath.Base(b)))
		if byName != 0 {
			return byName
		}
		return strings.Compare(a, b)
	})
	output.Body = buildFilesDropped("", paths)
	return output
}

// uploadOne uploads a single file. It registers a cancelable job and emits progress
// events while uploading. If the job was canceled, the result's error is context.Canceled.
func (m *submoduleUploaderMng) uploadOne(
	parent context.Context,
	id string,
	client s3Uploader,
	bucket string,
	item models.UploadObj,
) uploadResult {
	ctx, cancel := context.WithCancel(parent)

	// Register the job so it can be canceled; remove it when the upload ends.
	m.jobs.Store(id, uploaderJob{cancel: cancel})
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
	err := ctx.Err()
	if err == nil {
		_, err = uploadFile(ctx, client, bucket, item.Key, item.Path, func(done, total int64) {
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

	return uploadResult{path: item.Path, key: item.Key, err: err}
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
