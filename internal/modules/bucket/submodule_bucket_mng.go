package bucket

import (
	"S3Browser/internal/modules/global"
	"S3Browser/internal/pkg/cnst"
	"S3Browser/models"
	"context"
	"log/slog"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// submoduleBucketMng lists the buckets of a connection.
type submoduleBucketMng struct {
	logger *slog.Logger
	app    *application.App
	global *global.Module
}

func newSubmoduleBucketMng(
	app *application.App,
	logger *slog.Logger,
	global *global.Module,
) *submoduleBucketMng {
	return &submoduleBucketMng{
		logger: logger.With("submodules", "bucket_mng"),
		app:    app,
		global: global,
	}
}

// listBucket returns one page of the buckets of a connection (ListBuckets, 10s timeout).
// input.NextCursor is the continuation token of the previous page.
func (m *submoduleBucketMng) listBucket(
	ctx context.Context,
	input models.ListBucketInput,
) models.Output[models.ListBucketOutput] {
	ctx, cancel := withCallContext(ctx, m.app.Context(), 10*time.Second)
	defer cancel()

	output := models.NewOutput[models.ListBucketOutput]()

	s3Conn, ok := m.global.GetConnContainer(input.ConnectionId)
	if !ok {
		return output.ThrowError(notConnectedMessage(input.ProfileName))
	}

	listBucketInput := &s3.ListBucketsInput{
		MaxBuckets: aws.Int32(input.Limit),
	}
	if input.NextCursor != "" {
		listBucketInput.ContinuationToken = &input.NextCursor
	}

	result, err := s3Conn.Client.ListBuckets(ctx, listBucketInput)

	if err != nil {
		if isCallCanceled(ctx) {
			output.Result = false
			return output
		}

		return output.ThrowError(
			models.NewParamsMessage(cnst.MessageTypeError, cnst.Bucket, S3E007, err.Error(), map[string]any{
				"name": input.ProfileName,
			}),
		)
	}

	body := models.ListBucketOutput{
		BucketList: make([]models.Bucket, len(result.Buckets)),
		NextCursor: result.ContinuationToken,
	}

	for i, item := range result.Buckets {
		body.BucketList[i] = models.Bucket{
			Name:         aws.ToString(item.Name),
			CreationDate: aws.ToTime(item.CreationDate),
		}
	}

	output.Body = body
	return output
}
