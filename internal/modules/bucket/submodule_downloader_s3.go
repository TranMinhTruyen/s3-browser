package bucket

import (
	"S3Browser/internal/pkg/utils"
	"S3Browser/models"
	"context"
	"errors"
	"io"
	"os"
	"sync/atomic"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/s3/transfermanager"
)

// download lưu object vào dest bằng transfer manager, công cụ lấy các part song song, thử lại nếu đọc body của một part
// thất bại, gửi If-Match kèm ETag của part đầu tiên (để file không trộn nội dung cũ và mới) và kiểm tra checksum.
// Tiến độ được báo qua tracker theo id.
// Nếu thất bại hoặc bị hủy, không để lại file tại dest.
func download(
	ctx context.Context,
	tm *transfermanager.Client,
	bucket, key, dest string,
	id string,
	tracker *utils.BatchReporter[models.DownloadProgressOutput],
) (int64, error) {
	// Bước 1: ghi vào file tạm ".part" rồi đổi tên khi hoàn tất để dest không bao giờ chứa file chưa tải xong.
	// Nếu thất bại hoặc bị hủy, xóa file .part.
	part := dest + ".part"
	f, err := os.Create(part)
	if err != nil {
		return 0, err
	}
	defer func() {
		// Nếu file đã đóng ở cuối hàm thì thao tác này chỉ trả về lỗi sẽ bị bỏ qua.
		_ = f.Close()
		if err != nil {
			// Thất bại hoặc bị hủy: xóa file tạm.
			_ = os.Remove(part)
		}
	}()

	w := &countingWriterAt{w: f}
	var total atomic.Int64
	total.Store(-1)
	// Tracker đọc bộ đếm theo ticker dùng chung thay vì phát sự kiện sau mỗi lần ghi để tránh làm frontend quá tải;
	// done() phát giá trị cuối cùng khi lượt tải xuống kết thúc.
	done := tracker.Track(id, func() (models.DownloadProgressOutput, bool) {
		t := total.Load()
		if t < 0 { // size not known yet
			return models.DownloadProgressOutput{}, false
		}
		return models.DownloadProgressOutput{DownloadId: id, Downloaded: min(w.n.Load(), t), Total: t}, true
	})
	defer done()

	// Bước 2: tải các part song song vào file tạm.
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

	// Bước 3: phải đóng file trước khi đổi tên (Windows không thể đổi tên file đang mở).
	if err = f.Close(); err != nil {
		return 0, err
	}

	if err = os.Rename(part, dest); err != nil {
		return 0, err
	}

	return aws.ToInt64(out.ContentLength), nil
}

// countingWriterAt ghi vào w và cộng số byte đã ghi vào n (dùng để báo tiến độ).
type countingWriterAt struct {
	w io.WriterAt
	n atomic.Int64
}

// WriteAt triển khai io.WriterAt và đếm số byte đã ghi.
func (c *countingWriterAt) WriteAt(p []byte, off int64) (int, error) {
	n, err := c.w.WriteAt(p, off)
	c.n.Add(int64(n))
	return n, err
}

// onTransferStart là listener của transfer manager, nhận kích thước object khi có phản hồi đầu tiên.
type onTransferStart func(size int64)

// OnObjectTransferStart triển khai listener của transfer manager và chuyển tiếp kích thước object.
func (f onTransferStart) OnObjectTransferStart(_ context.Context, e *transfermanager.ObjectTransferStartEvent) {
	f(e.TotalBytes)
}
