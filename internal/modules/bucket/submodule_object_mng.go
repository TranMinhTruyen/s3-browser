package bucket

import (
	"S3Browser/internal/modules/global"
	"S3Browser/internal/pkg/cnst"
	"S3Browser/models"
	"context"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// submoduleObjMng lists, deletes and reads the detail of objects.
type submoduleObjMng struct {
	logger *slog.Logger
	app    *application.App
	global *global.Module
}

// deleteConcurrency limits the single-key deletes running at once (fallback without DeleteObjects).
const deleteConcurrency = 6

// newSubmoduleObjMng builds the object submodule on the shared connection store.
func newSubmoduleObjMng(
	app *application.App,
	logger *slog.Logger,
	global *global.Module,
) *submoduleObjMng {
	return &submoduleObjMng{
		logger: logger.With("submodules", "object_mng"),
		app:    app,
		global: global,
	}
}

// listObject lists the objects under input.Prefix.
// ctx is the call context: it is canceled when the frontend cancels the call.
func (m *submoduleObjMng) listObject(
	ctx context.Context,
	input models.ListObjectInput,
) models.Output[models.ListObjectOutput] {
	ctx, cancel := withCallContext(ctx, m.app.Context(), 5*time.Minute)
	defer cancel()

	output := models.NewOutput[models.ListObjectOutput]()

	s3Conn, ok := m.global.GetConnContainer(input.ConnectionId)

	if !ok {
		return output.ThrowError(notConnectedMessage(input.ProfileName))
	}

	listObjectInput := &s3.ListObjectsV2Input{
		Bucket:    &input.Bucket,
		Prefix:    &input.Prefix,
		Delimiter: aws.String("/"),
		MaxKeys:   &input.Limit, // passed as is, no local bounds check (AWS S3 caps MaxKeys at 1000)
	}

	if input.NextCursor != "" {
		listObjectInput.ContinuationToken = &input.NextCursor
	}

	objects, err := s3Conn.Client.ListObjectsV2(ctx, listObjectInput)

	if err != nil {
		if statusCode(err) == http.StatusForbidden {
			output.Body.AccessDenied = true
			// Only the bucket root: a sub-prefix may be blocked by a prefix policy alone.
			if input.Prefix == "" {
				s3Conn.Access.Set(global.AccessRead, input.Bucket, true, s3Conn.Access.Generation())
			}
		}
		return failCall(ctx, output, input.ProfileName, err,
			models.NewParamsMessage(cnst.MessageTypeError, cnst.Bucket, S3E008, UnwrapAwsError(err), map[string]any{
				"name":   input.ProfileName,
				"bucket": input.Bucket,
			}))
	}

	body := models.ListObjectOutput{
		ObjectList: make([]models.ObjectItem, 0, len(objects.CommonPrefixes)+len(objects.Contents)),
		NextCursor: objects.NextContinuationToken,
	}

	// With Delimiter "/", S3 groups the keys below each sub-folder into CommonPrefixes.
	// List them first, as folders.
	for _, p := range objects.CommonPrefixes {
		key := aws.ToString(p.Prefix)
		if key == "" {
			continue
		}
		body.ObjectList = append(body.ObjectList, models.ObjectItem{
			Key:      key,
			Name:     strings.TrimSuffix(strings.TrimPrefix(key, input.Prefix), "/"),
			IsFolder: true,
		})
	}

	// S3-compatible providers may omit optional fields, so read them via aws.ToX instead of dereferencing.
	for _, o := range objects.Contents {
		key := aws.ToString(o.Key)

		if key == "" || key == input.Prefix {
			continue
		}

		body.ObjectList = append(body.ObjectList, models.ObjectItem{
			Key:          key,
			Name:         strings.TrimPrefix(key, input.Prefix),
			Size:         aws.ToInt64(o.Size),
			LastModified: aws.ToTime(o.LastModified),
			ETag:         aws.ToString(o.ETag),
		})
	}

	output.Body = body
	return output
}

// deleteObject deletes input.Objects in batches of deleteBatchSize. A key that is already gone counts as
// deleted. A key that fails is listed in the body and doesn't make Result false.
func (m *submoduleObjMng) deleteObject(
	ctx context.Context,
	input models.DeleteObjInput,
) models.Output[models.DeleteObjOutput] {
	ctx, cancel := withCallContext(ctx, m.app.Context(), deleteTimeout)
	defer cancel()

	output := models.NewOutput[models.DeleteObjOutput]()

	s3Conn, ok := m.global.GetConnContainer(input.ConnectionId)

	if !ok {
		return output.ThrowError(notConnectedMessage(input.ProfileName))
	}

	d := &batchDeleter{
		client:         s3Conn.Client,
		bucket:         input.Bucket,
		collectDeleted: true,
		deletedKeys:    make([]string, 0, len(input.Objects)),
		failures:       []models.DeleteFailure{},
		maxDetails:     len(input.Objects),
	}
	for start := 0; start < len(input.Objects); start += deleteBatchSize {
		end := min(start+deleteBatchSize, len(input.Objects))
		if err := d.deleteBatch(ctx, input.Objects[start:end]); err != nil {
			if isCallCanceled(ctx) {
				m.logger.Info("delete object canceled", "bucket", input.Bucket, "deleted", d.deleted)
				// Canceled by the frontend: fail silently, nobody waits for the result.
				return output.ThrowError()
			}
			if d.deleted == 0 && isCredentialsExpired(err) {
				return output.ThrowError(expiredMessage(input.ProfileName, err))
			}
			// Timeout: the keys not tried yet are failures.
			for _, k := range input.Objects[start:] {
				d.fail(k, UnwrapAwsError(err))
			}
			break
		}
	}

	if d.failed > 0 {
		m.logger.Error("delete object failed", "bucket", input.Bucket, "deleted", d.deleted, "failed", d.failed)
	}
	output.Body = models.DeleteObjOutput{Deleted: d.deletedKeys, Failed: d.failures}
	return output
}
