package bucket

import (
	"S3Browser/internal/modules/global"
	"S3Browser/internal/pkg/cnst"
	"S3Browser/models"
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/wailsapp/wails/v3/pkg/application"
)

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

func (m *submoduleBucketMng) listBucket(
	ctx context.Context,
	input models.ListBucketInput,
) models.Output[models.ListBucketOutput] {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	// Wails detaches the call context from the app lifetime, so also stop on app shutdown.
	stop := context.AfterFunc(m.app.Context(), cancel)
	defer stop()

	output := models.NewOutput[models.ListBucketOutput]()

	s3Conn, ok := m.global.GetConnContainer(input.ConnectionId)

	if !ok {
		output.AddMessage(
			models.NewParamsMessage(cnst.MessageTypeError, cnst.Bucket, S3E006, "", map[string]any{
				"name": input.ProfileName,
			}),
		)
		return output
	}

	listBucketInput := &s3.ListBucketsInput{
		MaxBuckets: aws.Int32(input.Limit),
	}
	if input.NextCursor != "" {
		listBucketInput.ContinuationToken = &input.NextCursor
	}

	result, err := s3Conn.Client.ListBuckets(ctx, listBucketInput)

	if err != nil {
		// The frontend canceled the call; nobody is waiting for the result.
		if errors.Is(ctx.Err(), context.Canceled) {
			output.Result = false
			return output
		}

		output.AddMessage(
			models.NewParamsMessage(cnst.MessageTypeError, cnst.Bucket, S3E007, err.Error(), map[string]any{
				"name": input.ProfileName,
			}),
		)
		return output
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
