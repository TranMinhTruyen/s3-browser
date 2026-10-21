package bucket

import (
	"S3Browser/internal/modules/global"
	"S3Browser/internal/pkg/utils"
	"S3Browser/models"
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"mime"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/wailsapp/wails/v3/pkg/application"
	"golang.org/x/sync/errgroup"
)

type submoduleUploaderMng struct {
	logger *slog.Logger
	app    *application.App
	global *global.Module
	jobs   sync.Map
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
	uploadPartConcurrency = 4
	// minUploadPartSize is the smallest part size. Files smaller than this are sent in
	// a single PutObject. S3 requires every part except the last to be at least 5 MiB.
	minUploadPartSize = 8 << 20
	// maxUploadParts is the S3 limit on the number of parts in one multipart upload.
	maxUploadParts = 10000
)

// uploadItem is one local file to upload and the object key to store it under.
type uploadItem struct {
	path string
	key  string
}

type uploadResult struct {
	id   string
	path string
	key  string
	size int64
	err  error
}

// uploadFiles uploads every item to bucket, uploadFileConcurrency files at a time.
// It blocks until all uploads finish and returns one result per item, in the same order.
// A failed or canceled file doesn't stop the others.
func (m *submoduleUploaderMng) uploadFiles(connID, bucket string, items []uploadItem) ([]uploadResult, error) {
	s3Conn, ok := m.global.GetConnContainer(connID)
	if !ok {
		return nil, fmt.Errorf("connection %s not found", connID)
	}

	// Each goroutine writes only its own index, so no lock is needed.
	results := make([]uploadResult, len(items))
	// A plain errgroup.Group (no shared context): one failed file must not cancel the others.
	var g errgroup.Group
	g.SetLimit(uploadFileConcurrency)
	for i, item := range items {
		// The same ID is used for the job and the progress events.
		id := utils.GenerateUUID()
		// Always return nil: errors are reported per file through results.
		g.Go(func() error {
			results[i] = m.uploadOne(m.app.Context(), id, connID, s3Conn.Client, bucket, item)
			return nil
		})
	}
	_ = g.Wait()

	for _, r := range results {
		switch {
		case r.err == nil:
			m.logger.Info(fmt.Sprintf("Upload file %s success, key %s", r.path, r.key))
		case errors.Is(r.err, context.Canceled):
			m.logger.Warn(fmt.Sprintf("Upload file %s is canceled", r.path))
		default:
			m.logger.Error(fmt.Sprintf("Upload file %s error", r.path), slog.Any("detail", r.err.Error()))
		}
	}
	return results, nil
}

// uploadOne uploads a single file. It registers a cancelable job and emits progress
// events while uploading. If the job was canceled, the result's error is context.Canceled.
func (m *submoduleUploaderMng) uploadOne(
	parent context.Context,
	id, connID string,
	client *s3.Client,
	bucket string,
	item uploadItem,
) uploadResult {
	ctx, cancel := context.WithCancel(parent)

	// Register the job so it can be canceled; remove it when the upload ends.
	m.jobs.Store(id, uploaderJob{connID: connID, cancel: cancel})
	defer func() { cancel(); m.jobs.Delete(id) }()

	size, err := uploadFile(ctx, client, bucket, item.key, item.path, func(done, total int64) {
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

	return uploadResult{id: id, path: item.path, key: item.key, size: size, err: err}
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

// collectUploadItems turns dropped paths into upload items. A file is stored as
// prefix+<file name>; a folder is walked and each file inside it is stored as
// prefix+<folder name>/<path inside the folder>, so the folder structure is kept.
// Anything that isn't a regular file or a folder (symlink, device...) is skipped.
// prefix must be empty or end with "/".
func collectUploadItems(paths []string, prefix string) ([]uploadItem, error) {
	var items []uploadItem
	for _, p := range paths {
		p = filepath.Clean(p)
		// Keys are relative to the parent, so they start with the dropped file or folder name.
		base := filepath.Dir(p)
		err := filepath.WalkDir(p, func(cur string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			// Folders return nil here too, which keeps walking into them.
			if !d.Type().IsRegular() {
				return nil
			}
			rel, err := filepath.Rel(base, cur)
			if err != nil {
				return err
			}
			items = append(items, uploadItem{path: cur, key: prefix + filepath.ToSlash(rel)})
			return nil
		})
		if err != nil {
			return nil, err
		}
	}
	return items, nil
}

// uploadFile uploads the file at path to bucket/key and returns its size.
// Files smaller than minUploadPartSize are sent with one PutObject; larger files are
// sent as a multipart upload with uploadPartConcurrency parts in flight.
// progress is called periodically with the bytes sent so far and the file size.
// On failure or cancellation, no object is created and no parts are left on the server.
func uploadFile(
	ctx context.Context,
	client *s3.Client,
	bucket, key, path string,
	progress func(done, total int64),
) (int64, error) {
	if progress == nil {
		progress = func(int64, int64) {} // allow callers that don't track progress
	}

	f, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return 0, err
	}
	if !info.Mode().IsRegular() {
		return 0, fmt.Errorf("%s is not a regular file", path)
	}
	size := info.Size()

	var sent atomic.Int64
	stop := reportEvery(200*time.Millisecond, func() {
		progress(min(sent.Load(), size), size)
	})
	defer stop()

	contentType := mime.TypeByExtension(filepath.Ext(path))
	if size < minUploadPartSize {
		err = putSingle(ctx, client, bucket, key, contentType, io.NewSectionReader(f, 0, size), &sent)
	} else {
		err = putMultipart(ctx, client, bucket, key, contentType, f, size, &sent)
	}
	if err != nil {
		return 0, err
	}
	return size, nil
}

// putSingle uploads body as one object with a single PutObject request.
func putSingle(
	ctx context.Context,
	client *s3.Client,
	bucket, key, contentType string,
	body *io.SectionReader,
	sent *atomic.Int64,
) error {
	_, err := client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:            &bucket,
		Key:               &key,
		Body:              &progressReader{r: body, sent: sent},
		ContentLength:     aws.Int64(body.Size()),
		ContentType:       nonEmpty(contentType),
		ChecksumAlgorithm: types.ChecksumAlgorithmCrc32,
	})
	return err
}

// putMultipart uploads f (size bytes) as a multipart upload:
//  1. CreateMultipartUpload starts the upload and returns its ID.
//  2. The parts are read straight from f (no buffering in memory) and sent in parallel.
//     If one part fails, the others are canceled.
//  3. CompleteMultipartUpload joins the parts into the object.
//
// If any step fails or ctx is canceled, the upload is aborted so S3 deletes the parts
// already stored (they take space, and are billed, until then).
func putMultipart(
	ctx context.Context,
	client *s3.Client,
	bucket, key, contentType string,
	f *os.File,
	size int64,
	sent *atomic.Int64,
) (err error) {
	partSize := uploadPartSize(size)
	partCount := int((size + partSize - 1) / partSize)

	// Step 1: start the upload.
	created, err := client.CreateMultipartUpload(ctx, &s3.CreateMultipartUploadInput{
		Bucket:            &bucket,
		Key:               &key,
		ContentType:       nonEmpty(contentType),
		ChecksumAlgorithm: types.ChecksumAlgorithmCrc32,
	})
	if err != nil {
		return err
	}
	uploadID := created.UploadId

	defer func() {
		if err == nil {
			return
		}
		// ctx may already be canceled, so the abort gets its own short-lived context.
		abortCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
		defer cancel()
		if _, abortErr := client.AbortMultipartUpload(abortCtx, &s3.AbortMultipartUploadInput{
			Bucket:   &bucket,
			Key:      &key,
			UploadId: uploadID,
		}); abortErr != nil {
			err = errors.Join(err, fmt.Errorf("abort multipart upload: %w", abortErr))
		}
	}()

	// Step 2: send the parts. Each goroutine writes only its own index in parts.
	// io.SectionReader reads with ReadAt, so the parts can share f safely.
	parts := make([]types.CompletedPart, partCount)
	g, gctx := errgroup.WithContext(ctx)
	g.SetLimit(uploadPartConcurrency)
	for i := range partCount {
		// A part failed or the upload was canceled: don't start the remaining parts.
		if gctx.Err() != nil {
			break
		}
		num := int32(i + 1)
		off := int64(i) * partSize
		n := min(partSize, size-off)
		g.Go(func() error {
			out, err := client.UploadPart(gctx, &s3.UploadPartInput{
				Bucket:            &bucket,
				Key:               &key,
				UploadId:          uploadID,
				PartNumber:        aws.Int32(num),
				Body:              &progressReader{r: io.NewSectionReader(f, off, n), sent: sent},
				ContentLength:     aws.Int64(n),
				ChecksumAlgorithm: types.ChecksumAlgorithmCrc32,
			})
			if err != nil {
				return fmt.Errorf("upload part %d: %w", num, err)
			}
			parts[i] = types.CompletedPart{
				ETag:          out.ETag,
				PartNumber:    aws.Int32(num),
				ChecksumCRC32: out.ChecksumCRC32,
			}
			return nil
		})
	}
	if err = g.Wait(); err != nil {
		return err
	}
	// The loop may have stopped early without any part failing (ctx canceled).
	if err = ctx.Err(); err != nil {
		return err
	}

	// Step 3: join the parts into the object.
	_, err = client.CompleteMultipartUpload(ctx, &s3.CompleteMultipartUploadInput{
		Bucket:          &bucket,
		Key:             &key,
		UploadId:        uploadID,
		MultipartUpload: &types.CompletedMultipartUpload{Parts: parts},
	})
	return err
}

// uploadPartSize returns the part size for a file of the given size: minUploadPartSize,
// or more when the file would otherwise need more than maxUploadParts parts
// (above ~78 GiB), rounded up to a whole MiB.
func uploadPartSize(size int64) int64 {
	partSize := int64(minUploadPartSize)
	if need := (size + maxUploadParts - 1) / maxUploadParts; need > partSize {
		partSize = (need + 1<<20 - 1) &^ (1<<20 - 1)
	}
	return partSize
}

// progressReader reads from r and keeps sent up to date with how far into r it is.
// The SDK may read a body more than once (to compute a checksum or signature, or on a
// retry) and seeks back to the start before each pass, so the reader adds the bytes it
// reads and takes them off again when it seeks back. This way sent never counts a byte twice.
type progressReader struct {
	r    io.ReadSeeker
	sent *atomic.Int64
	pos  int64
}

func (p *progressReader) Read(b []byte) (int, error) {
	n, err := p.r.Read(b)
	p.pos += int64(n)
	p.sent.Add(int64(n))
	return n, err
}

func (p *progressReader) Seek(offset int64, whence int) (int64, error) {
	pos, err := p.r.Seek(offset, whence)
	if err != nil {
		return pos, err
	}
	p.sent.Add(pos - p.pos)
	p.pos = pos
	return pos, nil
}

// nonEmpty returns nil for "", so an unknown content type isn't sent as an empty header.
func nonEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
