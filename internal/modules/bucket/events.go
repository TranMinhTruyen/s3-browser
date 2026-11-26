package bucket

import (
	"S3Browser/models"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Tên sự kiện gửi đến frontend, theo định dạng domain:kebab-name.
const (
	// Phát sau khi lưu hồ sơ kết nối mới; payload là hồ sơ vừa tạo.
	EventConnectSaveProfile = "bucket:connect-save-profile"
	// Phát ngay trước khi thông tin xác thực không thể tự gia hạn hết hạn; payload là CredentialExpiringOutput.
	EventCredentialExpiring = "bucket:credential-expiring"
	// Phát mỗi 200 ms khi đang tải xuống và thêm một lần khi một lượt tải kết thúc; payload là DownloadProgressBatchOutput
	// (tiến độ của mọi lượt tải xuống đang chạy).
	EventDownloadProgressBatch = "downloader:download-progress-batch"
	// Phát khi tạo hoặc cập nhật bản ghi lịch sử; payload là DownloadHistoryItem.
	EventLoadDownloadHistory = "downloader:load-download-history"
	// Phát mỗi 200 ms khi đang tải lên và thêm một lần khi một lượt tải kết thúc; payload là UploadProgressBatchOutput
	// (tiến độ của mọi lượt tải lên đang chạy).
	EventUploadProgressBatch = "uploader:upload-progress-batch"
	// Phát khi thả file vào danh sách object của tab; payload là FilesDroppedOutput.
	EventFilesDropped = "uploader:files-dropped"
	// Phát khi thả file vào hộp thoại chọn file tải lên; payload là FilesDroppedOutput.
	EventPickerFilesDropped = "uploader:picker-files-dropped"
	// Phát trước khi bắt đầu tải file lên; payload là UploadStartedOutput.
	EventUploadObjectStarted = "uploader:upload-started"
	// Phát khi kết thúc tải file lên; payload là UploadFinishedOutput.
	EventUploadObjectFinished = "uploader:upload-finished"
)

// Phải gọi RegisterEvent trực tiếp từ init để bộ sinh binding tạo kiểu payload TypeScript
// cho Events.On / Events.Emit ở frontend.
func init() {
	application.RegisterEvent[models.ConnectionProfileOutput](EventConnectSaveProfile)
	application.RegisterEvent[models.CredentialExpiringOutput](EventCredentialExpiring)
	application.RegisterEvent[models.DownloadProgressBatchOutput](EventDownloadProgressBatch)
	application.RegisterEvent[models.DownloadHistoryItem](EventLoadDownloadHistory)
	application.RegisterEvent[models.UploadProgressBatchOutput](EventUploadProgressBatch)
	application.RegisterEvent[models.FilesDroppedOutput](EventFilesDropped)
	application.RegisterEvent[models.FilesDroppedOutput](EventPickerFilesDropped)
	application.RegisterEvent[models.UploadStartedOutput](EventUploadObjectStarted)
	application.RegisterEvent[models.UploadFinishedOutput](EventUploadObjectFinished)
}
