package bucket

import (
	"S3Browser/internal/pkg/utils"
	"context"
	"errors"
	"io"
	"os"
	"sync/atomic"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/s3/transfermanager"
)

// download saves the object to dest with the transfer manager, which fetches the object's
// parts in parallel, retries a part whose body read fails, sends If-Match with the ETag of
// the first part (so a file never mixes old and new content) and validates checksums.
// progress is called periodically with the bytes received so far and the total size.
// On failure or cancellation, no file is left at dest.
func download(
	ctx context.Context,
	tm *transfermanager.Client,
	bucket, key, dest string,
	progress func(done, total int64),
) (int64, error) {
	if progress == nil {
		progress = func(int64, int64) {} // allow callers that don't track progress
	}

	// Step 1: write to a temporary file so dest never ends up incomplete.
	part := dest + ".part"
	f, err := os.Create(part)
	if err != nil {
		return 0, err
	}
	defer func() {
		// if already closed at the end of the function, this just returns an ignored error
		_ = f.Close()
		if err != nil {
			// failed or canceled: delete the temporary file
			_ = os.Remove(part)
		}
	}()

	w := &countingWriterAt{w: f}
	var total atomic.Int64
	total.Store(-1)
	stop := utils.ReportEvery(200*time.Millisecond, func() {
		if t := total.Load(); t >= 0 {
			progress(min(w.n.Load(), t), t)
		}
	})
	defer stop()

	// Step 2: download the parts in parallel into the temporary file.
	out, err := tm.DownloadObject(ctx, &transfermanager.DownloadObjectInput{
		Bucket:   &bucket,
		Key:      &key,
		WriterAt: w,
	}, func(o *transfermanager.Options) {
		o.ObjectProgressListeners.Register(onTransferStart(func(size int64) { total.Store(size) }))
	})
	if err != nil {
		if UnwrapAwsError(err) == "PreconditionFailed" {
			err = errors.New("object has changed on server during download")
		}
		return 0, err
	}

	// Step 3: the file must be closed before renaming (Windows can't rename an open file).
	if err = f.Close(); err != nil {
		return 0, err
	}

	if err = os.Rename(part, dest); err != nil {
		return 0, err
	}

	return aws.ToInt64(out.ContentLength), nil
}

// countingWriterAt writes to w and adds the number of written bytes to n (used for progress).
type countingWriterAt struct {
	w io.WriterAt
	n atomic.Int64
}

func (c *countingWriterAt) WriteAt(p []byte, off int64) (int, error) {
	n, err := c.w.WriteAt(p, off)
	c.n.Add(int64(n))
	return n, err
}

// onTransferStart is a transfer manager listener that receives the object size
// once the first response arrives.
type onTransferStart func(size int64)

func (f onTransferStart) OnObjectTransferStart(_ context.Context, e *transfermanager.ObjectTransferStartEvent) {
	f(e.TotalBytes)
}
