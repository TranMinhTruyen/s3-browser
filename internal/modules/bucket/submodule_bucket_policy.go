package bucket

import (
	"S3Browser/internal/modules/global"
	"S3Browser/internal/pkg/cnst"
	"S3Browser/models"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"reflect"
	"slices"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/minio/madmin-go/v4"
	"github.com/minio/pkg/v3/policy"
)

// Các chế độ truy cập của bucket.
const (
	policyModePrivate = "private"
	policyModePublic  = "public"
	policyModeCustom  = "custom"
	// policyModeUnknown là bucket không đọc được policy (không có quyền, không được hỗ trợ, ...).
	policyModeUnknown = "unknown"
)

// getBucketPolicy đọc trạng thái truy cập của input.Bucket (timeout 10 giây).
func (m *submoduleBucketEditMng) getBucketPolicy(
	ctx context.Context,
	input models.BucketPolicyInput,
) models.Output[models.BucketPolicyOutput] {
	ctx, cancel := withCallContext(ctx, m.app.Context(), 10*time.Second)
	defer cancel()

	output := models.NewOutput[models.BucketPolicyOutput]()

	conn, ok := m.global.GetConnContainer(input.ConnectionId)
	if !ok {
		return output.ThrowError(notConnectedMessage(input.ProfileName))
	}
	if conn.AuthType == cnst.AuthAnonymous {
		return output.ThrowError(anonymousEditMessage())
	}

	state, err := m.loadPolicyState(ctx, conn, input.Bucket, policyOptFns(ctx, conn, input.Bucket))
	if err != nil {
		m.logger.Error("get bucket policy failed", slog.String("bucket", input.Bucket), slog.Any("error", err))
		return bucketEditFailed(ctx, output, input.ProfileName, input.Bucket, err, S3E055)
	}
	state.EditDenied = policyEditDenied(ctx, conn, input.Bucket)

	output.Body = state
	return output
}

// putBucketPolicy đặt chế độ truy cập của input.Bucket (timeout 30 giây) rồi trả trạng thái đọc lại.
func (m *submoduleBucketEditMng) putBucketPolicy(
	ctx context.Context,
	input models.PutBucketPolicyInput,
) models.Output[models.BucketPolicyOutput] {
	ctx, cancel := withCallContext(ctx, m.app.Context(), 30*time.Second)
	defer cancel()

	output := models.NewOutput[models.BucketPolicyOutput]()

	conn, ok := m.global.GetConnContainer(input.ConnectionId)
	if !ok {
		return output.ThrowError(notConnectedMessage(input.ProfileName))
	}
	if conn.AuthType == cnst.AuthAnonymous {
		return output.ThrowError(anonymousEditMessage())
	}

	switch validPolicyMode(input.Mode, input.Policy) {
	case errInvalidMode:
		return output.ThrowError(bucketMessage(cnst.MessageTypeError, S3E056, input.Bucket, "invalid mode"))
	case errInvalidPolicy:
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Bucket, S3E057, ""))
	}
	optFns := policyOptFns(ctx, conn, input.Bucket)
	if err := applyBucketPolicy(ctx, conn, input.Bucket, input.Mode, input.Policy, optFns...); err != nil {
		m.logger.Error("put bucket policy failed", slog.String("bucket", input.Bucket), slog.Any("error", err))
		return putPolicyFailed(ctx, conn, output, input, err, optFns)
	}

	conn.Access.Reset()
	state, err := m.loadPolicyState(ctx, conn, input.Bucket, optFns)
	if err != nil {
		// Đã lưu, chỉ bước đọc lại thất bại: hiển thị chế độ được yêu cầu.
		m.logger.Warn("read back bucket policy failed", slog.String("bucket", input.Bucket), slog.Any("error", err))
		state = models.BucketPolicyOutput{Mode: input.Mode, Policy: input.Policy}
	}
	state.EditDenied = policyEditDenied(ctx, conn, input.Bucket)

	output.Body = state
	return *output.AddMessage(bucketMessage(cnst.MessageTypeSuccess, S3S008, input.Bucket, ""))
}

var (
	errInvalidMode   = errors.New("invalid policy mode")
	errInvalidPolicy = errors.New("invalid policy json")
)

// validPolicyMode kiểm tra mode và, với custom, xác nhận policy là JSON. Hàm trả nil, errInvalidMode hoặc errInvalidPolicy.
func validPolicyMode(mode, pol string) error {
	switch mode {
	case policyModePrivate, policyModePublic:
		return nil
	case policyModeCustom:
		if !json.Valid([]byte(pol)) {
			return errInvalidPolicy
		}
		return nil
	}
	return errInvalidMode
}

// applyBucketPolicy đặt chế độ truy cập cho bucket: private xóa policy, còn public và custom sẽ ghi policy.
// Mode phải được validPolicyMode xác nhận trước.
func applyBucketPolicy(
	ctx context.Context,
	conn *global.S3Conn,
	bucket, mode, pol string,
	optFns ...func(*s3.Options),
) error {
	var err error
	switch mode {
	case policyModePrivate:
		_, err = conn.Client.DeleteBucketPolicy(ctx, &s3.DeleteBucketPolicyInput{Bucket: &bucket}, optFns...)
	case policyModePublic:
		_, err = conn.Client.PutBucketPolicy(ctx, &s3.PutBucketPolicyInput{
			Bucket: &bucket,
			Policy: aws.String(publicReadPolicy(bucket)),
		}, optFns...)
	case policyModeCustom:
		_, err = conn.Client.PutBucketPolicy(ctx, &s3.PutBucketPolicyInput{Bucket: &bucket, Policy: &pol}, optFns...)
	}
	return err
}

// policyOptFns gửi yêu cầu policy trên AWS thật đến region của bucket. Với máy chủ khác hoặc khi không đọc được region,
// hàm trả nil và dùng region của kết nối.
func policyOptFns(ctx context.Context, conn *global.S3Conn, bucket string) []func(*s3.Options) {
	if !isRealAws(conn) {
		return nil
	}
	region, err := readBucketRegion(ctx, conn, bucket)
	if err != nil {
		return nil
	}
	return regionOptFns(conn, region)
}

// readPolicyModeInRegion đọc chế độ truy cập của bucket để hiển thị huy hiệu. Với AWS thật, trước tiên hỏi region của
// kết nối; chỉ khi phản hồi cho biết bucket nằm ở region khác (isWrongRegion) mới đọc region của bucket và hỏi lại.
// Nhờ đó bucket cùng region với kết nối chỉ cần một yêu cầu thay vì hai.
func readPolicyModeInRegion(ctx context.Context, conn *global.S3Conn, bucket string) (string, error) {
	mode, _, err := readPolicyMode(ctx, conn, bucket)
	if err == nil || !isRealAws(conn) || !isWrongRegion(err) {
		return mode, err
	}
	region, err := readBucketRegion(ctx, conn, bucket)
	if err != nil {
		return "", err
	}
	mode, _, err = readPolicyMode(ctx, conn, bucket, regionOptFns(conn, region)...)
	return mode, err
}

// isWrongRegion cho biết err có báo yêu cầu được gửi đến region khác với region của bucket hay không.
func isWrongRegion(err error) bool {
	if statusCode(err) == http.StatusMovedPermanently {
		return true
	}
	switch UnwrapAwsError(err) {
	case "PermanentRedirect", "AuthorizationHeaderMalformed", "IllegalLocationConstraintException":
		return true
	}
	return false
}

// isSurePolicyError cho biết err có phải phản hồi chắc chắn từ máy chủ rằng không thể đọc policy hay không.
// Kết quả này vẫn đúng cho đến khi thông tin xác thực hoặc bucket thay đổi nên có thể được cache.
func isSurePolicyError(err error) bool {
	switch UnwrapAwsError(err) {
	case "AccessDenied", "NotImplemented", "MethodNotAllowed":
		return true
	}
	return statusCode(err) == http.StatusForbidden
}

// putPolicyFailed ánh xạ lỗi lưu: policy sai định dạng trả S3E057, policy công khai bị Block Public Access từ chối
// trả S3E058; các lỗi khác dùng lỗi chỉnh sửa bucket chung, mặc định là S3E056.
func putPolicyFailed(
	ctx context.Context,
	conn *global.S3Conn,
	output models.Output[models.BucketPolicyOutput],
	input models.PutBucketPolicyInput,
	err error,
	optFns []func(*s3.Options),
) models.Output[models.BucketPolicyOutput] {
	if UnwrapAwsError(err) == "MalformedPolicy" {
		return failCall(ctx, output, input.ProfileName, err,
			models.NewMessage(cnst.MessageTypeError, cnst.Bucket, S3E057, UnwrapAwsError(err)))
	}
	if input.Mode != policyModePrivate && bucketEditCode(err, S3E056) == S3E052 {
		if blocked, _ := readPublicBlocked(ctx, conn, input.Bucket, optFns...); blocked {
			return failCall(ctx, output, input.ProfileName, err,
				bucketMessage(cnst.MessageTypeError, S3E058, input.Bucket, UnwrapAwsError(err)))
		}
	}
	return bucketEditFailed(ctx, output, input.ProfileName, input.Bucket, err, S3E056)
}

// loadPolicyState đọc chế độ, policy và trạng thái Block Public Access của bucket. Chỉ lỗi đọc policy mới làm lời gọi
// thất bại; nếu không đọc được Block Public Access thì xem như không bị chặn.
func (m *submoduleBucketEditMng) loadPolicyState(
	ctx context.Context,
	conn *global.S3Conn,
	bucket string,
	optFns []func(*s3.Options),
) (models.BucketPolicyOutput, error) {
	mode, pol, err := readPolicyMode(ctx, conn, bucket, optFns...)
	if err != nil {
		return models.BucketPolicyOutput{}, err
	}
	blocked, err := readPublicBlocked(ctx, conn, bucket, optFns...)
	if err != nil {
		m.logger.Debug("read public access block failed", slog.String("bucket", bucket), slog.Any("error", err))
	}
	return models.BucketPolicyOutput{Mode: mode, Policy: pol, PublicBlocked: blocked}, nil
}

// readPolicyMode trả chế độ truy cập của bucket và policy JSON (được thụt lề, rỗng nếu ở chế độ private).
func readPolicyMode(
	ctx context.Context,
	conn *global.S3Conn,
	bucket string,
	optFns ...func(*s3.Options),
) (mode, pol string, err error) {
	result, err := conn.Client.GetBucketPolicy(ctx, &s3.GetBucketPolicyInput{Bucket: &bucket}, optFns...)
	if err != nil {
		if UnwrapAwsError(err) == "NoSuchBucketPolicy" {
			return policyModePrivate, "", nil
		}
		return "", "", err
	}

	pol = aws.ToString(result.Policy)
	mode = policyModeCustom
	if samePolicy(pol, publicReadPolicy(bucket)) {
		mode = policyModePublic
	}
	var indented bytes.Buffer
	if json.Indent(&indented, []byte(pol), "", "  ") == nil {
		pol = indented.String()
	}
	return mode, pol, nil
}

// readPublicBlocked cho biết Block Public Access có cấm policy công khai hay không. Chỉ AWS thật có tính năng này.
func readPublicBlocked(
	ctx context.Context,
	conn *global.S3Conn,
	bucket string,
	optFns ...func(*s3.Options),
) (bool, error) {
	if !isRealAws(conn) {
		return false, nil
	}
	result, err := conn.Client.GetPublicAccessBlock(ctx, &s3.GetPublicAccessBlockInput{Bucket: &bucket}, optFns...)
	if err != nil {
		if UnwrapAwsError(err) == "NoSuchPublicAccessBlockConfiguration" {
			return false, nil
		}
		return false, err
	}
	return result.PublicAccessBlockConfiguration != nil &&
		aws.ToBool(result.PublicAccessBlockConfiguration.BlockPublicPolicy), nil
}

// policyEditDenied cho biết tài khoản MinIO có bị xác định là không được phép thay đổi policy của bucket hay không.
// Nếu không có quyền admin, AccountInfo thất bại hoặc policy không đơn giản, hàm trả false.
func policyEditDenied(ctx context.Context, conn *global.S3Conn, bucket string) bool {
	if conn.MinioAdmin == nil {
		return false
	}
	callCtx, cancel := context.WithTimeout(ctx, bucketProbeTimeout)
	defer cancel()
	info, err := conn.MinioAdmin.AccountInfo(callCtx, madmin.AccountOpts{})
	if err != nil {
		return false
	}
	pol, err := policy.ParseConfig(bytes.NewReader(info.Policy))
	if err != nil || !isSimplePolicy(info.Policy) {
		return false
	}
	for _, action := range []policy.Action{policy.PutBucketPolicyAction, policy.DeleteBucketPolicyAction} {
		if !pol.IsAllowed(policy.Args{
			Action:          action,
			BucketName:      bucket,
			ConditionValues: map[string][]string{},
		}) {
			return true
		}
	}
	return false
}

// publicReadPolicy là policy của chế độ "public": mọi người đều có thể liệt kê bucket và đọc object.
func publicReadPolicy(bucket string) string {
	arn := "arn:aws:s3:::" + bucket
	raw, _ := json.Marshal(map[string]any{
		"Version": "2012-10-17",
		"Statement": []map[string]any{
			{
				"Effect":    "Allow",
				"Principal": "*",
				"Action":    []string{"s3:GetBucketLocation", "s3:ListBucket"},
				"Resource":  arn,
			},
			{
				"Effect":    "Allow",
				"Principal": "*",
				"Action":    []string{"s3:GetObject"},
				"Resource":  arn + "/*",
			},
		},
	})
	return string(raw)
}

// samePolicy cho biết a và b có cùng policy hay không, bỏ qua định dạng, thứ tự key và cách biểu diễn chuỗi/mảng
// mà MinIO chuẩn hóa (Principal "*" thành {"AWS":["*"]}, Action và Resource thành danh sách).
func samePolicy(a, b string) bool {
	x, okA := canonicalPolicy(a)
	y, okB := canonicalPolicy(b)
	return okA && okB && reflect.DeepEqual(x, y)
}

// canonicalPolicy phân tích policy, chuyển Principal, Action và Resource của mỗi statement thành danh sách đã sắp xếp,
// rồi sắp xếp cả các statement.
func canonicalPolicy(raw string) (map[string]any, bool) {
	var pol map[string]any
	if json.Unmarshal([]byte(raw), &pol) != nil || pol == nil {
		return nil, false
	}
	statements, ok := pol["Statement"].([]any)
	if !ok {
		if single, isMap := pol["Statement"].(map[string]any); isMap {
			statements = []any{single}
		}
	}
	for _, s := range statements {
		if st, isMap := s.(map[string]any); isMap {
			if principal, found := st["Principal"]; found {
				if p, isStr := principal.(string); isStr {
					principal = map[string]any{"AWS": p}
				}
				if p, isMap := principal.(map[string]any); isMap {
					for k, v := range p {
						p[k] = sortedStrings(v)
					}
				}
				st["Principal"] = principal
			}
			for _, key := range []string{"Action", "Resource"} {
				if v, found := st[key]; found {
					st[key] = sortedStrings(v)
				}
			}
		}
	}
	// json.Marshal sắp xếp các key của map nên statement sau khi marshal có thể dùng làm khóa sắp xếp ổn định.
	slices.SortFunc(statements, func(x, y any) int {
		jx, _ := json.Marshal(x)
		jy, _ := json.Marshal(y)
		return bytes.Compare(jx, jy)
	})
	pol["Statement"] = statements
	return pol, true
}

// sortedStrings chuyển chuỗi JSON hoặc mảng chuỗi thành []any chứa các chuỗi đã sắp xếp.
func sortedStrings(v any) []any {
	items, ok := v.([]any)
	if !ok {
		items = []any{v}
	}
	out := slices.Clone(items)
	slices.SortFunc(out, func(x, y any) int { return strings.Compare(fmt.Sprint(x), fmt.Sprint(y)) })
	return out
}
