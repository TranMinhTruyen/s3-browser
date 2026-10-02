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

func (m *submoduleBucketMng) listBucket(input models.ListBucketInput) models.Output[models.ListBucketOutput] {
	ctx, cancel := context.WithTimeout(m.app.Context(), 10*time.Second)
	defer cancel()

	output := models.NewOutput[models.ListBucketOutput]()

	s3Conn, ok := m.global.GetConnContainer(input.ConnectionId)

	if ok == false {
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
			Name:         *item.Name,
			CreationDate: *item.CreationDate,
		}
	}

	output.Body = &body
	return output
}
