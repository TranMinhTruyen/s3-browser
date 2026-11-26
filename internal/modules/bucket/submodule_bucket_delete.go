package bucket

import (
	"S3Browser/internal/modules/global"
	"S3Browser/internal/pkg/cnst"
	"S3Browser/models"
	"cmp"
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"golang.org/x/sync/errgroup"
)

// regionOptFns gửi yêu cầu đến region của bucket; chỉ AWS thật mới cần thiết lập này.
func regionOptFns(conn *global.S3Conn, region string) []func(*s3.Options) {
	if !isRealAws(conn) || region == "" {
		return nil
	}
	return []func(*s3.Options){func(o *s3.Options) { o.Region = region }}
}

// isNotImplemented cho biết máy chủ có trả về NotImplemented hay không.
func isNotImplemented(err error) bool {
	return UnwrapAwsError(err) == "NotImplemented"
}

// deleteCursor duyệt phiên bản và delete marker của bucket lần lượt theo trang. Nếu máy chủ không hỗ trợ
// ListObjectVersions thì dùng ListObjectsV2 thay thế (chỉ lấy object hiện tại).
type deleteCursor struct {
	limit         int32
	keyMarker     *string
	versionMarker *string
	token         *string
	v2            bool
	done          bool
}

// errVersionMarkerStuck cho biết máy chủ báo danh sách phiên bản còn tiếp nhưng không trả marker mới.
var errVersionMarkerStuck = errors.New("ListObjectVersions returned no new marker")

// stuck cho biết các marker tiếp theo không thể đưa cursor tiến lên: cả hai đều thiếu hoặc trùng với marker trước.
func (c *deleteCursor) stuck(keyMarker, versionMarker *string) bool {
	if keyMarker == nil && versionMarker == nil {
		return true
	}
	return aws.ToString(keyMarker) == aws.ToString(c.keyMarker) &&
		aws.ToString(versionMarker) == aws.ToString(c.versionMarker)
}

// nextPage trả về các định danh của trang tiếp theo; done được bật sau khi trả về trang cuối.
func (c *deleteCursor) nextPage(
	ctx context.Context,
	client *s3.Client,
	bucket string,
	optFns []func(*s3.Options),
) ([]types.ObjectIdentifier, error) {
	if !c.v2 {
		page, err := client.ListObjectVersions(ctx, &s3.ListObjectVersionsInput{
			Bucket:          &bucket,
			MaxKeys:         &c.limit,
			KeyMarker:       c.keyMarker,
			VersionIdMarker: c.versionMarker,
		}, optFns...)
		if err == nil {
			ids := make([]types.ObjectIdentifier, 0, len(page.Versions)+len(page.DeleteMarkers))
			for _, v := range page.Versions {
				ids = append(ids, types.ObjectIdentifier{Key: v.Key, VersionId: v.VersionId})
			}
			for _, v := range page.DeleteMarkers {
				ids = append(ids, types.ObjectIdentifier{Key: v.Key, VersionId: v.VersionId})
			}
			c.done = !aws.ToBool(page.IsTruncated)
			if !c.done && c.stuck(page.NextKeyMarker, page.NextVersionIdMarker) {
				return nil, errVersionMarkerStuck
			}
			c.keyMarker, c.versionMarker = page.NextKeyMarker, page.NextVersionIdMarker
			return ids, nil
		}
		if !isNotImplemented(err) {
			return nil, err
		}
		c.v2 = true
	}

	page, err := client.ListObjectsV2(ctx, &s3.ListObjectsV2Input{
		Bucket:            &bucket,
		MaxKeys:           &c.limit,
		ContinuationToken: c.token,
	}, optFns...)
	if err != nil {
		return nil, err
	}
	ids := make([]types.ObjectIdentifier, len(page.Contents))
	for i, o := range page.Contents {
		ids[i] = types.ObjectIdentifier{Key: o.Key}
	}
	c.token = page.NextContinuationToken
	c.done = !aws.ToBool(page.IsTruncated) || c.token == nil
	return ids, nil
}

// getBucketDeleteInfo đọc thông tin hộp thoại xóa cần (timeout 10 giây): bucket có rỗng không, trạng thái versioning
// và Object Lock có bật không. Mục nào không đọc được thì giữ trạng thái chưa xác định (nil, rỗng, false).
func (m *submoduleBucketEditMng) getBucketDeleteInfo(
	ctx context.Context,
	input models.DeleteBucketInput,
) models.Output[models.DeleteBucketInfoOutput] {
	ctx, cancel := withCallContext(ctx, m.app.Context(), 10*time.Second)
	defer cancel()

	output := models.NewOutput[models.DeleteBucketInfoOutput]()

	conn, ok := m.global.GetConnContainer(input.ConnectionId)
	if !ok {
		return output.ThrowError(notConnectedMessage(input.ProfileName))
	}
	if conn.AuthType == cnst.AuthAnonymous {
		return output.ThrowError(anonymousEditMessage())
	}

	notFound := func(err error) models.Output[models.DeleteBucketInfoOutput] {
		return failCall(ctx, output, input.ProfileName, err,
			bucketMessage(cnst.MessageTypeError, S3E059, input.Bucket, UnwrapAwsError(err)))
	}
	region, err := readBucketRegion(ctx, conn, input.Bucket)
	if isFatalDetailError(ctx, err) {
		return notFound(err)
	}
	optFns := regionOptFns(conn, region)

	body := &output.Body
	var errs [3]error
	var g errgroup.Group
	g.Go(func() error {
		result, err := conn.Client.GetBucketVersioning(
			ctx, &s3.GetBucketVersioningInput{Bucket: &input.Bucket}, optFns...)
		if errs[0] = err; err == nil {
			body.Versioning = cmp.Or(string(result.Status), "Off")
		}
		return nil
	})
	g.Go(func() error {
		lock, err := readObjectLock(ctx, conn, input.Bucket, optFns)
		errs[1] = err
		body.ObjectLock = strings.HasPrefix(lock, "Enabled")
		return nil
	})
	g.Go(func() error {
		cursor := deleteCursor{limit: 1}
		ids, err := cursor.nextPage(ctx, conn.Client, input.Bucket, optFns)
		if errs[2] = err; err == nil {
			body.Empty = aws.Bool(len(ids) == 0)
		}
		return nil
	})
	_ = g.Wait()

	for _, err := range errs {
		if isFatalDetailError(ctx, err) {
			return notFound(err)
		}
		if err != nil {
			m.logger.Debug("read bucket delete info item failed",
				slog.String("bucket", input.Bucket), slog.Any("error", err))
		}
	}
	return output
}

// deleteBucket xóa input.Bucket sau khi xóa mọi object, phiên bản và delete marker bên trong (timeout 30 phút).
// Kiểm tra Object Lock trước khi xóa object: bucket không rỗng và bật Object Lock (hoặc không đọc được trạng thái
// Object Lock) sẽ được giữ nguyên. Dừng ở lô đầu tiên có key xóa thất bại và không xóa bucket sau đó.
func (m *submoduleBucketEditMng) deleteBucket(
	ctx context.Context,
	input models.DeleteBucketInput,
) models.Output[models.DeleteBucketOutput] {
	ctx, cancel := withCallContext(ctx, m.app.Context(), deleteTimeout)
	defer cancel()

	output := models.NewOutput[models.DeleteBucketOutput]()

	conn, ok := m.global.GetConnContainer(input.ConnectionId)
	if !ok {
		return output.ThrowError(notConnectedMessage(input.ProfileName))
	}
	if conn.AuthType == cnst.AuthAnonymous {
		return output.ThrowError(anonymousEditMessage())
	}

	region, err := readBucketRegion(ctx, conn, input.Bucket)
	if isFatalDetailError(ctx, err) {
		return deleteBucketFailed(ctx, output, input, err, false)
	}
	optFns := regionOptFns(conn, region)

	lock, lockErr := readObjectLock(ctx, conn, input.Bucket, optFns)
	if isFatalDetailError(ctx, lockErr) {
		return deleteBucketFailed(ctx, output, input, lockErr, false)
	}
	if isNotImplemented(lockErr) {
		lock, lockErr = "Disabled", nil
	}

	d := &batchDeleter{
		client:     conn.Client,
		bucket:     input.Bucket,
		maxDetails: maxFailureDetails,
		failures:   []models.DeleteFailure{},
		optFns:     optFns,
	}
	stop, legacyList, err := emptyBucket(ctx, d, lock, lockErr)
	output.Body = models.DeleteBucketOutput{Deleted: d.deleted, Failed: d.failed, Failures: d.failures}
	switch {
	case err != nil:
		return deleteBucketFailed(ctx, output, input, err, false)
	case stop != nil:
		m.logger.Error("delete bucket stopped",
			slog.String("bucket", input.Bucket), "deleted", d.deleted, "failed", d.failed)
		return output.ThrowError(*stop)
	}

	if _, err := conn.Client.DeleteBucket(ctx, &s3.DeleteBucketInput{Bucket: &input.Bucket}, optFns...); err != nil {
		m.logger.Error("delete bucket failed", slog.String("bucket", input.Bucket), slog.Any("error", err))
		return deleteBucketFailed(ctx, output, input, err, legacyList)
	}

	m.logger.Info("delete bucket done", slog.String("bucket", input.Bucket), "deleted", d.deleted)
	conn.Access.Reset()
	output.Body.BucketDeleted = true
	return *output.AddMessage(bucketMessage(cnst.MessageTypeSuccess, S3S009, input.Bucket, ""))
}

// emptyBucket dùng d để xóa mọi phiên bản và delete marker. Hàm trả thông báo cần dừng khi chủ động ngừng
// (Object Lock hoặc key xóa thất bại), hoặc trả lỗi khi một lời gọi thất bại. lock và lockErr là kết quả của
// readObjectLock; chỉ cần xét chúng nếu bucket không rỗng. legacyList được bật nếu máy chủ không liệt kê được phiên bản
// và chỉ xóa được các object hiện tại.
func emptyBucket(
	ctx context.Context,
	d *batchDeleter,
	lock string,
	lockErr error,
) (stop *models.Message, legacyList bool, err error) {
	cursor := deleteCursor{limit: deleteBatchSize}
	checkedLock := false
	for !cursor.done {
		ids, err := cursor.nextPage(ctx, d.client, d.bucket, d.optFns)
		if err != nil {
			return nil, cursor.v2, err
		}
		if len(ids) > 0 && !checkedLock {
			checkedLock = true
			switch {
			case lockErr != nil:
				msg := bucketMessage(cnst.MessageTypeError, S3E060, d.bucket, UnwrapAwsError(lockErr))
				return &msg, cursor.v2, nil
			case strings.HasPrefix(lock, "Enabled"):
				msg := bucketMessage(cnst.MessageTypeError, S3E063, d.bucket, "")
				return &msg, cursor.v2, nil
			}
		}
		if err := d.deleteIDs(ctx, ids); err != nil {
			return nil, cursor.v2, err
		}
		if d.failed > 0 {
			msg := models.NewParamsMessage(cnst.MessageTypeError, cnst.Bucket, S3E062, "", map[string]any{
				"bucket": d.bucket,
				"failed": d.failed,
			})
			return &msg, cursor.v2, nil
		}
	}
	return nil, cursor.v2, nil
}

// deleteBucketFailed kết thúc thao tác xóa bucket thất bại bằng thông báo tương ứng: BucketNotEmpty dùng S3E061,
// NoSuchBucket dùng S3E059, bị từ chối dùng S3E052, các lỗi khác dùng S3E060. Nếu bật legacyList vì chỉ liệt kê được
// object hiện tại thì BucketNotEmpty nghĩa là còn phiên bản cũ và dùng S3E064.
func deleteBucketFailed(
	ctx context.Context,
	output models.Output[models.DeleteBucketOutput],
	input models.DeleteBucketInput,
	err error,
	legacyList bool,
) models.Output[models.DeleteBucketOutput] {
	code := ""
	switch UnwrapAwsError(err) {
	case "BucketNotEmpty":
		code = cmp.Or(map[bool]string{true: S3E064}[legacyList], S3E061)
	case "NoSuchBucket":
		code = S3E059
	default:
		return bucketEditFailed(ctx, output, input.ProfileName, input.Bucket, err, S3E060)
	}
	return failCall(ctx, output, input.ProfileName, err,
		bucketMessage(cnst.MessageTypeError, code, input.Bucket, UnwrapAwsError(err)))
}
