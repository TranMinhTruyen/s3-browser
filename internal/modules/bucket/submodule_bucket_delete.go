package bucket

import (
	"S3Browser/internal/modules/global"
	"S3Browser/internal/pkg/cnst"
	"S3Browser/models"
	"cmp"
	"context"
	"log/slog"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"golang.org/x/sync/errgroup"
)

// regionOptFns makes the requests go to the region of the bucket; only real AWS needs it.
func regionOptFns(conn *global.S3Conn, region string) []func(*s3.Options) {
	if !isRealAws(conn) || region == "" {
		return nil
	}
	return []func(*s3.Options){func(o *s3.Options) { o.Region = region }}
}

// isNotImplemented reports whether the server answered NotImplemented.
func isNotImplemented(err error) bool {
	return UnwrapAwsError(err) == "NotImplemented"
}

// deleteCursor walks the versions and delete markers of a bucket page by page. A server without
// ListObjectVersions falls back to ListObjectsV2 (current objects only).
type deleteCursor struct {
	limit         int32
	keyMarker     *string
	versionMarker *string
	token         *string
	v2            bool
	done          bool
}

// nextPage returns the identifiers of the next page; done is set once the last page was returned.
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
			c.keyMarker, c.versionMarker = page.NextKeyMarker, page.NextVersionIdMarker
			c.done = !aws.ToBool(page.IsTruncated)
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

// getBucketDeleteInfo reads what the delete dialog needs (10s timeout): whether the bucket is empty, its
// versioning and whether Object Lock is on. An item that can't be read stays unknown (nil, empty, false).
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

// deleteBucket deletes input.Bucket after deleting every object, version and delete marker in it (30 minute
// timeout). Object Lock is checked before any object is deleted: a bucket that is not empty and has Object Lock
// (or whose Object Lock can't be read) is left untouched. It stops at the first batch with a failed key and
// then doesn't delete the bucket.
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
		return deleteBucketFailed(ctx, output, input, err)
	}
	optFns := regionOptFns(conn, region)

	lock, lockErr := readObjectLock(ctx, conn, input.Bucket, optFns)
	if isFatalDetailError(ctx, lockErr) {
		return deleteBucketFailed(ctx, output, input, lockErr)
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
	stop, err := emptyBucket(ctx, d, lock, lockErr)
	output.Body = models.DeleteBucketOutput{Deleted: d.deleted, Failed: d.failed, Failures: d.failures}
	switch {
	case err != nil:
		return deleteBucketFailed(ctx, output, input, err)
	case stop != nil:
		m.logger.Error("delete bucket stopped",
			slog.String("bucket", input.Bucket), "deleted", d.deleted, "failed", d.failed)
		return output.ThrowError(*stop)
	}

	if _, err := conn.Client.DeleteBucket(ctx, &s3.DeleteBucketInput{Bucket: &input.Bucket}, optFns...); err != nil {
		m.logger.Error("delete bucket failed", slog.String("bucket", input.Bucket), slog.Any("error", err))
		return deleteBucketFailed(ctx, output, input, err)
	}

	m.logger.Info("delete bucket done", slog.String("bucket", input.Bucket), "deleted", d.deleted)
	conn.Access.Reset()
	output.Body.BucketDeleted = true
	return *output.AddMessage(bucketMessage(cnst.MessageTypeSuccess, S3S009, input.Bucket, ""))
}

// emptyBucket deletes every version and delete marker with d. It returns the message to stop with when it stopped
// on purpose (Object Lock, or a key that failed), or an error when a call failed. lock and lockErr are the result
// of readObjectLock; they only matter when the bucket is not empty.
func emptyBucket(ctx context.Context, d *batchDeleter, lock string, lockErr error) (*models.Message, error) {
	cursor := deleteCursor{limit: deleteBatchSize}
	checkedLock := false
	for !cursor.done {
		ids, err := cursor.nextPage(ctx, d.client, d.bucket, d.optFns)
		if err != nil {
			return nil, err
		}
		if len(ids) > 0 && !checkedLock {
			checkedLock = true
			switch {
			case lockErr != nil:
				msg := bucketMessage(cnst.MessageTypeError, S3E060, d.bucket, UnwrapAwsError(lockErr))
				return &msg, nil
			case strings.HasPrefix(lock, "Enabled"):
				msg := bucketMessage(cnst.MessageTypeError, S3E063, d.bucket, "")
				return &msg, nil
			}
		}
		if err := d.deleteIDs(ctx, ids); err != nil {
			return nil, err
		}
		if d.failed > 0 {
			msg := models.NewParamsMessage(cnst.MessageTypeError, cnst.Bucket, S3E062, "", map[string]any{
				"bucket": d.bucket,
				"failed": d.failed,
			})
			return &msg, nil
		}
	}
	return nil, nil
}

// deleteBucketFailed ends a failed delete of the bucket with the message of the error: BucketNotEmpty gives S3E061,
// NoSuchBucket S3E059, denied S3E052, anything else S3E060.
func deleteBucketFailed(
	ctx context.Context,
	output models.Output[models.DeleteBucketOutput],
	input models.DeleteBucketInput,
	err error,
) models.Output[models.DeleteBucketOutput] {
	code := ""
	switch UnwrapAwsError(err) {
	case "BucketNotEmpty":
		code = S3E061
	case "NoSuchBucket":
		code = S3E059
	default:
		return bucketEditFailed(ctx, output, input.ProfileName, input.Bucket, err, S3E060)
	}
	return failCall(ctx, output, input.ProfileName, err,
		bucketMessage(cnst.MessageTypeError, code, input.Bucket, UnwrapAwsError(err)))
}
