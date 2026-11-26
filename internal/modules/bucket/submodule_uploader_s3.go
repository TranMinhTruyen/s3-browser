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
	// uploadPartConcurrency là số part của một file được gửi cùng lúc. Kết hợp với uploadFileConcurrency file đang truyền,
	// giá trị này giới hạn số yêu cầu đang mở ở mức số file nhân số part.
	uploadPartConcurrency = 4
	// minUploadPartSize là kích thước part nhỏ nhất. File nhỏ hơn mức này được gửi bằng một yêu cầu PutObject.
	// S3 yêu cầu mỗi part, trừ part cuối cùng, có kích thước ít nhất 5 MiB.
	minUploadPartSize = 8 << 20
	// maxUploadParts là giới hạn số part của một lượt tải lên nhiều phần trên S3.
	maxUploadParts = 10000
)

// uploadFile tải file tại path lên bucket/key rồi trả về kích thước.
// File nhỏ hơn minUploadPartSize được gửi bằng một yêu cầu PutObject; file lớn hơn được tải lên nhiều phần,
// với tối đa uploadPartConcurrency part đang truyền cùng lúc.
// Tiến độ được báo qua tracker theo id.
// Nếu thất bại hoặc bị hủy, object không được tạo và không để lại part nào trên máy chủ.
func uploadFile(
	ctx context.Context,
	client *s3.Client,
	bucket, key, path string,
	id string,
	tracker *utils.BatchReporter[models.UploadProgressOutput],
) (int64, error) {
	// Gọi Lstat trước để từ chối symbolic link thay vì đi theo liên kết.
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
	// Tracker đọc bộ đếm theo ticker dùng chung thay vì phát sự kiện sau mỗi lần đọc,
	// tránh làm frontend quá tải; done() phát giá trị cuối cùng khi lượt tải lên kết thúc.
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

// putSingle tải body lên thành một object bằng một yêu cầu PutObject duy nhất.
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

// putMultipart tải f (size byte) lên theo nhiều phần:
//  1. CreateMultipartUpload bắt đầu lượt tải và trả về ID.
//  2. Đọc trực tiếp các part từ f (không đệm trong bộ nhớ) rồi gửi song song.
//     Nếu một part thất bại, các part còn lại bị hủy.
//  3. CompleteMultipartUpload ghép các part thành object.
//
// Nếu bất kỳ bước nào thất bại hoặc ctx bị hủy, lượt tải sẽ bị hủy để S3 xóa các part đã lưu
// (nếu không chúng vẫn chiếm dung lượng và bị tính phí).
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

	// Bước 1: bắt đầu lượt tải lên.
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
		// ctx có thể đã bị hủy nên thao tác abort dùng context riêng với thời hạn ngắn.
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

	// Bước 2: gửi các part. Mỗi goroutine chỉ ghi vào vị trí riêng trong parts.
	// io.SectionReader đọc bằng ReadAt nên các part có thể dùng chung f an toàn.
	parts := make([]types.CompletedPart, partCount)
	g, gctx := errgroup.WithContext(ctx)
	g.SetLimit(uploadPartConcurrency)
	for i := range partCount {
		// Một part thất bại hoặc lượt tải bị hủy: không bắt đầu các part còn lại.
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
	// Vòng lặp có thể dừng sớm dù không có part nào thất bại (ctx bị hủy).
	if err = ctx.Err(); err != nil {
		return err
	}

	// Bước 3: ghép các part thành object.
	_, err = client.CompleteMultipartUpload(ctx, &s3.CompleteMultipartUploadInput{
		Bucket:          &bucket,
		Key:             &key,
		UploadId:        uploadID,
		MultipartUpload: &types.CompletedMultipartUpload{Parts: parts},
	})
	return err
}

// uploadPartSize trả về kích thước part cho file có kích thước đã cho: minUploadPartSize,
// hoặc lớn hơn nếu không thì file cần quá maxUploadParts part (trên khoảng 78 GiB); làm tròn lên MiB nguyên.
func uploadPartSize(size int64) int64 {
	partSize := int64(minUploadPartSize)
	if need := (size + maxUploadParts - 1) / maxUploadParts; need > partSize {
		partSize = (need + 1<<20 - 1) &^ (1<<20 - 1)
	}
	return partSize
}

// progressReader đọc từ r và cập nhật sent theo lượng dữ liệu đã đọc.
// SDK có thể đọc body nhiều lần (để tính checksum, chữ ký hoặc thử lại) và quay về đầu trước mỗi lần,
// vì vậy reader cộng số byte đã đọc rồi trừ lại khi quay lại. Nhờ đó sent không đếm trùng byte.
type progressReader struct {
	r    io.ReadSeeker
	sent *atomic.Int64
	pos  int64
}

// Read triển khai io.Reader và đếm số byte đã đọc.
func (p *progressReader) Read(b []byte) (int, error) {
	n, err := p.r.Read(b)
	p.pos += int64(n)
	p.sent.Add(int64(n))
	return n, err
}

// Seek triển khai io.Seeker và điều chỉnh bộ đếm cho các byte sẽ được đọc lại.
func (p *progressReader) Seek(offset int64, whence int) (int64, error) {
	pos, err := p.r.Seek(offset, whence)
	if err != nil {
		return pos, err
	}
	p.sent.Add(pos - p.pos)
	p.pos = pos
	return pos, nil
}

// nonEmpty trả nil nếu giá trị là "" để không gửi Content-Type chưa xác định dưới dạng header rỗng.
func nonEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
