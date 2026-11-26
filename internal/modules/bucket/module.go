// Package bucket là module S3, xử lý kết nối, bucket, object, tìm kiếm, tải lên và tải xuống.
// Module là API công khai để các handler gọi; phần xử lý nằm trong những file submodule_*.go.
package bucket

import (
	"S3Browser/internal/modules/global"
	"S3Browser/internal/modules/profile"
	"S3Browser/models"
	"context"
	"database/sql"
	"log/slog"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Mã thông báo mà module bucket trả về cho frontend.
// Quy ước đặt tên: S3S = thành công, S3E = lỗi, S3W = cảnh báo.
var (
	// ---- Thành công ----

	// Kiểm tra kết nối S3 của hồ sơ {name} thành công.
	S3S001 = "S3S001"

	// Đã kết nối hồ sơ: {name}.
	S3S002 = "S3S002"

	// Ngắt kết nối hồ sơ {name} thành công.
	S3S003 = "S3S003"

	// Tải file {object} thành công đến {dest}.
	S3S004 = "S3S004"

	// Tải file {name} lên thành công với key {key}.
	S3S006 = "S3S006"

	// Đã tạo bucket {bucket}.
	S3S007 = "S3S007"

	// Đã lưu quyền truy cập của bucket {bucket}.
	S3S008 = "S3S008"

	// Đã xóa bucket {bucket}.
	S3S009 = "S3S009"

	// ---- Lỗi ----

	// Access key hoặc secret key không hợp lệ với endpoint này.
	S3E001 = "S3E001"

	// Endpoint từ chối yêu cầu.
	S3E002 = "S3E002"

	// Hết thời gian kết nối đến endpoint; hãy kiểm tra địa chỉ và trạng thái máy chủ.
	S3E003 = "S3E003"

	// Lỗi khi kết nối đến bucket S3.
	S3E004 = "S3E004"

	// Lỗi khi ngắt kết nối khỏi bucket S3.
	S3E005 = "S3E005"

	// Hồ sơ {name} chưa được kết nối.
	S3E006 = "S3E006"

	// Lỗi khi lấy danh sách bucket của hồ sơ {name}.
	S3E007 = "S3E007"

	// Lỗi khi lấy danh sách object của hồ sơ {name}, bucket {bucket}.
	S3E008 = "S3E008"

	// Thư mục đích {path} không tồn tại.
	S3E009 = "S3E009"

	// Lỗi khi lấy lịch sử tải xuống.
	S3E011 = "S3E011"

	// Lỗi khi tải object {object} xuống.
	S3E012 = "S3E012"

	// File {name} không tồn tại.
	S3E014 = "S3E014"

	// Không thể truy cập file {name}.
	S3E015 = "S3E015"

	// Không thể mở file {name}.
	S3E016 = "S3E016"

	// Lỗi khi tải file {name} lên.
	S3E017 = "S3E017"

	// Thư mục {folder} có hơn {max} file cần tải lên.
	S3E018 = "S3E018"

	// Đường dẫn tải lên của file {name} không hợp lệ.
	S3E019 = "S3E019"

	// Thư mục {prefix} không hợp lệ nên không thể xóa.
	S3E020 = "S3E020"

	// Thư mục {folder} có hơn {max} file vượt quá {size} GiB cần tải lên.
	S3E022 = "S3E022"

	// Mỗi lần chỉ được tải lên tối đa {max} file.
	S3E023 = "S3E023"

	// Lỗi khi lấy chi tiết object {key} của hồ sơ {name}, bucket {bucket}.
	S3E024 = "S3E024"

	// Key của object {key} không hợp lệ.
	S3E025 = "S3E025"

	// Lỗi khi tìm object trong hồ sơ {name}, bucket {bucket}.
	S3E026 = "S3E026"

	// Lỗi khi tìm bucket trong hồ sơ {name}.
	S3E027 = "S3E027"

	// Từ khóa tìm kiếm không được để trống.
	S3E028 = "S3E028"

	// Lỗi khi chọn file.
	S3E029 = "S3E029"

	// Thông tin xác thực của hồ sơ {name} đã hết hạn; hãy kết nối lại.
	S3E030 = "S3E030"

	// Không thể AssumeRole {roleArn}: không tìm thấy role hoặc không được phép (sts:AssumeRole).
	S3E031 = "S3E031"

	// Mã MFA không hợp lệ hoặc đã hết hạn.
	S3E032 = "S3E032"

	// Không tìm thấy hồ sơ AWS CLI {profile} hoặc hồ sơ không hợp lệ.
	S3E033 = "S3E033"

	// Phiên SSO của hồ sơ {profile} đã hết hạn; chạy: aws sso login --profile {profile}
	S3E034 = "S3E034"

	// Không tìm thấy thông tin xác thực trong môi trường (chuỗi mặc định).
	S3E035 = "S3E035"

	// credential_process của hồ sơ {profile} thất bại.
	S3E036 = "S3E036"

	// Yêu cầu STS đến MinIO thất bại.
	S3E037 = "S3E037"

	// Tên người dùng hoặc mật khẩu LDAP không chính xác.
	S3E038 = "S3E038"

	// Đăng nhập OIDC đã bị hủy hoặc hết thời gian chờ.
	S3E039 = "S3E039"

	// Cổng callback {port} đang được sử dụng; hãy chọn cổng khác.
	S3E040 = "S3E040"

	// Đăng nhập OIDC thất bại: {detail}.
	S3E041 = "S3E041"

	// Không tìm thấy file chứng chỉ hoặc khóa {path}; hãy chọn lại.
	S3E042 = "S3E042"

	// Chứng chỉ hoặc khóa không hợp lệ hay không khớp.
	S3E043 = "S3E043"

	// Không thể truy cập ẩn danh bất kỳ bucket nào đã nhập.
	S3E044 = "S3E044"

	// Lỗi khi đọc các file cấu hình AWS.
	S3E045 = "S3E045"

	// Cần cung cấp {secret} để gia hạn thông tin xác thực của hồ sơ {name} (giá trị này không được lưu).
	// Tham số secret dùng một trong các key cố định: mfaCode, secretKey, ldapPassword, oidcSession hoặc keyPassword.
	S3E046 = "S3E046"

	// Không tìm thấy phiên đăng nhập OIDC hoặc phiên đã hết hạn; hãy đăng nhập lại.
	S3E047 = "S3E047"

	// Khóa riêng tư {path} được bảo vệ bằng mật khẩu; hãy nhập mật khẩu của khóa.
	S3E048 = "S3E048"

	// Không tìm thấy file chứng chỉ CA {path} hoặc file không chứa chứng chỉ hợp lệ.
	S3E049 = "S3E049"

	// Tên bucket {bucket} đã được sử dụng.
	S3E050 = "S3E050"

	// Tên bucket {bucket} không hợp lệ.
	S3E051 = "S3E051"

	// Bạn không có quyền thay đổi bucket {bucket}.
	S3E052 = "S3E052"

	// Lỗi khi tạo bucket {bucket}.
	S3E053 = "S3E053"

	// Kết nối ẩn danh không thể tạo, thay đổi hoặc xóa bucket.
	S3E054 = "S3E054"

	// Lỗi khi lấy quyền truy cập của bucket {bucket}.
	S3E055 = "S3E055"

	// Lỗi khi lưu quyền truy cập của bucket {bucket}.
	S3E056 = "S3E056"

	// Policy của bucket không hợp lệ.
	S3E057 = "S3E057"

	// Block Public Access của bucket {bucket} không cho phép policy công khai.
	S3E058 = "S3E058"

	// Bucket {bucket} không tồn tại.
	S3E059 = "S3E059"

	// Lỗi khi xóa bucket {bucket}.
	S3E060 = "S3E060"

	// Bucket {bucket} không trống vì có object mới được thêm vào nên chưa bị xóa.
	S3E061 = "S3E061"

	// Chưa xóa bucket {bucket}: không thể xóa {failed} object.
	S3E062 = "S3E062"

	// Bucket {bucket} đang bật Object Lock và không trống nên không thể xóa.
	S3E063 = "S3E063"

	// Chưa xóa bucket {bucket}: bucket còn phiên bản cũ mà máy chủ này không thể liệt kê.
	S3E064 = "S3E064"

	// ---- Cảnh báo ----

	// Quyền truy cập bucket bị giới hạn.
	S3W001 = "S3W001"

	// Đã hủy tải object {object} xuống.
	S3W002 = "S3W002"

	// Đã hủy tải file {name} lên.
	S3W004 = "S3W004"

	// Một tiến trình tải lên khác đang chạy; hãy chờ tiến trình hoàn tất.
	S3W005 = "S3W005"

	// Chỉ dùng ở frontend.
	// Đã bỏ qua {count} mục không thể tải lên (không đọc được, là liên kết tượng trưng hoặc không phải file thông thường).
	S3W006 = "S3W006"

	// Chỉ dùng ở frontend.
	// Số file được thả vượt quá {max}; các file sau {max} file đầu tiên sẽ bị bỏ qua.
	S3W007 = "S3W007"

	// Thông tin xác thực của hồ sơ {name} sẽ hết hạn sau {minutes} phút và không thể tự động gia hạn.
	S3W008 = "S3W008"

	// Không thể truy cập ẩn danh vào bucket {bucket}.
	S3W009 = "S3W009"

	// Chỉ dùng ở frontend.
	// Thông tin xác thực của hồ sơ {name} sắp hết hạn; hãy nhập mã MFA mới để duy trì kết nối.
	S3W010 = "S3W010"

	// Đã tạo bucket {bucket} nhưng không thể đặt quyền truy cập. Bạn có thể đổi quyền sau trong mục Access permission.
	S3W011 = "S3W011"

	// Đã tạo bucket {bucket}, nhưng Block Public Access không cho phép policy công khai nên bucket vẫn ở chế độ riêng tư.
	S3W012 = "S3W012"
)

// Module là API công khai của module bucket.
type Module struct {
	logger  *slog.Logger
	app     *application.App
	global  *global.Module
	profile *profile.Module

	submoduleDownloadHistoryMng *submoduleDownloadHistoryMng
	submoduleConnMng            *submoduleConnMng
	submoduleBucketMng          *submoduleBucketMng
	submoduleBucketEditMng      *submoduleBucketEditMng
	submoduleObjMng             *submoduleObjMng
	submoduleSearchMng          *submoduleSearchMng
	submoduleAwsProfilesMng     *submoduleAwsProfilesMng
	submoduleDownloaderMng      *submoduleDownloaderMng
	submoduleUploaderMng        *submoduleUploaderMng
	submoduleOidcMng            *submoduleOidcMng
	submoduleAuthFilesMng       *submoduleAuthFilesMng
}

// NewModule tạo module bucket cùng các submodule.
func NewModule(
	app *application.App,
	logger *slog.Logger,
	global *global.Module,
	db *sql.DB,
	profileModule *profile.Module,
) *Module {
	submoduleOidcMng := newSubmoduleOidcMng(app, logger)
	submoduleCfgMng := newSubmoduleCfgMng(logger, submoduleOidcMng)
	submoduleDownloadHistoryMng := newSubmoduleDownloadHistoryMng(app, logger, db)
	submoduleConnMng := newSubmoduleConnMng(app, logger, global, profileModule, submoduleCfgMng)
	submoduleBucketMng := newSubmoduleBucketMng(app, logger, global)
	submoduleBucketEditMng := newSubmoduleBucketEditMng(app, logger, global)
	submoduleObjMng := newSubmoduleObjMng(app, logger, global)
	submoduleSearchMng := newSubmoduleSearchMng(app, logger, global)
	submoduleAwsProfilesMng := newSubmoduleAwsProfilesMng(logger)
	submoduleDownloaderMng := newSubmoduleDownloaderMng(app, logger, global, submoduleDownloadHistoryMng)
	submoduleUploaderMng := newSubmoduleUploaderMng(app, logger, global)
	submoduleAuthFilesMng := newSubmoduleAuthFilesMng(app, logger)

	return &Module{
		logger:  logger.With("modules", "bucket"),
		app:     app,
		global:  global,
		profile: profileModule,

		submoduleDownloadHistoryMng: submoduleDownloadHistoryMng,
		submoduleConnMng:            submoduleConnMng,
		submoduleBucketMng:          submoduleBucketMng,
		submoduleBucketEditMng:      submoduleBucketEditMng,
		submoduleObjMng:             submoduleObjMng,
		submoduleSearchMng:          submoduleSearchMng,
		submoduleAwsProfilesMng:     submoduleAwsProfilesMng,
		submoduleDownloaderMng:      submoduleDownloaderMng,
		submoduleUploaderMng:        submoduleUploaderMng,
		submoduleOidcMng:            submoduleOidcMng,
		submoduleAuthFilesMng:       submoduleAuthFilesMng,
	}
}

// Connect kết nối đến endpoint tương thích S3 bằng input đã cho.
// Nếu isExistingProfile là true, input là hồ sơ đã lưu (người dùng tự nhập secret key): hàm kết nối bằng input.Id và không tạo hồ sơ mới.
// Nếu là false, input là kết nối mới: hàm tạo hồ sơ từ input; nếu tạo hồ sơ thất bại thì ngắt kết nối.
// Khi thành công, kết nối được giữ lại để dùng cho các thao tác bucket/object tiếp theo.
// ctx là context của lời gọi; hủy context sẽ dừng kết nối mà không gửi thông báo.
func (m *Module) Connect(
	ctx context.Context,
	input models.ConnectionProfileInput,
	isExistingProfile bool,
) models.Output[models.ConnectOutput] {
	return m.submoduleConnMng.connectAction(ctx, input, isExistingProfile)
}

// TestConnection kiểm tra thông tin xác thực và endpoint đã cho có hợp lệ không mà không giữ kết nối mở.
// Có thể dùng để xác thực hồ sơ trước khi lưu. ctx là context của lời gọi; hủy context sẽ dừng kiểm tra mà không gửi thông báo.
func (m *Module) TestConnection(
	ctx context.Context,
	input models.ConnectionProfileInput,
) models.Output[models.ConnectOutput] {
	return m.submoduleConnMng.testAction(ctx, input)
}

// ConnectByProfile kết nối bằng hồ sơ đã lưu có connectionId tương ứng, đồng thời lấy cấu hình kết nối từ module profile.
// ctx là context của lời gọi; hủy context sẽ dừng kết nối mà không gửi thông báo.
func (m *Module) ConnectByProfile(ctx context.Context, connectionId string) models.Output[models.ConnectOutput] {
	return m.submoduleConnMng.profileConnectAction(ctx, connectionId)
}

// ReauthConnection gia hạn thông tin xác thực của kết nối đang hoạt động connectionId mà không ngắt kết nối, nên các lượt truyền đang chạy vẫn tiếp tục.
// Cấu hình và secret đã lưu được lấy từ hồ sơ tương ứng với kết nối; secret không được giữ trong bộ nhớ.
// input phải chứa các giá trị mà hồ sơ không lưu: mfaCode (assumeRole có MFA), secretKey (assumeRole dùng khóa hoặc minioAssumeRole) và authSecret.ldapPassword (minioLdap).
// Thiếu giá trị cần thiết sẽ trả S3E046 (tham số name, secret). Với sso, trước tiên chạy aws sso login; kết nối ẩn danh không cần gia hạn.
// ctx là context của lời gọi.
func (m *Module) ReauthConnection(
	ctx context.Context,
	connectionId string,
	input models.ConnectionProfileInput,
) models.Output[models.ConnectOutput] {
	return m.submoduleConnMng.reauthAction(ctx, connectionId, input)
}

// LoginMinioOidc đăng nhập người dùng bằng cấu hình OpenID Connect trong cfg: mở trình duyệt hệ thống, chờ chuyển hướng về
// 127.0.0.1:cfg.CallbackPort (mặc định 48765 khi giá trị bằng 0), rồi trả về id của phiên giữ token trong bộ nhớ.
// Truyền id đó làm OidcSessionId cho Connect, TestConnection hoặc ReauthConnection. Phiên kết thúc khi id_token hết hạn,
// sau 10 phút hoặc ngay khi được dùng để kết nối. Hàm trả S3E039 khi hết thời gian, S3E040 khi cổng đang bận hoặc S3E041 khi đăng nhập lỗi;
// hủy ctx sẽ dừng đăng nhập mà không gửi thông báo.
func (m *Module) LoginMinioOidc(ctx context.Context, cfg models.AuthConfig) models.Output[models.OidcLoginOutput] {
	return m.submoduleOidcMng.login(ctx, cfg)
}

// ChooseAuthFile mở hộp thoại hệ thống để chọn file chứng chỉ (kind "cert"), khóa riêng tư ("key") hoặc chứng chỉ CA ("ca"), rồi trả về đường dẫn.
// Body rỗng nếu người dùng hủy.
func (m *Module) ChooseAuthFile(kind string) models.Output[string] {
	return m.submoduleAuthFilesMng.chooseAuthFile(kind)
}

// ListAwsProfiles trả về các hồ sơ trong file cấu hình và thông tin xác thực của AWS CLI (đường dẫn rỗng nghĩa là dùng file mặc định).
// Hàm chỉ phân tích file, không chạy credential_process. File không tồn tại cho kết quả danh sách rỗng; file không đọc được trả S3E045.
func (m *Module) ListAwsProfiles(configFile, credentialsFile string) models.Output[[]models.AwsProfileOutput] {
	return m.submoduleAwsProfilesMng.list(configFile, credentialsFile)
}

// Disconnect đóng kết nối đang hoạt động có connectionId tương ứng và xóa kết nối đó khỏi kho kết nối dùng chung.
// Trả về true nếu ngắt kết nối thành công.
func (m *Module) Disconnect(connectionId string) models.Output[bool] {
	return m.submoduleConnMng.disconnectAction(connectionId)
}

// DisconnectAll xóa mọi kết nối đang hoạt động khỏi kho dùng chung và đóng các kết nối HTTP đang rảnh.
// Gọi hàm này khi ứng dụng tắt để giải phóng tài nguyên mạng.
func (m *Module) DisconnectAll() {
	m.submoduleOidcMng.clear()
	for _, conn := range m.global.RemoveAllConn() {
		conn.Close()
	}
}

// GetListBucket trả về các bucket có thể truy cập bằng kết nối được chỉ định trong input.
// Kết nối phải được thiết lập trước.
func (m *Module) GetListBucket(
	ctx context.Context,
	input models.ListBucketInput,
) models.Output[models.ListBucketOutput] {
	return m.submoduleBucketMng.listBucket(ctx, input)
}

// CheckBucketAccess trả về cờ Inaccessible / ReadOnly cho input.BucketNames và kiểm tra các bucket chưa có quyền truy cập trong cache.
// Nếu không thể hoàn tất kiểm tra kịp thời, bucket được trả về với AccessPending.
// Khi input.WithPolicy được bật, hàm cũng đọc PolicyMode của các bucket chưa có trong cache (ListBucket và SearchBucket chỉ trả về dữ liệu đã cache).
// ctx là context của lời gọi.
func (m *Module) CheckBucketAccess(
	ctx context.Context,
	input models.CheckBucketAccessInput,
) models.Output[models.CheckBucketAccessOutput] {
	return m.submoduleBucketMng.checkBucketAccess(ctx, input)
}

// CreateBucket tạo bucket input.Bucket. Với AWS thật, region lấy từ input.Region, sau đó từ hồ sơ, nếu cả hai đều không có thì dùng us-east-1.
// Yêu cầu được gửi đến region đó; nếu khác us-east-1 thì region được truyền dưới dạng LocationConstraint. MinIO và endpoint tùy chỉnh bỏ qua input.Region.
// Có thể trả S3E054 (ẩn danh), S3E050 (tên đã dùng), S3E051 (tên không hợp lệ), S3E052 (bị từ chối) hoặc S3E053. Khi thành công, cache quyền truy cập được xóa.
// input.Mode (private, public hoặc custom kèm input.Policy; rỗng nghĩa là private) đặt quyền truy cập sau khi tạo bucket.
// Mode không xác định (S3E053) hoặc policy tùy chỉnh không phải JSON (S3E057) sẽ gây lỗi trước khi tạo bucket.
// Nếu không đặt được quyền, bucket vẫn được giữ và Result vẫn là true kèm một cảnh báo: S3W012 khi Block Public Access từ chối policy công khai,
// nếu không thì trả S3W011. ctx là context của lời gọi.
func (m *Module) CreateBucket(ctx context.Context, input models.CreateBucketInput) models.Output[any] {
	return m.submoduleBucketEditMng.createBucket(ctx, input)
}

// GetBucketPolicy trả về chế độ truy cập của bucket (private, public read-only hoặc custom), JSON policy,
// trạng thái Block Public Access có cấm policy công khai hay không (với AWS thật) và trạng thái tài khoản có bị chặn đổi policy không
// (MinIO khi có thông tin xác thực). Có thể trả S3E054 (ẩn danh), S3E052 (bị từ chối) hoặc S3E055. ctx là context của lời gọi.
func (m *Module) GetBucketPolicy(
	ctx context.Context,
	input models.BucketPolicyInput,
) models.Output[models.BucketPolicyOutput] {
	return m.submoduleBucketEditMng.getBucketPolicy(ctx, input)
}

// PutBucketPolicy đặt chế độ truy cập của bucket: private xóa policy, public áp dụng policy công khai chỉ đọc, còn custom dùng input.Policy.
// Hàm trả về trạng thái đọc lại sau khi lưu. Có thể trả S3E054 (ẩn danh), S3E057 (policy không hợp lệ),
// S3E058 (Block Public Access), S3E052 (bị từ chối) hoặc S3E056. ctx là context của lời gọi.
func (m *Module) PutBucketPolicy(
	ctx context.Context,
	input models.PutBucketPolicyInput,
) models.Output[models.BucketPolicyOutput] {
	return m.submoduleBucketEditMng.putBucketPolicy(ctx, input)
}

// GetBucketDetail trả về thông tin chỉ đọc của bucket. Mục không đọc được (bị từ chối, không hỗ trợ hoặc hết thời gian) sẽ là nil trong body.
// Hàm cũng hoạt động với kết nối ẩn danh. Có thể trả S3E006, S3E030 hoặc S3E059.
// ctx là context của lời gọi; hủy context sẽ dừng thao tác mà không gửi thông báo.
func (m *Module) GetBucketDetail(
	ctx context.Context,
	input models.BucketDetailInput,
) models.Output[models.BucketDetailOutput] {
	return m.submoduleBucketEditMng.getBucketDetail(ctx, input)
}

// GetBucketDeleteInfo trả về thông tin hộp thoại xóa cần: bucket có trống không (nil nếu chưa xác định), trạng thái versioning
// ("Enabled", "Suspended", "Off", rỗng nếu chưa xác định) và Object Lock có bật không. Có thể trả S3E006, S3E030, S3E054 (ẩn danh) hoặc S3E059.
// ctx là context của lời gọi.
func (m *Module) GetBucketDeleteInfo(
	ctx context.Context,
	input models.DeleteBucketInput,
) models.Output[models.DeleteBucketInfoOutput] {
	return m.submoduleBucketEditMng.getBucketDeleteInfo(ctx, input)
}

// DeleteBucket xóa mọi object, phiên bản và delete marker trong bucket, sau đó xóa chính bucket. Không thể hoàn tác thao tác này.
// Nếu bucket không trống và bật Object Lock, hàm từ chối trước khi xóa object nào (S3E063); trường hợp không đọc được Object Lock cũng bị từ chối (S3E060).
// Hàm dừng ở lô đầu tiên có key xóa thất bại (S3E062, body liệt kê các lỗi) và không xóa bucket.
// Body thống kê số mục đã xóa kể cả khi Result là false. Các lỗi khác: S3E054 (ẩn danh), S3E052 (bị từ chối), S3E059 (không tìm thấy),
// S3E061 (có object mới được thêm), S3E064 (còn phiên bản cũ trên máy chủ không thể liệt kê), S3E060 (cũng dùng khi hết thời gian chờ 30 phút).
// Khi ứng dụng đóng, thao tác dừng mà không gửi thông báo. Cache quyền truy cập được xóa khi thành công.
// ctx là context của lời gọi.
func (m *Module) DeleteBucket(
	ctx context.Context,
	input models.DeleteBucketInput,
) models.Output[models.DeleteBucketOutput] {
	return m.submoduleBucketEditMng.deleteBucket(ctx, input)
}

// GetListObject trả về các object trong bucket được chỉ định ở input, bằng một kết nối đã được thiết lập.
func (m *Module) GetListObject(
	ctx context.Context,
	input models.ListObjectInput,
) models.Output[models.ListObjectOutput] {
	return m.submoduleObjMng.listObject(ctx, input)
}

// SearchObject quét thư mục input.Prefix (không đệ quy) để tìm key chứa input.Keyword (không phân biệt hoa thường),
// trả tối đa 100 kết quả mỗi lần gọi và quét nhiều nhất 20 trang.
// Để tiếp tục, truyền NextCursor nhận được vào input.NextCursor; NextCursor rỗng nghĩa là đã quét hết.
// Từ khóa rỗng sẽ bị từ chối. ctx là context của lời gọi.
func (m *Module) SearchObject(
	ctx context.Context,
	input models.SearchObjectInput,
) models.Output[models.SearchObjectOutput] {
	return m.submoduleSearchMng.searchObject(ctx, input)
}

// SearchBucket quét các bucket của kết nối để tìm tên chứa input.Keyword (không phân biệt hoa thường),
// trả tối đa 100 kết quả mỗi lần gọi và quét nhiều nhất 20 trang.
// Để tiếp tục, truyền NextCursor (giá trị opaque) nhận được vào input.NextCursor; NextCursor rỗng nghĩa là đã quét hết.
// Từ khóa rỗng hoặc cursor không hợp lệ sẽ bị từ chối. ctx là context của lời gọi.
func (m *Module) SearchBucket(
	ctx context.Context,
	input models.SearchBucketInput,
) models.Output[models.SearchBucketOutput] {
	return m.submoduleSearchMng.searchBucket(ctx, input)
}

// GetObjectDetail trả về content type, storage class và metadata do người dùng đặt của object input.Key (HeadObject).
// Key của thư mục hoặc key rỗng sẽ bị từ chối. ctx là context của lời gọi.
func (m *Module) GetObjectDetail(
	ctx context.Context,
	input models.ObjectDetailInput,
) models.Output[models.ObjectDetailOutput] {
	return m.submoduleObjMng.getObjectDetail(ctx, input)
}

// DownloadObject bắt đầu tải input.Objects từ input.Bucket; tiến độ được gửi qua EventDownloadProgressBatch
// và từng file được lưu vào lịch sử tải xuống.
func (m *Module) DownloadObject(input models.DownloadObjInput) models.Output[any] {
	return m.submoduleDownloaderMng.downloadObject(input)
}

// CancelDownloadOne hủy lượt tải xuống đang chạy có ID đã cho.
func (m *Module) CancelDownloadOne(id string) models.Output[any] {
	return m.submoduleDownloaderMng.cancelDownloadOne(id)
}

// CancelAllDownloads hủy tất cả lượt tải xuống đang chạy.
func (m *Module) CancelAllDownloads() models.Output[any] {
	return m.submoduleDownloaderMng.cancelAllDownloads()
}

// CancelUploadOne hủy lượt tải lên đang chạy có ID đã cho.
// ID không xác định hoặc lượt tải đã hoàn tất sẽ bị bỏ qua.
func (m *Module) CancelUploadOne(id string) models.Output[any] {
	return m.submoduleUploaderMng.cancelUploadOne(id)
}

// CancelAllUploads hủy tất cả lượt tải lên đang chạy.
func (m *Module) CancelAllUploads() models.Output[any] {
	return m.submoduleUploaderMng.cancelAllUploads()
}

// DeleteObject xóa các object trong input.Objects theo từng lô. Key xóa thất bại sẽ được liệt kê trong body nhưng không làm Result thành false.
// ctx là context của lời gọi.
func (m *Module) DeleteObject(
	ctx context.Context,
	input models.DeleteObjInput,
) models.Output[models.DeleteObjOutput] {
	return m.submoduleObjMng.deleteObject(ctx, input)
}

// DeletePrefix xóa mọi object dưới input.Prefix (thư mục, thư mục con và folder marker). Chỉ xóa phiên bản hiện tại.
// Prefix rỗng hoặc "/" sẽ bị từ chối để tránh xóa toàn bộ bucket.
// Key xóa thất bại được tính vào kết quả và giữ lại chi tiết (tối đa maxFailureDetails), nhưng không làm Result thành false.
// ctx là context của lời gọi.
func (m *Module) DeletePrefix(
	ctx context.Context,
	input models.DeletePrefixInput,
) models.Output[models.DeletePrefixOutput] {
	return m.submoduleObjMng.deletePrefix(ctx, input)
}

// GetDownloadHistory trả về lịch sử tải xuống đã lưu theo input.
func (m *Module) GetDownloadHistory(input models.DownloadHistoryInput) models.Output[models.DownloadHistoryOutput] {
	return m.submoduleDownloadHistoryMng.getDownloadHistory(input)
}

// OpenDownloadDest mở vị trí file đã tải xuống tại path bằng trình quản lý file của hệ thống.
func (m *Module) OpenDownloadDest(fileName, path string) models.Output[any] {
	return m.submoduleDownloadHistoryMng.openDownloadDest(fileName, path)
}

// UploadObject bắt đầu tải input.ObjList lên input.Prefix; tiến độ được gửi qua EventUploadProgressBatch.
func (m *Module) UploadObject(input models.UploadObjInput) models.Output[any] {
	return m.submoduleUploaderMng.uploadObject(input)
}

// PickFiles mở hộp thoại hệ thống để chọn file tải lên và trả về các nhóm cùng giới hạn tải lên.
// Nếu người dùng hủy, body không có nhóm nào.
func (m *Module) PickFiles(ctx context.Context) models.Output[models.FilesDroppedOutput] {
	return m.submoduleUploaderMng.pickFiles(ctx)
}

// HandleFilesDropped là listener WindowFilesDropped của cửa sổ. Hàm chuyển tiếp các file được thả đến tab frontend nhận thao tác thả.
func (m *Module) HandleFilesDropped(event *application.WindowEvent) {
	m.submoduleUploaderMng.handleFilesDropped(event)
}
