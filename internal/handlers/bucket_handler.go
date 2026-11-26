package handlers

import (
	"S3Browser/internal/modules/bucket"
	"S3Browser/models"
	"context"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// BucketHandler là service Wails xử lý kết nối, bucket, object, tải lên và tải xuống.
type BucketHandler struct {
	bucket *bucket.Module
}

// NewBucketHandler tạo handler bucket.
func NewBucketHandler(bucket *bucket.Module) *BucketHandler {
	return &BucketHandler{
		bucket: bucket,
	}
}

// ConnectS3 kiểm tra kết nối nếu bật isTestConn; nếu không thì kết nối và giữ kết nối mở.
func (h *BucketHandler) ConnectS3(
	ctx context.Context,
	input models.ConnectionProfileInput,
	isTestConn bool,
	isExistingProfile bool,
) models.Output[models.ConnectOutput] {
	if isTestConn {
		return h.bucket.TestConnection(ctx, input)
	}
	return h.bucket.Connect(ctx, input, isExistingProfile)
}

// ConnectS3ByProfile kết nối bằng hồ sơ đã lưu.
func (h *BucketHandler) ConnectS3ByProfile(
	ctx context.Context,
	connectionId string,
) models.Output[models.ConnectOutput] {
	return h.bucket.ConnectByProfile(ctx, connectionId)
}

// ReauthConnection gia hạn thông tin xác thực của kết nối đang hoạt động (bằng mã MFA mới) mà không ngắt kết nối.
func (h *BucketHandler) ReauthConnection(
	ctx context.Context,
	connectionId string,
	input models.ConnectionProfileInput,
) models.Output[models.ConnectOutput] {
	return h.bucket.ReauthConnection(ctx, connectionId, input)
}

// LoginMinioOidc đăng nhập bằng OpenID Connect trong trình duyệt hệ thống và trả id phiên để dùng khi kết nối.
func (h *BucketHandler) LoginMinioOidc(
	ctx context.Context,
	cfg models.AuthConfig,
) models.Output[models.OidcLoginOutput] {
	return h.bucket.LoginMinioOidc(ctx, cfg)
}

// ChooseAuthFile mở hộp thoại chọn file chứng chỉ, khóa hoặc CA (kind: cert, key, ca).
func (h *BucketHandler) ChooseAuthFile(kind string) models.Output[string] {
	return h.bucket.ChooseAuthFile(kind)
}

// ListAwsProfiles liệt kê hồ sơ trong các file cấu hình AWS CLI; đường dẫn rỗng nghĩa là dùng file mặc định.
func (h *BucketHandler) ListAwsProfiles(configFile, credentialsFile string) models.Output[[]models.AwsProfileOutput] {
	return h.bucket.ListAwsProfiles(configFile, credentialsFile)
}

// DisconnectAll đóng mọi kết nối.
func (h *BucketHandler) DisconnectAll() {
	h.bucket.DisconnectAll()
}

// Disconnect đóng một kết nối.
func (h *BucketHandler) Disconnect(connectionId string) models.Output[bool] {
	return h.bucket.Disconnect(connectionId)
}

// GetListBucket liệt kê bucket của một kết nối.
func (h *BucketHandler) GetListBucket(
	ctx context.Context,
	input models.ListBucketInput,
) models.Output[models.ListBucketOutput] {
	return h.bucket.GetListBucket(ctx, input)
}

// CheckBucketAccess trả về các cờ quyền truy cập của những bucket đã cho.
func (h *BucketHandler) CheckBucketAccess(
	ctx context.Context,
	input models.CheckBucketAccessInput,
) models.Output[models.CheckBucketAccessOutput] {
	return h.bucket.CheckBucketAccess(ctx, input)
}

// CreateBucket tạo bucket.
func (h *BucketHandler) CreateBucket(ctx context.Context, input models.CreateBucketInput) models.Output[any] {
	return h.bucket.CreateBucket(ctx, input)
}

// GetBucketPolicy trả về chế độ truy cập và policy của bucket.
func (h *BucketHandler) GetBucketPolicy(
	ctx context.Context,
	input models.BucketPolicyInput,
) models.Output[models.BucketPolicyOutput] {
	return h.bucket.GetBucketPolicy(ctx, input)
}

// PutBucketPolicy đặt chế độ truy cập của bucket.
func (h *BucketHandler) PutBucketPolicy(
	ctx context.Context,
	input models.PutBucketPolicyInput,
) models.Output[models.BucketPolicyOutput] {
	return h.bucket.PutBucketPolicy(ctx, input)
}

// GetBucketDetail trả về thông tin chỉ đọc của bucket.
func (h *BucketHandler) GetBucketDetail(
	ctx context.Context,
	input models.BucketDetailInput,
) models.Output[models.BucketDetailOutput] {
	return h.bucket.GetBucketDetail(ctx, input)
}

// GetBucketDeleteInfo trả về trạng thái rỗng, versioning và Object Lock của bucket.
func (h *BucketHandler) GetBucketDeleteInfo(
	ctx context.Context,
	input models.DeleteBucketInput,
) models.Output[models.DeleteBucketInfoOutput] {
	return h.bucket.GetBucketDeleteInfo(ctx, input)
}

// DeleteBucket xóa bucket cùng mọi nội dung bên trong.
func (h *BucketHandler) DeleteBucket(
	ctx context.Context,
	input models.DeleteBucketInput,
) models.Output[models.DeleteBucketOutput] {
	return h.bucket.DeleteBucket(ctx, input)
}

// GetListObject liệt kê một trang object dưới prefix.
func (h *BucketHandler) GetListObject(
	ctx context.Context,
	input models.ListObjectInput,
) models.Output[models.ListObjectOutput] {
	return h.bucket.GetListObject(ctx, input)
}

// SearchObject tìm object trong bucket theo từ khóa.
func (h *BucketHandler) SearchObject(
	ctx context.Context,
	input models.SearchObjectInput,
) models.Output[models.SearchObjectOutput] {
	return h.bucket.SearchObject(ctx, input)
}

// SearchBucket tìm bucket theo từ khóa.
func (h *BucketHandler) SearchBucket(
	ctx context.Context,
	input models.SearchBucketInput,
) models.Output[models.SearchBucketOutput] {
	return h.bucket.SearchBucket(ctx, input)
}

// GetObjectDetail trả về metadata của một object.
func (h *BucketHandler) GetObjectDetail(
	ctx context.Context,
	input models.ObjectDetailInput,
) models.Output[models.ObjectDetailOutput] {
	return h.bucket.GetObjectDetail(ctx, input)
}

// DownloadObject bắt đầu tải object xuống.
func (h *BucketHandler) DownloadObject(input models.DownloadObjInput) models.Output[any] {
	return h.bucket.DownloadObject(input)
}

// CancelDownloadOne hủy một lượt tải xuống đang chạy.
func (h *BucketHandler) CancelDownloadOne(id string) models.Output[any] {
	return h.bucket.CancelDownloadOne(id)
}

// CancelAllDownloads hủy mọi lượt tải xuống đang chạy.
func (h *BucketHandler) CancelAllDownloads() models.Output[any] {
	return h.bucket.CancelAllDownloads()
}

// CancelUploadOne hủy một lượt tải lên đang chạy.
func (h *BucketHandler) CancelUploadOne(id string) models.Output[any] {
	return h.bucket.CancelUploadOne(id)
}

// CancelAllUploads hủy mọi lượt tải lên đang chạy.
func (h *BucketHandler) CancelAllUploads() models.Output[any] {
	return h.bucket.CancelAllUploads()
}

// DeleteObject xóa các object đã cho.
func (h *BucketHandler) DeleteObject(
	ctx context.Context,
	input models.DeleteObjInput,
) models.Output[models.DeleteObjOutput] {
	return h.bucket.DeleteObject(ctx, input)
}

// DeletePrefix xóa mọi object dưới prefix.
func (h *BucketHandler) DeletePrefix(
	ctx context.Context,
	input models.DeletePrefixInput,
) models.Output[models.DeletePrefixOutput] {
	return h.bucket.DeletePrefix(ctx, input)
}

// GetDownloadHistory trả về lịch sử tải xuống.
func (h *BucketHandler) GetDownloadHistory(
	input models.DownloadHistoryInput,
) models.Output[models.DownloadHistoryOutput] {
	return h.bucket.GetDownloadHistory(input)
}

// OpenDownloadDest mở file đã tải xuống trong trình quản lý file.
func (h *BucketHandler) OpenDownloadDest(fileName, path string) models.Output[any] {
	return h.bucket.OpenDownloadDest(fileName, path)
}

// UploadObject bắt đầu tải file lên.
func (h *BucketHandler) UploadObject(input models.UploadObjInput) models.Output[any] {
	return h.bucket.UploadObject(input)
}

// PickFiles mở hộp thoại của hệ điều hành để chọn file tải lên rồi trả về các nhóm file.
func (h *BucketHandler) PickFiles(ctx context.Context) models.Output[models.FilesDroppedOutput] {
	return h.bucket.PickFiles(ctx)
}

// FilesDropped là listener WindowFilesDropped của cửa sổ chính, không phải API frontend:
// wails:ignore ngăn hàm này xuất hiện trong binding được sinh tự động.
//
//wails:ignore
func (h *BucketHandler) FilesDropped(event *application.WindowEvent) {
	h.bucket.HandleFilesDropped(event)
}
