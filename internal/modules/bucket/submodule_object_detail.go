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

// getObjectDetail đọc content type, storage class và metadata do người dùng đặt của một object bằng HeadObject.
// ctx là context của lời gọi; frontend sẽ hủy context khi người dùng hủy lời gọi.
func (m *submoduleObjMng) getObjectDetail(
	ctx context.Context,
	input models.ObjectDetailInput,
) models.Output[models.ObjectDetailOutput] {
	ctx, cancel := withCallContext(ctx, m.app.Context(), 5*time.Minute)
	defer cancel()

	output := models.NewOutput[models.ObjectDetailOutput]()

	// Key rỗng hoặc tên thư mục ("a/") không phải object nên không có gì để gọi HeadObject.
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
			// Frontend đã hủy: dừng im lặng vì không còn bên nào chờ kết quả.
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

	// Sao chép metadata để kết quả không dùng chung bộ nhớ với phản hồi từ SDK.
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
