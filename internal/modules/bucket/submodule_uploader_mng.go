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

type submoduleUploaderMng struct {
	logger *slog.Logger
	app    *application.App
	global *global.Module
	jobs   sync.Map
	// busy is set while an uploadObject call runs; only one runs at a time, across all tabs.
	busy atomic.Bool
}

func newSubmoduleUploaderMng(
	app *application.App,
	logger *slog.Logger,
	global *global.Module,
) *submoduleUploaderMng {
	return &submoduleUploaderMng{
		logger: logger.With("submodules", "uploader_mng"),
		app:    app,
		global: global,
	}
}

type uploaderJob struct {
	connID string
	cancel context.CancelFunc
}

const (
	uploadFileConcurrency = 5
	// maxUploadFiles is the most files one uploadObject call accepts.
	// The frontend asks the user before trimming a larger drop to this many.
	maxUploadFiles = 6
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
	if !m.busy.CompareAndSwap(false, true) {
		m.logger.Warn("another upload is running, skip")
		return output.ThrowError(
			models.NewParamsMessage(cnst.MessageTypeWarn, cnst.Bucket, S3W005, "", nil),
		)
	}
	defer m.busy.Store(false)

	s3Conn, ok := m.global.GetConnContainer(input.ConnectionId)

	if !ok {
		m.logger.Error("get connection profile failed")
		return output.ThrowError(
			models.NewParamsMessage(cnst.MessageTypeError, cnst.Bucket, S3E006, "", map[string]any{
				"name": input.ProfileName,
			}),
		)
	}

	ctx := m.app.Context()
	prefix := normalizePrefix(input.Prefix)
	// Find which file names are already used as keys under prefix, before any upload
	// starts, so the keys can be picked below without a lock.
	used := existingKeys(ctx, s3Conn.Client, input.Bucket, prefix, input.ObjList)

	// Each goroutine writes only its own index, so no lock is needed.
	results := make([]uploadResult, len(input.ObjList))
	// A plain errgroup.Group (no shared context): one failed file must not cancel the others.
	var g errgroup.Group
	g.SetLimit(uploadFileConcurrency)
	for i, item := range input.ObjList {
		// The same ID is used for the job, the progress events and a renamed key.
		id := utils.GenerateUUID()
		name := filepath.Base(item.Path)
		item.Key = prefix + name
		if _, taken := used[name]; taken {
			item.Key = prefix + id + "_" + name
		}
		used[name] = struct{}{}

		// Always return nil: errors are reported per file through results.
		g.Go(func() error {
			results[i] = m.uploadOne(ctx, id, input.ConnectionId, s3Conn.Client, input.Bucket, item)
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

// handleFilesDropped forwards files dropped on an object list to the frontend.
// The drop target carries the tab ID in data-tab-id; drops elsewhere are ignored.
// Only regular files are sent; folders and paths that can't be read are counted as skipped.
func (m *submoduleUploaderMng) handleFilesDropped(event *application.WindowEvent) {
	// ctx is nil for an event that didn't come from a real drop.
	ctx := event.Context()
	if ctx == nil {
		return
	}
	target := ctx.DropTargetDetails()
	if target == nil || target.Attributes["data-tab-id"] == "" {
		return
	}

	dropped := ctx.DroppedFiles()
	out := models.FilesDroppedOutput{
		TabId: target.Attributes["data-tab-id"],
		Paths: make([]string, 0, len(dropped)),
	}
	for _, p := range dropped {
		info, err := os.Stat(p)
		if err != nil || !info.Mode().IsRegular() {
			out.Skipped++
			continue
		}
		out.Paths = append(out.Paths, p)
	}

	m.app.Event.Emit(EventFilesDropped, out)
}

// uploadOne uploads a single file. It registers a cancelable job and emits progress
// events while uploading. If the job was canceled, the result's error is context.Canceled.
func (m *submoduleUploaderMng) uploadOne(
	parent context.Context,
	id, connID string,
	client *s3.Client,
	bucket string,
	item models.UploadObj,
) uploadResult {
	ctx, cancel := context.WithCancel(parent)

	// Register the job so it can be canceled; remove it when the upload ends.
	m.jobs.Store(id, uploaderJob{connID: connID, cancel: cancel})
	defer func() { cancel(); m.jobs.Delete(id) }()

	size, err := uploadFile(ctx, client, bucket, item.Key, item.Path, func(done, total int64) {
		m.app.Event.Emit(
			EventUploadObjectProgress,
			models.UploadProgressOutput{UploadId: id, Uploaded: done, Total: total},
		)
	})

	// If the context was canceled, report context.Canceled instead of whatever error
	// the S3 call returned.
	if err != nil && ctx.Err() != nil {
		err = context.Canceled
	}

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

// cancelAllUploads cancels every running upload.
func (m *submoduleUploaderMng) cancelAllUploads() models.Output[any] {
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
// prefix + file name already exists in bucket, for each item. Each distinct name is
// checked once. It returns the file names (without prefix) except those the bucket
// answered 404 for: a name that couldn't be checked is treated as existing, so its file
// gets a renamed key and nothing is overwritten.
func existingKeys(
	ctx context.Context,
	client *s3.Client,
	bucket, prefix string,
	items []models.UploadObj,
) map[string]struct{} {
	var names []string
	seen := make(map[string]struct{}, len(items))
	for _, item := range items {
		name := filepath.Base(item.Path)
		if _, ok := seen[name]; !ok {
			seen[name] = struct{}{}
			names = append(names, name)
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
