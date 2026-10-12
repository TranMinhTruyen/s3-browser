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
	}
}

type job struct {
	connID string
	cancel context.CancelFunc
}

type downloadResult struct {
	key    string
	err    error
	update *sqlc.UpdateStatusDownloadHistoryByIdParams
}

const (
	chunkSize   = 64 << 20
	concurrency = 6
)

func (m *submoduleDownloaderMng) downloadObject(input models.DownloadObjInput) models.Output[any] {
	output := models.NewOutput[any]()

	s3Conn, ok := m.global.GetConnContainer(input.ConnectionId)

	if ok == false {
		return output.ThrowError(
			models.NewParamsMessage(cnst.MessageTypeError, cnst.Downloader, S3E006, "", map[string]any{
				"name": input.ProfileName,
			}),
		)
	}

	var (
		destDir string
		err     error
	)

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
		return output.ThrowError(models.NewParamsMessage(cnst.MessageTypeError, cnst.Downloader, S3E009, err.Error(),
			map[string]any{"path": destDir}))
	}

	if destDir == "" {
		return output
	}

	results := make(chan downloadResult, len(input.Objects))
	var g errgroup.Group
	g.SetLimit(concurrency)
	for _, key := range input.Objects {
		dest := destDir

		if len(input.Objects) > 1 {
			dest = filepath.Join(destDir, path.Base(key))
		}

		g.Go(func() error {
			r := m.downloadOne(m.app.Context(), input.ConnectionId, s3Conn.Client, input.Bucket, key, dest)
			if r.update != nil {
				m.finishHistory(&r)
			}
			results <- r
			return nil
		})
	}
	_ = g.Wait()
	close(results)

	for r := range results {
		switch {
		case r.err == nil:
			output.AddMessage(
				models.NewParamsMessage(cnst.MessageTypeSuccess, cnst.Downloader, S3S004, "", map[string]any{
					"object": r.key,
					"dest":   destDir,
				}),
			)
		case errors.Is(r.err, context.Canceled):
			output.AddMessage(
				models.NewParamsMessage(cnst.MessageTypeError, cnst.Downloader, S3W002, "", map[string]any{
					"object": r.key,
				}),
			)
		default:
			output.AddMessage(
				models.NewParamsMessage(cnst.MessageTypeError, cnst.Downloader, S3E012, r.err.Error(), map[string]any{
					"object": r.key,
				}),
			)
		}
	}
	return output
}

func (m *submoduleDownloaderMng) cancelDownloadOne(id string) models.Output[any] {
	output := models.NewOutput[any]()
	v, ok := m.jobs.Load(id)
	if !ok {
		return output
	}
	v.(job).cancel()
	return output
}

func (m *submoduleDownloaderMng) downloadOne(
	parent context.Context,
	connID string,
	c *s3.Client,
	bucket, key, dest string,
) downloadResult {
	ctx, cancel := context.WithCancel(parent)

	id := utils.GenerateUUID()

	m.jobs.Store(id, job{connID: connID, cancel: cancel})
	defer func() { cancel(); m.jobs.Delete(id) }()

	saved, err := m.submoduleDownloadHistoryMng.createDownloadHistory(models.DownloadHistoryItem{
		ID:       id,
		FileName: key,
		DestPath: dest,
	})

	if err != nil {
		return downloadResult{key: key, err: fmt.Errorf("create history: %w", err)}
	}

	m.app.Event.Emit(EventLoadDownloadHistory, saved)

	err = download(ctx, c, bucket, key, dest, func(done, total int64) {
		m.app.Event.Emit(
			EventDownloadObjectProgress,
			models.DownloadProgressOutput{DownloadId: id, Downloaded: done, Total: total},
		)
	})

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
	quit := make(chan struct{}) // unbuffered: a send blocks until the goroutine receives it

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
