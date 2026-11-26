package bucket

import (
	"S3Browser/internal/pkg/cnst"
	"S3Browser/models"
	"context"
	"errors"
	"slices"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/smithy-go"
	"golang.org/x/sync/errgroup"
)

const (
	// deleteTimeout giới hạn thời gian của một lần gọi deleteObject hoặc deletePrefix. Mỗi thao tác có thể xóa nhiều key
	// theo từng lô nên cần nhiều thời gian hơn một yêu cầu đơn lẻ.
	deleteTimeout = 30 * time.Minute
	// deleteBatchSize là giới hạn số key trong một yêu cầu DeleteObjects của S3. Giá trị này cũng là kích thước trang
	// ListObjectsV2 để giới hạn bộ nhớ và ánh xạ mỗi trang thành một yêu cầu xóa.
	deleteBatchSize = 1000
	// maxFailureDetails giới hạn số lỗi được giữ lại cho một thư mục có thể chứa hàng triệu key.
	maxFailureDetails = 1000
)

// validDeletePrefix cho biết có thể xóa prefix hay không: prefix phải là tên thư mục
// (kết thúc bằng "/") và không được rỗng hoặc là "/" để tránh xóa cả bucket.
func validDeletePrefix(prefix string) bool {
	return strings.Trim(prefix, "/") != "" && strings.HasSuffix(prefix, "/")
}

// isDeleteObjectsUnsupported cho biết provider có hỗ trợ DeleteObjects hay không.
func isDeleteObjectsUnsupported(err error) bool {
	var apiErr smithy.APIError
	if !errors.As(err, &apiErr) {
		return false
	}
	switch apiErr.ErrorCode() {
	case "NotImplemented", "MissingContentMD5", "XNotImplemented", "MissingChecksum":
		return true
	}
	return false
}

// batchDeleter xóa key theo từng lô và ghi nhận kết quả. Được dùng bởi deleteObject, deletePrefix và deleteBucket
// (thao tác xóa theo phiên bản).
type batchDeleter struct {
	client  *s3.Client
	bucket  string
	deleted int
	failed  int
	// deletedKeys liệt kê các key đã xóa khi bật collectDeleted.
	deletedKeys    []string
	collectDeleted bool
	// failures lưu chi tiết của maxDetails lỗi đầu tiên; failed đếm tổng số lỗi.
	failures   []models.DeleteFailure
	maxDetails int
	// single được bật nếu provider từ chối DeleteObjects.
	single bool
	// optFns được truyền vào mọi yêu cầu, ví dụ để đặt region của bucket.
	optFns []func(*s3.Options)
}

// ok ghi nhận một key đã xóa.
func (d *batchDeleter) ok(key string) {
	d.deleted++
	if d.collectDeleted {
		d.deletedKeys = append(d.deletedKeys, key)
	}
}

// fail ghi nhận một key xóa thất bại và giữ chi tiết nếu chưa vượt maxDetails.
func (d *batchDeleter) fail(key, detail string) {
	d.failed++
	if len(d.failures) < d.maxDetails {
		d.failures = append(d.failures, models.DeleteFailure{Key: key, Error: detail})
	}
}

// failID tương tự fail nhưng dành cho định danh object: nếu có, version id được thêm vào chi tiết lỗi.
func (d *batchDeleter) failID(id types.ObjectIdentifier, detail string) {
	if id.VersionId != nil {
		detail += " (versionId " + *id.VersionId + ")"
	}
	d.fail(aws.ToString(id.Key), detail)
}

// failedIndex tìm định danh trong lô mà lỗi DeleteObjects đề cập, bỏ qua các định danh đã khớp. Lỗi không có version id
// sẽ khớp với một định danh chưa khớp có cùng key. Trả về -1 nếu không tìm thấy mục phù hợp.
func failedIndex(ids []types.ObjectIdentifier, matched []bool, failed types.ObjectIdentifier) int {
	for i, id := range ids {
		if matched[i] || aws.ToString(id.Key) != aws.ToString(failed.Key) {
			continue
		}
		if failed.VersionId == nil || aws.ToString(id.VersionId) == *failed.VersionId {
			return i
		}
	}
	return -1
}

// deleteBatch xóa phiên bản hiện tại của các key (tối đa deleteBatchSize). Lỗi trả về là lỗi cấp lời gọi
// (context bị hủy hoặc thông tin xác thực hết hạn trước khi xóa key nào); lỗi riêng từng key được ghi bằng d.fail.
func (d *batchDeleter) deleteBatch(ctx context.Context, keys []string) error {
	ids := make([]types.ObjectIdentifier, len(keys))
	for i, k := range keys {
		ids[i] = types.ObjectIdentifier{Key: aws.String(k)}
	}
	return d.deleteIDs(ctx, ids)
}

// deleteIDs là deleteBatch dành cho định danh object, có thể bao gồm version id.
func (d *batchDeleter) deleteIDs(ctx context.Context, ids []types.ObjectIdentifier) error {
	if len(ids) == 0 {
		return nil
	}

	if !d.single {
		out, err := d.client.DeleteObjects(ctx, &s3.DeleteObjectsInput{
			Bucket: aws.String(d.bucket),
			Delete: &types.Delete{Objects: ids, Quiet: aws.Bool(true)},
		}, d.optFns...)
		switch {
		case err == nil:
			// Chế độ im lặng: kết quả chỉ liệt kê các object xóa thất bại.
			bad := make([]bool, len(ids))
			for _, e := range out.Errors {
				id := types.ObjectIdentifier{Key: e.Key, VersionId: e.VersionId}
				if i := failedIndex(ids, bad, id); i >= 0 {
					bad[i] = true
				}
				d.failID(id, strings.TrimSpace(aws.ToString(e.Code)+" "+aws.ToString(e.Message)))
			}
			for i, id := range ids {
				if !bad[i] {
					d.ok(aws.ToString(id.Key))
				}
			}
			return nil
		case ctx.Err() != nil:
			return ctx.Err()
		case isDeleteObjectsUnsupported(err):
			d.single = true
		default:
			if d.deleted == 0 && isCredentialsExpired(err) {
				return err
			}
			// Bản thân yêu cầu đã thất bại: không xác định được object nào đã bị xóa.
			for _, id := range ids {
				d.failID(id, UnwrapAwsError(err))
			}
			return nil
		}
	}

	return d.deleteEach(ctx, ids)
}

// deleteEach là phương án thay thế cho provider không hỗ trợ DeleteObjects: gọi DeleteObject riêng cho từng object.
func (d *batchDeleter) deleteEach(ctx context.Context, ids []types.ObjectIdentifier) error {
	errs := make([]error, len(ids))
	var g errgroup.Group
	// Không dùng errgroup.WithContext: mỗi lỗi được ghi riêng theo object trong errs và g.Go trả nil,
	// nhờ đó lỗi của một object không hủy các thao tác xóa còn lại trong lô.
	g.SetLimit(deleteConcurrency)
	for i, id := range ids {
		g.Go(func() error {
			_, errs[i] = d.client.DeleteObject(ctx, &s3.DeleteObjectInput{
				Bucket:    aws.String(d.bucket),
				Key:       id.Key,
				VersionId: id.VersionId,
			}, d.optFns...)
			return nil
		})
	}
	_ = g.Wait()

	if ctx.Err() != nil {
		return ctx.Err()
	}
	// Chưa xóa được gì và mọi object trong lô đều thất bại: thông tin xác thực hết hạn là lỗi cấp lời gọi.
	if d.deleted == 0 && !slices.Contains(errs, nil) {
		if i := slices.IndexFunc(errs, isCredentialsExpired); i >= 0 {
			return errs[i]
		}
	}
	for i, err := range errs {
		if err != nil {
			d.failID(ids[i], UnwrapAwsError(err))
		} else {
			d.ok(aws.ToString(ids[i].Key))
		}
	}
	return nil
}

// deletePrefix xóa mọi object phiên bản hiện tại dưới input.Prefix, lần lượt theo trang.
// ctx là context của lời gọi; frontend sẽ hủy context khi người dùng hủy lời gọi.
// Key xóa thất bại không làm Result thành false: body đếm số lỗi và giữ chi tiết của maxFailureDetails lỗi đầu tiên.
func (m *submoduleObjMng) deletePrefix(
	ctx context.Context,
	input models.DeletePrefixInput,
) models.Output[models.DeletePrefixOutput] {
	ctx, cancel := withCallContext(ctx, m.app.Context(), deleteTimeout)
	defer cancel()

	output := models.NewOutput[models.DeletePrefixOutput]()

	if !validDeletePrefix(input.Prefix) {
		return output.ThrowError(
			models.NewParamsMessage(cnst.MessageTypeError, cnst.Bucket, S3E020, "", map[string]any{
				"prefix": input.Prefix,
			}),
		)
	}

	s3Conn, ok := m.global.GetConnContainer(input.ConnectionId)
	if !ok {
		return output.ThrowError(notConnectedMessage(input.ProfileName))
	}
	client := s3Conn.Client

	d := &batchDeleter{
		client:     client,
		bucket:     input.Bucket,
		maxDetails: maxFailureDetails,
		failures:   []models.DeleteFailure{},
	}
	var callErr error
	var token *string

	for {
			// Không dùng Delimiter: liệt kê mọi key dưới prefix, kể cả dấu thư mục.
		page, err := client.ListObjectsV2(ctx, &s3.ListObjectsV2Input{
			Bucket:            aws.String(input.Bucket),
			Prefix:            aws.String(input.Prefix),
			MaxKeys:           aws.Int32(deleteBatchSize),
			ContinuationToken: token,
		})
		if err != nil {
			callErr = err
			break
		}

		keys := make([]string, 0, len(page.Contents))
		for _, o := range page.Contents {
			if k := aws.ToString(o.Key); k != "" {
				keys = append(keys, k)
			}
		}
		if callErr = d.deleteBatch(ctx, keys); callErr != nil {
			break
		}

		if !aws.ToBool(page.IsTruncated) || aws.ToString(page.NextContinuationToken) == "" {
			break
		}
		token = page.NextContinuationToken
	}

	if callErr != nil {
		if isCallCanceled(ctx) {
			m.logger.Info("delete prefix canceled",
				"bucket", input.Bucket, "prefix", input.Prefix, "deleted", d.deleted)
			// Frontend đã hủy: dừng im lặng vì không còn bên nào chờ kết quả.
			return output.ThrowError()
		}
		if d.deleted == 0 && isCredentialsExpired(callErr) {
			return output.ThrowError(expiredMessage(input.ProfileName, callErr))
		}
		d.fail(input.Prefix, UnwrapAwsError(callErr))
	}

	if d.failed > 0 {
		m.logger.Error("delete prefix failed", "bucket", input.Bucket, "prefix", input.Prefix,
			"deleted", d.deleted, "failed", d.failed)
	} else {
		m.logger.Info("delete prefix done", "bucket", input.Bucket, "prefix", input.Prefix, "deleted", d.deleted)
	}
	output.Body = models.DeletePrefixOutput{Deleted: d.deleted, Failed: d.failed, Failures: d.failures}
	return output
}
