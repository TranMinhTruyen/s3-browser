package bucket

import (
	"S3Browser/internal/pkg/utils"
	"S3Browser/models"
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"os"
	"path/filepath"
	"sync/atomic"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"golang.org/x/sync/errgroup"
)

const (
	// uploadPartConcurrency is the parts of one file sent at once. With uploadFileConcurrency
	// files in flight this bounds open requests to files x parts.
	uploadPartConcurrency = 4
	// minUploadPartSize is the smallest part size. Files smaller than this are sent in
	// a single PutObject. S3 requires every part except the last to be at least 5 MiB.
	minUploadPartSize = 8 << 20
	// maxUploadParts is the S3 limit on the number of parts in one multipart upload.
	maxUploadParts = 10000
)

// uploadFile uploads the file at path to bucket/key and returns its size.
// Files smaller than minUploadPartSize are sent with one PutObject; larger files are
// sent as a multipart upload with uploadPartConcurrency parts in flight.
// Its progress is reported through tracker under id.
// On failure or cancellation, no object is created and no parts are left on the server.
func uploadFile(
	ctx context.Context,
	client *s3.Client,
	bucket, key, path string,
	id string,
	tracker *utils.BatchReporter[models.UploadProgressOutput],
) (int64, error) {
	// Lstat first so a symlink is rejected instead of followed.
	if info, err := os.Lstat(path); err != nil {
		return 0, err
	} else if !info.Mode().IsRegular() {
		return 0, fmt.Errorf("%s is not a regular file", path)
	}

	f, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer func() { _ = f.Close() }() // read-only file: close error is harmless

	info, err := f.Stat()
	if err != nil {
		return 0, err
	}
	if !info.Mode().IsRegular() {
		return 0, fmt.Errorf("%s is not a regular file", path)
	}
	size := info.Size()

	var sent atomic.Int64
	// The tracker samples the counter on a shared ticker instead of emitting an event per read,
	// which would flood the frontend; done() emits the final value when the upload returns.
	done := tracker.Track(id, func() (models.UploadProgressOutput, bool) {
		return models.UploadProgressOutput{UploadId: id, Uploaded: min(sent.Load(), size), Total: size}, true
	})
	defer done()

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

// Read implements io.Reader and counts the bytes read.
func (p *progressReader) Read(b []byte) (int, error) {
	n, err := p.r.Read(b)
	p.pos += int64(n)
	p.sent.Add(int64(n))
	return n, err
}

// Seek implements io.Seeker and corrects the count for bytes that will be read again.
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
