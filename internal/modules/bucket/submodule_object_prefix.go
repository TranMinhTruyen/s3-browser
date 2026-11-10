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
	// deleteTimeout bounds one deleteObject or deletePrefix call. Both can cover many keys, deleted in
	// batches, so they get far more time than a single request.
	deleteTimeout = 30 * time.Minute
	// deleteBatchSize is the S3 limit of keys in one DeleteObjects request. It is also the
	// ListObjectsV2 page size, so memory stays bounded and one page maps to one delete request.
	deleteBatchSize = 1000
	// maxFailureDetails caps the failures kept for a folder, which can hold millions of keys.
	maxFailureDetails = 1000
)

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

// batchDeleter deletes keys in batches and records the outcome. It serves deleteObject, deletePrefix and
// deleteBucket (which deletes by version).
type batchDeleter struct {
	client  *s3.Client
	bucket  string
	deleted int
	failed  int
	// deletedKeys lists the deleted keys when collectDeleted is set.
	deletedKeys    []string
	collectDeleted bool
	// failures keeps the detail of the first maxDetails failures; failed counts all of them.
	failures   []models.DeleteFailure
	maxDetails int
	// single is set once the provider rejected DeleteObjects.
	single bool
	// optFns are passed to every request, e.g. to set the region of the bucket.
	optFns []func(*s3.Options)
}

// ok counts one deleted key.
func (d *batchDeleter) ok(key string) {
	d.deleted++
	if d.collectDeleted {
		d.deletedKeys = append(d.deletedKeys, key)
	}
}

// fail counts one failed key and keeps its detail while under maxDetails.
func (d *batchDeleter) fail(key, detail string) {
	d.failed++
	if len(d.failures) < d.maxDetails {
		d.failures = append(d.failures, models.DeleteFailure{Key: key, Error: detail})
	}
}

// failID is fail for an object identifier: the version id, if any, is added to the detail.
func (d *batchDeleter) failID(id types.ObjectIdentifier, detail string) {
	if id.VersionId != nil {
		detail += " (versionId " + *id.VersionId + ")"
	}
	d.fail(aws.ToString(id.Key), detail)
}

// failedIndex finds the id of the batch that a DeleteObjects error is about, skipping ids already matched. An error
// without a version id matches any one unmatched id with the same key. It returns -1 when none matches.
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

// deleteBatch deletes the current version of keys (at most deleteBatchSize). A returned error is a call level
// error (canceled context, or expired credentials before any key was deleted); per key failures are recorded by d.fail.
func (d *batchDeleter) deleteBatch(ctx context.Context, keys []string) error {
	ids := make([]types.ObjectIdentifier, len(keys))
	for i, k := range keys {
		ids[i] = types.ObjectIdentifier{Key: aws.String(k)}
	}
	return d.deleteIDs(ctx, ids)
}

// deleteIDs is deleteBatch for object identifiers, which may carry a version id.
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
			// Quiet mode: out only lists the objects that failed.
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
			// The request itself failed: none of the objects is known to be deleted.
			for _, id := range ids {
				d.failID(id, UnwrapAwsError(err))
			}
			return nil
		}
	}

	return d.deleteEach(ctx, ids)
}

// deleteEach is the fallback for providers without DeleteObjects: one DeleteObject per object.
func (d *batchDeleter) deleteEach(ctx context.Context, ids []types.ObjectIdentifier) error {
	errs := make([]error, len(ids))
	var g errgroup.Group
	// Not errgroup.WithContext: every failure is recorded per object in errs and g.Go returns nil,
	// so one failed object must not cancel the other deletes in the batch.
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
	// Nothing deleted so far and every object of this batch failed: expired credentials is a call level error.
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

// deletePrefix deletes every current object under input.Prefix, page by page.
// ctx is the call context: it is canceled when the frontend cancels the call.
// A key that fails doesn't make Result false: the body counts them and keeps the first maxFailureDetails.
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

	if callErr != nil {
		if isCallCanceled(ctx) {
			m.logger.Info("delete prefix canceled",
				"bucket", input.Bucket, "prefix", input.Prefix, "deleted", d.deleted)
			// Canceled by the frontend: fail silently, nobody waits for the result.
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
