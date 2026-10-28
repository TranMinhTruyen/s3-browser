package bucket

import (
	"S3Browser/internal/modules/global"
	"S3Browser/internal/pkg/cnst"
	"S3Browser/models"
	"context"
	"log/slog"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/wailsapp/wails/v3/pkg/application"
	"golang.org/x/sync/errgroup"
)

type submoduleObjMng struct {
	logger *slog.Logger
	global *global.Module
	// getDeleter returns the S3 client of a connection; ok is false if it isn't connected.
	// It sits next to global as the seam tests replace with a fake client.
	getDeleter func(connID string) (client s3Deleter, ok bool)
	// getHeader returns the S3 client used to read object headers; ok is false if it isn't connected.
	getHeader func(connID string) (client s3Header, ok bool)
	// appContext returns the app lifetime context. Tests replace it so they don't need a running app.
	appContext func() context.Context
}

// deleteConcurrency limits the objects deleted (or head-checked) at once.
const deleteConcurrency = 6

// newSubmoduleObjMng builds the object submodule on the shared connection store.
func newSubmoduleObjMng(
	app *application.App,
	logger *slog.Logger,
	global *global.Module,
) *submoduleObjMng {
	return &submoduleObjMng{
		logger: logger.With("submodules", "object_mng"),
		global: global,
		getDeleter: func(connID string) (s3Deleter, bool) {
			conn, ok := global.GetConnContainer(connID)
			if !ok {
				return nil, false
			}
			return conn.Client, true
		},
		getHeader: func(connID string) (s3Header, bool) {
			conn, ok := global.GetConnContainer(connID)
			if !ok {
				return nil, false
			}
			return conn.Client, true
		},
		appContext: app.Context,
	}
}

// deleteResult is the outcome of deleting one key.
type deleteResult struct {
	key string
	err error
}

// listObject lists the objects under input.Prefix.
// ctx is the call context: it is canceled when the frontend cancels the call.
func (m *submoduleObjMng) listObject(
	ctx context.Context,
	input models.ListObjectInput,
) models.Output[models.ListObjectOutput] {
	ctx, cancel := withCallContext(ctx, m.appContext(), 5*time.Minute)
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
		// The frontend canceled the call; nobody is waiting for the result.
		if isCallCanceled(ctx) {
			output.Result = false
			return output
		}

		return output.ThrowError(
			models.NewParamsMessage(
				cnst.MessageTypeError,
				cnst.Bucket,
				S3E008,
				UnwrapAwsError(err),
				map[string]any{
					"name":   input.ProfileName,
					"bucket": input.Bucket,
				},
			),
		)
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

// deleteObject deletes input.Objects one by one (up to deleteConcurrency at once) and
// adds one message per key. Result is false if any key failed.
func (m *submoduleObjMng) deleteObject(ctx context.Context, input models.DeleteObjInput) models.Output[any] {
	ctx, cancel := withCallContext(ctx, m.appContext(), 5*time.Minute)
	defer cancel()

	output := models.NewOutput[any]()

	s3Conn, ok := m.global.GetConnContainer(input.ConnectionId)

	if !ok {
		return output.ThrowError(notConnectedMessage(input.ProfileName))
	}

	// Not errgroup.WithContext: failures go to the result channel and g.Go returns nil,
	// so one failed key must not cancel the other deletes.
	var g errgroup.Group
	g.SetLimit(deleteConcurrency)
	result := make(chan deleteResult, len(input.Objects))
	for _, key := range input.Objects {
		g.Go(func() error {
			// S3 DeleteObject succeeds even when the key doesn't exist, so HeadObject first
			// to report an error for a key that is already gone.
			_, err := s3Conn.Client.HeadObject(ctx, &s3.HeadObjectInput{
				Bucket: aws.String(input.Bucket),
				Key:    aws.String(key),
			})

			if err != nil {
				result <- deleteResult{
					key: key,
					err: err,
				}
				return nil
			}

			_, err = s3Conn.Client.DeleteObject(ctx, &s3.DeleteObjectInput{
				Bucket: aws.String(input.Bucket),
				Key:    aws.String(key),
			})

			result <- deleteResult{
				key: key,
				err: err,
			}
			return nil
		})
	}
	_ = g.Wait()
	close(result)

	for item := range result {
		if item.err != nil {
			// Keep going so every key still gets its own message; Result stays false.
			output.ThrowError(
				models.NewParamsMessage(
					cnst.MessageTypeError,
					cnst.Bucket,
					S3E013,
					item.err.Error(),
					map[string]any{
						"object": item.key,
					},
				),
			)
		} else {
			output.AddMessage(
				models.NewParamsMessage(
					cnst.MessageTypeSuccess,
					cnst.Bucket,
					S3S005,
					"",
					map[string]any{
						"object": item.key,
					},
				),
			)
		}
	}

	return output
}
