package bucket

import (
	"S3Browser/internal/pkg/cnst"
	"S3Browser/models"
	"context"
	"errors"
	"maps"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// s3Header is the part of the S3 client used to read an object's headers.
type s3Header interface {
	HeadObject(
		ctx context.Context, in *s3.HeadObjectInput, optFns ...func(*s3.Options),
	) (*s3.HeadObjectOutput, error)
}

var _ s3Header = (*s3.Client)(nil)

// getObjectDetail reads the content type, storage class and user metadata of one object
// with HeadObject. ctx is the call context: it is canceled when the frontend cancels the call.
func (m *submoduleObjMng) getObjectDetail(
	ctx context.Context,
	input models.ObjectDetailInput,
) models.Output[models.ObjectDetailOutput] {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	// Wails detaches the call context from the app lifetime, so also stop on app shutdown.
	stop := context.AfterFunc(m.appContext(), cancel)
	defer stop()

	output := models.NewOutput[models.ObjectDetailOutput]()

	// An empty key or a folder ("a/") is not an object, so there is nothing to head.
	if input.Key == "" || strings.HasSuffix(input.Key, "/") {
		return output.ThrowError(
			models.NewParamsMessage(cnst.MessageTypeError, cnst.Bucket, S3E025, "", map[string]any{
				"key": input.Key,
			}),
		)
	}

	client, ok := m.getHeader(input.ConnectionId)
	if !ok {
		return output.ThrowError(
			models.NewParamsMessage(cnst.MessageTypeError, cnst.Bucket, S3E006, "", map[string]any{
				"name": input.ProfileName,
			}),
		)
	}

	head, err := client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(input.Bucket),
		Key:    aws.String(input.Key),
	})
	if err != nil {
		// The frontend canceled the call; nobody is waiting for the result.
		if errors.Is(ctx.Err(), context.Canceled) {
			output.Result = false
			return output
		}

		return output.ThrowError(
			models.NewParamsMessage(cnst.MessageTypeError, cnst.Bucket, S3E024, UnwrapAwsError(err), map[string]any{
				"name":   input.ProfileName,
				"bucket": input.Bucket,
				"key":    input.Key,
			}),
		)
	}

	// Copy the metadata so the result doesn't share memory with the SDK response.
	metadata := make(map[string]string, len(head.Metadata))
	maps.Copy(metadata, head.Metadata)

	output.Body = models.ObjectDetailOutput{
		Key:          input.Key,
		ContentType:  aws.ToString(head.ContentType),
		StorageClass: string(head.StorageClass),
		Metadata:     metadata,
	}
	return output
}
