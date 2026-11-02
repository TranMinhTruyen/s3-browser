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

// newSubmoduleBucketMng builds the bucket submodule on the shared connection store.
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

	if s3Conn.AuthType == cnst.AuthAnonymous {
		// Check again so a bucket whose policy changed since connecting gets the right flag.
		checkAnonymousBuckets(ctx, s3Conn)
		if isCallCanceled(ctx) {
			return output.ThrowError()
		}
		output.Body.BucketList = anonymousBuckets(s3Conn, "")
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
		if isCallCanceled(ctx) {
			output.Result = false
			return output
		}

		if isCredentialsExpired(err) {
			return output.ThrowError(expiredMessage(input.ProfileName, err))
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

// anonymousBuckets returns the buckets the user entered for an anonymous connection (the API can't list them),
// keeping those whose name contains lowerKeyword (already lower-cased; empty keeps all). Buckets that failed
// the latest check are flagged Inaccessible.
func anonymousBuckets(c *global.S3Conn, lowerKeyword string) []models.Bucket {
	all := c.AnonymousBuckets()
	buckets := make([]models.Bucket, 0, len(all))
	for _, b := range all {
		if containsFold(b.Name, lowerKeyword) {
			buckets = append(buckets, models.Bucket{Name: b.Name, Inaccessible: !b.Accessible})
		}
	}
	return buckets
}
