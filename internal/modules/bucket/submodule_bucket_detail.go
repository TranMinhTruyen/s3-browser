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
	// detailConcurrency is the most reads of one bucket detail running at once.
	detailConcurrency = 8
	// rootCountMaxPages caps the pages counted at the bucket root: 10 pages of 1000 = 10,000 items.
	rootCountMaxPages = 10
)

// getBucketDetail reads the detail of input.Bucket (10s timeout). Each item is read on its own: one that fails
// (denied, not supported, timeout) stays nil. Only a canceled call, expired credentials or a missing bucket fail
// the whole call. Anonymous connections are allowed, the items they can't read just stay nil.
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

	// A bucket in another region answers 301 to the other calls, so ask where it is first.
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

// detailReads lists the reads of the bucket detail; each one fills its own field of body, so they can run in
// parallel. An error means the field stays nil.
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

// isFatalDetailError reports whether err must fail the whole detail call: a canceled call, expired credentials
// or a bucket that does not exist.
func isFatalDetailError(ctx context.Context, err error) bool {
	return err != nil &&
		(isCallCanceled(ctx) || isCredentialsExpired(err) || UnwrapAwsError(err) == "NoSuchBucket")
}

// readBucketRegion returns the region of the bucket. An empty location is us-east-1 on AWS; other servers that
// answer nothing leave it empty.
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

// bucketEndpointUrl is the URL of the bucket: virtual-hosted on AWS, and on a custom endpoint path style or
// virtual-hosted following the client option.
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

// readEncryption returns the default encryption: the algorithm (with the KMS key id if any), or "None".
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

// readObjectLock returns "Disabled", or "Enabled" followed by the default retention, like "Enabled (GOVERNANCE, 30d)".
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

// readTags returns the tags of the bucket, empty when it has none.
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

// countRoot counts the objects and folders at the bucket root (a folder counts 1) over at most rootCountMaxPages
// pages. capped is true when more is left after the last page counted.
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
