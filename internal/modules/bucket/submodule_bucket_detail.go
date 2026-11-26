package bucket

import (
	"S3Browser/internal/modules/global"
	"S3Browser/internal/pkg/cnst"
	"S3Browser/models"
	"cmp"
	"context"
	"fmt"
	"log/slog"
	"net/url"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"golang.org/x/sync/errgroup"
)

const (
	// detailConcurrency là số trường thông tin chi tiết của một bucket tối đa được đọc cùng lúc.
	detailConcurrency = 8
	// rootCountMaxPages giới hạn số trang được đếm ở gốc bucket: 10 trang, mỗi trang 1000 mục = 10.000 mục.
	rootCountMaxPages = 10
)

// getBucketDetail đọc thông tin chi tiết của input.Bucket (timeout 10 giây). Mỗi mục được đọc riêng; mục nào thất bại
// (bị từ chối, không hỗ trợ, timeout) sẽ giữ nil. Chỉ lời gọi bị hủy, thông tin xác thực hết hạn hoặc bucket không tồn tại
// mới làm cả lời gọi thất bại. Cho phép kết nối ẩn danh; mục nào không đọc được sẽ giữ nil.
func (m *submoduleBucketEditMng) getBucketDetail(
	ctx context.Context,
	input models.BucketDetailInput,
) models.Output[models.BucketDetailOutput] {
	ctx, cancel := withCallContext(ctx, m.app.Context(), 10*time.Second)
	defer cancel()

	output := models.NewOutput[models.BucketDetailOutput]()

	conn, ok := m.global.GetConnContainer(input.ConnectionId)
	if !ok {
		return output.ThrowError(notConnectedMessage(input.ProfileName))
	}

	// Bucket ở region khác sẽ trả 301 cho các yêu cầu còn lại, vì vậy cần hỏi vị trí trước.
	region, err := readBucketRegion(ctx, conn, input.Bucket)
	if isFatalDetailError(ctx, err) {
		return failCall(ctx, output, input.ProfileName, err,
			bucketMessage(cnst.MessageTypeError, S3E059, input.Bucket, UnwrapAwsError(err)))
	}
	var optFns []func(*s3.Options)
	if isRealAws(conn) && region != "" {
		optFns = append(optFns, func(o *s3.Options) { o.Region = region })
	}

	body := &output.Body
	body.Arn = "arn:aws:s3:::" + input.Bucket
	body.EndpointUrl = bucketEndpointUrl(conn, input.Bucket, region)
	if region != "" {
		body.Region = &region
	}

	reads := m.detailReads(ctx, conn, input.Bucket, body, optFns)
	errs := make([]error, len(reads))
	var g errgroup.Group
	g.SetLimit(detailConcurrency)
	for i, read := range reads {
		g.Go(func() error {
			errs[i] = read()
			return nil
		})
	}
	_ = g.Wait()

	for _, err := range errs {
		if isFatalDetailError(ctx, err) {
			return failCall(ctx, output, input.ProfileName, err,
				bucketMessage(cnst.MessageTypeError, S3E059, input.Bucket, UnwrapAwsError(err)))
		}
		if err != nil {
			m.logger.Debug("read bucket detail item failed",
				slog.String("bucket", input.Bucket), slog.Any("error", err))
		}
	}
	return output
}

// detailReads liệt kê các thao tác đọc thông tin bucket; mỗi thao tác điền một trường riêng trong body nên có thể chạy
// song song. Nếu có lỗi, trường tương ứng sẽ giữ nil.
func (m *submoduleBucketEditMng) detailReads(
	ctx context.Context,
	conn *global.S3Conn,
	bucket string,
	body *models.BucketDetailOutput,
	optFns []func(*s3.Options),
) []func() error {
	reads := []func() error{
		func() error {
			mode, _, err := readPolicyMode(ctx, conn, bucket, optFns...)
			if err == nil {
				body.PolicyMode = &mode
			}
			return err
		},
		func() error {
			result, err := conn.Client.GetBucketVersioning(
				ctx, &s3.GetBucketVersioningInput{Bucket: &bucket}, optFns...)
			if err == nil {
				body.Versioning = aws.String(cmp.Or(string(result.Status), "Off"))
			}
			return err
		},
		func() error {
			encryption, err := readEncryption(ctx, conn, bucket, optFns)
			if err == nil {
				body.Encryption = &encryption
			}
			return err
		},
		func() error {
			lock, err := readObjectLock(ctx, conn, bucket, optFns)
			if err == nil {
				body.ObjectLock = &lock
			}
			return err
		},
		func() error {
			tags, err := readTags(ctx, conn, bucket, optFns)
			if err == nil {
				body.Tags = &tags
			}
			return err
		},
		func() error {
			count, capped, err := countRoot(ctx, conn, bucket, optFns)
			if err == nil {
				body.RootCount, body.RootCountCapped = &count, capped
			}
			return err
		},
	}
	if isRealAws(conn) {
		reads = append(reads, func() error {
			blocked, err := readPublicBlocked(ctx, conn, bucket, optFns...)
			if err == nil {
				body.PublicBlocked = &blocked
			}
			return err
		})
	}
	return reads
}

// isFatalDetailError cho biết err có làm thất bại toàn bộ thao tác đọc chi tiết hay không: lời gọi bị hủy,
// thông tin xác thực hết hạn hoặc bucket không tồn tại.
func isFatalDetailError(ctx context.Context, err error) bool {
	return err != nil &&
		(isCallCanceled(ctx) || isCredentialsExpired(err) || UnwrapAwsError(err) == "NoSuchBucket")
}

// readBucketRegion trả về region của bucket. Trên AWS, location rỗng nghĩa là us-east-1; các máy chủ khác không có
// câu trả lời sẽ giữ giá trị rỗng.
func readBucketRegion(ctx context.Context, conn *global.S3Conn, bucket string) (string, error) {
	result, err := conn.Client.GetBucketLocation(ctx, &s3.GetBucketLocationInput{Bucket: &bucket})
	if err != nil {
		return "", err
	}
	switch region := string(result.LocationConstraint); {
	case region == string(types.BucketLocationConstraintEu):
		return "eu-west-1", nil
	case region == "" && isRealAws(conn):
		return defaultBucketRegion, nil
	default:
		return region, nil
	}
}

// bucketEndpointUrl là URL của bucket: dùng virtual-hosted trên AWS; với endpoint tùy chỉnh, dùng path style hoặc
// virtual-hosted tùy theo tùy chọn client.
func bucketEndpointUrl(conn *global.S3Conn, bucket, region string) string {
	opts := conn.Client.Options()
	if aws.ToString(opts.BaseEndpoint) == "" {
		return fmt.Sprintf("https://%s.s3.%s.amazonaws.com", bucket, cmp.Or(region, opts.Region))
	}
	base := normalizeEndpoint(aws.ToString(opts.BaseEndpoint))
	u, err := url.Parse(base)
	if opts.UsePathStyle || err != nil || u.Host == "" {
		return strings.TrimRight(base, "/") + "/" + bucket
	}
	return u.Scheme + "://" + bucket + "." + u.Host
}

// readEncryption trả về mã hóa mặc định: thuật toán (kèm id khóa KMS nếu có) hoặc "None".
func readEncryption(
	ctx context.Context,
	conn *global.S3Conn,
	bucket string,
	optFns []func(*s3.Options),
) (string, error) {
	result, err := conn.Client.GetBucketEncryption(ctx, &s3.GetBucketEncryptionInput{Bucket: &bucket}, optFns...)
	if err != nil {
		if UnwrapAwsError(err) == "ServerSideEncryptionConfigurationNotFoundError" {
			return "None", nil
		}
		return "", err
	}
	if result.ServerSideEncryptionConfiguration != nil {
		for _, rule := range result.ServerSideEncryptionConfiguration.Rules {
			if def := rule.ApplyServerSideEncryptionByDefault; def != nil {
				if key := aws.ToString(def.KMSMasterKeyID); key != "" {
					return fmt.Sprintf("%s (%s)", def.SSEAlgorithm, key), nil
				}
				return string(def.SSEAlgorithm), nil
			}
		}
	}
	return "None", nil
}

// readObjectLock trả về "Disabled" hoặc "Enabled" kèm thời hạn lưu giữ mặc định, ví dụ "Enabled (GOVERNANCE, 30d)".
func readObjectLock(
	ctx context.Context,
	conn *global.S3Conn,
	bucket string,
	optFns []func(*s3.Options),
) (string, error) {
	result, err := conn.Client.GetObjectLockConfiguration(ctx, &s3.GetObjectLockConfigurationInput{Bucket: &bucket},
		optFns...)
	if err != nil {
		if UnwrapAwsError(err) == "ObjectLockConfigurationNotFoundError" {
			return "Disabled", nil
		}
		return "", err
	}
	lock := result.ObjectLockConfiguration
	if lock == nil || lock.ObjectLockEnabled != types.ObjectLockEnabledEnabled {
		return "Disabled", nil
	}
	if lock.Rule == nil || lock.Rule.DefaultRetention == nil {
		return "Enabled", nil
	}
	retention := lock.Rule.DefaultRetention
	period := fmt.Sprintf("%dd", aws.ToInt32(retention.Days))
	if retention.Years != nil {
		period = fmt.Sprintf("%dy", *retention.Years)
	}
	return fmt.Sprintf("Enabled (%s, %s)", retention.Mode, period), nil
}

// readTags trả về tag của bucket, rỗng nếu bucket không có tag.
func readTags(
	ctx context.Context,
	conn *global.S3Conn,
	bucket string,
	optFns []func(*s3.Options),
) (map[string]string, error) {
	tags := map[string]string{}
	result, err := conn.Client.GetBucketTagging(ctx, &s3.GetBucketTaggingInput{Bucket: &bucket}, optFns...)
	if err != nil {
		if UnwrapAwsError(err) == "NoSuchTagSet" {
			return tags, nil
		}
		return nil, err
	}
	for _, tag := range result.TagSet {
		tags[aws.ToString(tag.Key)] = aws.ToString(tag.Value)
	}
	return tags, nil
}

// countRoot đếm object và thư mục ở gốc bucket (mỗi thư mục tính là 1) trong tối đa rootCountMaxPages trang.
// capped là true nếu còn mục sau trang cuối đã đếm.
func countRoot(
	ctx context.Context,
	conn *global.S3Conn,
	bucket string,
	optFns []func(*s3.Options),
) (count int, capped bool, err error) {
	var token *string
	for range rootCountMaxPages {
		page, err := conn.Client.ListObjectsV2(ctx, &s3.ListObjectsV2Input{
			Bucket:            &bucket,
			Delimiter:         aws.String("/"),
			MaxKeys:           aws.Int32(1000),
			ContinuationToken: token,
		}, optFns...)
		if err != nil {
			return 0, false, err
		}
		count += len(page.Contents) + len(page.CommonPrefixes)
		if !aws.ToBool(page.IsTruncated) {
			return count, false, nil
		}
		token = page.NextContinuationToken
	}
	return count, true, nil
}
