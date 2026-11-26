package bucket

import (
	"S3Browser/internal/modules/global"
	"S3Browser/internal/pkg/cnst"
	"S3Browser/models"
	"context"
	"errors"
	"math"
	"time"
)

// transferExpiryWarn là khoảng thời gian còn lại trước khi hết hạn để cảnh báo khi lượt truyền dùng thông tin xác thực không thể gia hạn.
const transferExpiryWarn = 15 * time.Minute

// withCallContext tạo context dẫn xuất cho một lời gọi Wails. Context chỉ kết thúc khi frontend hủy lời gọi;
// Wails tách context này khỏi vòng đời ứng dụng nên hàm cũng dừng theo appCtx (ứng dụng tắt) và, nếu timeout > 0,
// khi hết timeout để endpoint bị treo không chặn mãi. Cần defer hàm cancel trả về để giải phóng bộ hẹn giờ và watcher appCtx.
func withCallContext(ctx, appCtx context.Context, timeout time.Duration) (context.Context, context.CancelFunc) {
	var cancel context.CancelFunc
	if timeout > 0 {
		ctx, cancel = context.WithTimeout(ctx, timeout)
	} else {
		ctx, cancel = context.WithCancel(ctx)
	}
	stop := context.AfterFunc(appCtx, cancel)

	return ctx, func() {
		stop()
		cancel()
	}
}

// isCallCanceled cho biết frontend có hủy lời gọi hay không. Khi đó không còn bên nào chờ kết quả,
// nên bên gọi trả Result=false mà không gửi thông báo. Timeout không phải thao tác hủy và vẫn được báo.
func isCallCanceled(ctx context.Context) bool {
	return errors.Is(ctx.Err(), context.Canceled)
}

// statusCode trả mã HTTP từ phản hồi máy chủ trong err hoặc 0 nếu err không có (lỗi mạng, timeout).
func statusCode(err error) int {
	var httpErr interface{ HTTPStatusCode() int }
	if errors.As(err, &httpErr) {
		return httpErr.HTTPStatusCode()
	}
	return 0
}

// notConnectedMessage tạo thông báo S3E006 cho connection id không có trong kho dùng chung.
func notConnectedMessage(profileName string) models.Message {
	return models.NewParamsMessage(cnst.MessageTypeError, cnst.Bucket, S3E006, "", map[string]any{
		"name": profileName,
	})
}

// isCredentialsExpired cho biết err có nghĩa là thông tin xác thực đã hết hạn hay không: máy chủ từ chối token hết hạn,
// hoặc phiên MFA/OIDC cần mã hay thao tác đăng nhập mà ứng dụng không còn.
func isCredentialsExpired(err error) bool {
	if errors.Is(err, errMFACodeRequired) || errors.Is(err, errOidcLoginRequired) {
		return true
	}
	switch UnwrapAwsError(err) {
	case "ExpiredToken", "ExpiredTokenException", "RequestExpired":
		return true
	}
	return false
}

// expiredMessage tạo thông báo S3E030 cho tên hồ sơ.
func expiredMessage(profileName string, err error) models.Message {
	return models.NewParamsMessage(cnst.MessageTypeError, cnst.Bucket, S3E030, UnwrapAwsError(err), map[string]any{
		"name": profileName,
	})
}

// failCall kết thúc lời gọi S3 thất bại của hồ sơ: dừng im lặng nếu frontend đã hủy, dùng S3E030 nếu thông tin xác thực
// hết hạn, nếu không thì dùng thông báo lỗi tương ứng.
func failCall[T any](
	ctx context.Context,
	output models.Output[T],
	profileName string,
	err error,
	failed models.Message,
) models.Output[T] {
	switch {
	case isCallCanceled(ctx):
		return output.ThrowError()
	case isCredentialsExpired(err):
		return output.ThrowError(expiredMessage(profileName, err))
	}
	return output.ThrowError(failed)
}

// transferExpiryWarning trả cảnh báo S3W008 nếu lượt truyền bắt đầu bằng thông tin xác thực không thể gia hạn
// và sẽ hết hạn trong transferExpiryWarn; không trả gì nếu thông tin xác thực vẫn ổn hoặc c là nil.
func transferExpiryWarning(c *global.S3Conn, profileName string) []models.Message {
	left, ok := c.ExpiresIn(transferExpiryWarn)
	if !ok {
		return nil
	}
	minutes := int(math.Ceil(left.Minutes()))
	return []models.Message{
		models.NewParamsMessage(cnst.MessageTypeWarn, cnst.Bucket, S3W008, "", map[string]any{
			"name":    profileName,
			"minutes": minutes,
		}),
	}
}
