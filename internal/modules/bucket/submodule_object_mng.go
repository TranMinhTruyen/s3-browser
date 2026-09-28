package bucket

import (
	"S3Browser/internal/modules/global"
	"S3Browser/internal/pkg/cnst"
	"S3Browser/internal/pkg/utils"
	"S3Browser/models"
	"context"
	"log/slog"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type submoduleObjMng struct {
	logger *slog.Logger
	app    *application.App
	global *global.Module
}

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

func (m *submoduleObjMng) listObject(input models.ListObjectInput) models.Output[models.ListObjectOutput] {
	ctx, cancel := context.WithTimeout(m.app.Context(), 30*time.Second)
	defer cancel()

	output := models.Output[models.ListObjectOutput]{}
	output.New()

	s3Conn, ok := m.global.GetConnContainer(input.ConnectionId)

	if ok == false {
		output.AddMessage(
			models.CreateMessageWithParams(cnst.MessageTypeError, cnst.Bucket, S3E006, "", map[string]any{
				"name": input.ProfileName,
			}),
		)
		return output
	}

	listObjectInput := &s3.ListObjectsV2Input{
		Bucket:    &input.Bucket,
		Prefix:    &input.Prefix,
		Delimiter: aws.String("/"),
		MaxKeys:   &input.Limit,
	}

	if input.NextCursor != "" {
		listObjectInput.ContinuationToken = &input.NextCursor
	}

	objects, err := s3Conn.Client.ListObjectsV2(ctx, listObjectInput)

	if err != nil {
		apiErr := UnwrapAwsError(err)
		output.AddMessage(
			models.CreateMessageWithParams(
				cnst.MessageTypeError,
				cnst.Bucket,
				S3E006,
				apiErr,
				map[string]any{
					"name":   input.ProfileName,
					"bucket": input.Bucket,
				},
			),
		)
		output.Result = utils.ToPtr(false)
		return output
	}

	body := models.ListObjectOutput{
		ObjectList: make([]models.ObjectItem, len(objects.Contents)),
		NextCursor: objects.NextContinuationToken,
	}

	for i, o := range objects.Contents {
		key := *o.Key

		if key == input.Prefix {
			continue
		}

		body.ObjectList[i] = models.ObjectItem{
			Key:          key,
			Name:         key[len(input.Prefix):],
			Size:         *o.Size,
			LastModified: *o.LastModified,
			ETag:         *o.ETag,
		}
	}

	output.Body = &body
	return output
}
