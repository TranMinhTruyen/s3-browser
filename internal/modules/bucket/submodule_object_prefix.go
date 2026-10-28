package bucket

import (
	"S3Browser/internal/pkg/cnst"
	"S3Browser/models"
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/smithy-go"
	"golang.org/x/sync/errgroup"
)

const (
	// deletePrefixTimeout bounds one deletePrefix call. A prefix can hold millions of keys and is
	// deleted page by page, so it gets far more time than a single request (5 minutes).
	deletePrefixTimeout = 30 * time.Minute
	// deleteBatchSize is the S3 limit of keys in one DeleteObjects request. It is also the
	// ListObjectsV2 page size, so memory stays bounded and one page maps to one delete request.
	deleteBatchSize = 1000
)

// s3Deleter is the part of *s3.Client the prefix delete code uses. It lets tests replace S3.
type s3Deleter interface {
	ListObjectsV2(
		ctx context.Context, in *s3.ListObjectsV2Input, optFns ...func(*s3.Options),
	) (*s3.ListObjectsV2Output, error)
	DeleteObjects(
		ctx context.Context, in *s3.DeleteObjectsInput, optFns ...func(*s3.Options),
	) (*s3.DeleteObjectsOutput, error)
	DeleteObject(
		ctx context.Context, in *s3.DeleteObjectInput, optFns ...func(*s3.Options),
	) (*s3.DeleteObjectOutput, error)
}

var _ s3Deleter = (*s3.Client)(nil)

// validDeletePrefix reports whether prefix may be deleted: it must name a folder
// (end with "/") and must not be empty or "/", so a whole bucket is never deleted.
func validDeletePrefix(prefix string) bool {
	return strings.Trim(prefix, "/") != "" && strings.HasSuffix(prefix, "/")
}

// isDeleteObjectsUnsupported reports whether the provider doesn't support DeleteObjects.
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

// prefixDeleter holds the state of one deletePrefix call.
type prefixDeleter struct {
	client  s3Deleter
	bucket  string
	deleted int
	failed  int
	// firstErr is the detail of the first failure.
	firstErr string
	// single is set once the provider rejected DeleteObjects.
	single bool
}

// fail counts one failed key and keeps the detail of the first one.
func (d *prefixDeleter) fail(detail string) {
	d.failed++
	if d.firstErr == "" {
		d.firstErr = detail
	}
}

// deleteBatch deletes keys (at most deleteBatchSize). A returned error is a call level
// error (for example canceled context); per key failures are counted in d.failed.
func (d *prefixDeleter) deleteBatch(ctx context.Context, keys []string) error {
	if len(keys) == 0 {
		return nil
	}

	if !d.single {
		ids := make([]types.ObjectIdentifier, len(keys))
		for i, k := range keys {
			ids[i] = types.ObjectIdentifier{Key: aws.String(k)}
		}
		out, err := d.client.DeleteObjects(ctx, &s3.DeleteObjectsInput{
			Bucket: aws.String(d.bucket),
			Delete: &types.Delete{Objects: ids, Quiet: aws.Bool(true)},
		})
		switch {
		case err == nil:
			for _, e := range out.Errors {
				d.fail(fmt.Sprintf("%s: %s %s", aws.ToString(e.Key), aws.ToString(e.Code), aws.ToString(e.Message)))
			}
			d.deleted += len(keys) - len(out.Errors)
			return nil
		case ctx.Err() != nil:
			return ctx.Err()
		case isDeleteObjectsUnsupported(err):
			d.single = true
		default:
			// The request itself failed: none of the keys is known to be deleted.
			for range keys {
				d.fail(UnwrapAwsError(err))
			}
			return nil
		}
	}

	return d.deleteEach(ctx, keys)
}

// deleteEach is the fallback for providers without DeleteObjects: one DeleteObject per key.
func (d *prefixDeleter) deleteEach(ctx context.Context, keys []string) error {
	errs := make([]error, len(keys))
	var g errgroup.Group
	// Not errgroup.WithContext: every failure is recorded per key in errs and g.Go returns nil,
	// so one failed key must not cancel the other deletes in the batch.
	g.SetLimit(deleteConcurrency)
	for i, k := range keys {
		g.Go(func() error {
			_, errs[i] = d.client.DeleteObject(ctx, &s3.DeleteObjectInput{
				Bucket: aws.String(d.bucket),
				Key:    aws.String(k),
			})
			return nil
		})
	}
	_ = g.Wait()

	if ctx.Err() != nil {
		return ctx.Err()
	}
	for i, err := range errs {
		if err != nil {
			d.fail(fmt.Sprintf("%s: %s", keys[i], UnwrapAwsError(err)))
		} else {
			d.deleted++
		}
	}
	return nil
}

// deletePrefix deletes every current object under input.Prefix, page by page.
// ctx is the call context: it is canceled when the frontend cancels the call.
// It returns one summary message, not one per key.
func (m *submoduleObjMng) deletePrefix(
	ctx context.Context,
	input models.DeletePrefixInput,
) models.Output[models.DeletePrefixOutput] {
	ctx, cancel := withCallContext(ctx, m.appContext(), deletePrefixTimeout)
	defer cancel()

	output := models.NewOutput[models.DeletePrefixOutput]()

	if !validDeletePrefix(input.Prefix) {
		return output.ThrowError(
			models.NewParamsMessage(cnst.MessageTypeError, cnst.Bucket, S3E020, "", map[string]any{
				"prefix": input.Prefix,
			}),
		)
	}

	client, ok := m.getDeleter(input.ConnectionId)
	if !ok {
		return output.ThrowError(notConnectedMessage(input.ProfileName))
	}

	d := &prefixDeleter{client: client, bucket: input.Bucket}
	var callErr error
	var token *string

	for {
		// No Delimiter: list every key below the prefix, including the folder marker.
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

	output.Body = models.DeletePrefixOutput{Deleted: d.deleted, Failed: d.failed}

	if callErr != nil {
		// The frontend canceled the call; nobody is waiting for the result.
		if isCallCanceled(ctx) {
			m.logger.Info("delete prefix canceled",
				"bucket", input.Bucket, "prefix", input.Prefix, "deleted", d.deleted)
			output.Result = false
			return output
		}
		d.fail(UnwrapAwsError(callErr))
		output.Body.Failed = d.failed
	}

	if d.failed > 0 {
		m.logger.Error("delete prefix failed", "bucket", input.Bucket, "prefix", input.Prefix,
			"deleted", d.deleted, "failed", d.failed, "error", d.firstErr)
		return output.ThrowError(
			models.NewParamsMessage(cnst.MessageTypeError, cnst.Bucket, S3E021, d.firstErr, map[string]any{
				"prefix":  input.Prefix,
				"failed":  d.failed,
				"deleted": d.deleted,
			}),
		)
	}

	m.logger.Info("delete prefix done", "bucket", input.Bucket, "prefix", input.Prefix, "deleted", d.deleted)
	output.AddMessage(
		models.NewParamsMessage(cnst.MessageTypeSuccess, cnst.Bucket, S3S007, "", map[string]any{
			"prefix": input.Prefix,
			"count":  d.deleted,
		}),
	)
	return output
}
