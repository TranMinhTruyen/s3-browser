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

	output := models.NewOutput[models.ListObjectOutput]()

	s3Conn, ok := m.global.GetConnContainer(input.ConnectionId)

	if ok == false {
		return output.ThrowError(
			models.NewParamsMessage(cnst.MessageTypeError, cnst.Object, S3E006, "", map[string]any{
				"name": input.ProfileName,
			}),
		)
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
			models.NewParamsMessage(
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
		output.Result = false
		return output
	}

	body := models.ListObjectOutput{
		ObjectList: make([]models.ObjectItem, 0, len(objects.Contents)),
		NextCursor: objects.NextContinuationToken,
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
