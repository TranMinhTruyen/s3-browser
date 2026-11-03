package bucket

import (
	"S3Browser/internal/pkg/cnst"
	"S3Browser/models"
	"context"
	"maps"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// getObjectDetail reads the content type, storage class and user metadata of one object
// with HeadObject. ctx is the call context: it is canceled when the frontend cancels the call.
func (m *submoduleObjMng) getObjectDetail(
	ctx context.Context,
	input models.ObjectDetailInput,
) models.Output[models.ObjectDetailOutput] {
	ctx, cancel := withCallContext(ctx, m.app.Context(), 5*time.Minute)
	defer cancel()

	output := models.NewOutput[models.ObjectDetailOutput]()

	// An empty key or a folder ("a/") is not an object, so there is nothing to head.
	if input.Key == "" || strings.HasSuffix(input.Key, "/") {
		return output.ThrowError(
			models.NewParamsMessage(cnst.MessageTypeError, cnst.Bucket, S3E025, "", map[string]any{
				"key": input.Key,
			}),
		)
	}

	s3Conn, ok := m.global.GetConnContainer(input.ConnectionId)
	if !ok {
		return output.ThrowError(notConnectedMessage(input.ProfileName))
	}

	head, err := s3Conn.Client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(input.Bucket),
		Key:    aws.String(input.Key),
	})
	if err != nil {
		if isCallCanceled(ctx) {
			// Canceled by the frontend: fail silently, nobody waits for the result.
			return output.ThrowError()
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
