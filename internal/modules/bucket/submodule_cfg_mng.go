package bucket

import (
	"S3Browser/internal/modules/global"
	"S3Browser/internal/pkg/cnst"
	"S3Browser/models"
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/smithy-go"
	"github.com/minio/madmin-go/v4"
	miniocredentials "github.com/minio/minio-go/v7/pkg/credentials"
)

type submoduleCfgMng struct {
	logger *slog.Logger
}

func newSubmoduleCfgMng(
	logger *slog.Logger,
) *submoduleCfgMng {
	return &submoduleCfgMng{
		logger: logger.With("submodules", "cfg_mng"),
	}
}

func (m *submoduleCfgMng) buildClient(input models.ConnectionProfileInput) *global.S3Conn {
	client, transport := newHTTPClient()

	cfg := aws.Config{
		Credentials:      credentials.NewStaticCredentialsProvider(input.AccessKey, input.SecretKey, ""),
		Region:           input.Region,
		HTTPClient:       client,
		RetryMaxAttempts: 3,
	}

	s3Client := s3.NewFromConfig(cfg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(input.Endpoint)
		o.UsePathStyle = input.PathStyle
	})

	s3Presigner := s3.NewPresignClient(s3Client)

	conn := &global.S3Conn{
		ProfileName: input.Name,
		Provider:    input.Provider,
		Client:      s3Client,
		Presign:     s3Presigner,
		Transport:   transport,
	}

	if input.Provider == "minio" {
		admin, err := madmin.NewWithOptions(input.Endpoint, &madmin.Options{
			Creds:     miniocredentials.NewStaticV4(input.AccessKey, input.SecretKey, ""),
			Secure:    true,
			Transport: transport,
		})
		if err != nil {
			m.logger.Error("create madmin failed", slog.Any("error", err.Error()))
		} else {
			conn.MinioAdmin = admin
		}
	}

	return conn
}

func (m *submoduleCfgMng) probe(ctx context.Context, c *global.S3Conn) (models.Output[models.ConnectOutput], error) {
	output := models.NewOutput[models.ConnectOutput]()

	if _, err := c.Client.ListBuckets(ctx, &s3.ListBucketsInput{}); err != nil {
		mappedErr := describeConnectStatus(err, &output)
		if mappedErr != nil {
			c.Transport.CloseIdleConnections()
			m.logger.Error("connect to S3 failed", slog.Any("error", mappedErr.Error()))
		}
		return output, mappedErr
	}

	return output, nil
}

func describeConnectStatus(err error, output *models.Output[models.ConnectOutput]) error {
	if errors.Is(err, context.DeadlineExceeded) {
		output.MessageList = &[]models.Message{
			models.NewMessage(cnst.MessageTypeError, cnst.Bucket, S3E003, err.Error()),
		}
		return err
	}

	if err != nil {
		output.MessageList = &[]models.Message{
			models.NewMessage(cnst.MessageTypeError, cnst.Bucket, S3E004, err.Error()),
		}
		return err
	}

	errStr := UnwrapAwsError(err)

	switch errStr {
	case "InvalidAccessKeyId", "SignatureDoesNotMatch", "InvalidClientTokenId":
		output.MessageList = &[]models.Message{
			models.NewMessage(cnst.MessageTypeError, cnst.Bucket, S3E001, errStr),
		}
		return err
	case "AuthorizationHeaderMalformed", "InvalidRegion":
		output.MessageList = &[]models.Message{
			models.NewMessage(cnst.MessageTypeError, cnst.Bucket, S3E002, errStr),
		}
		return err
	case "AccessDenied", "AllAccessDisabled", "UnauthorizedAccess":
		output.MessageList = &[]models.Message{
			models.NewMessage(cnst.MessageTypeWarn, cnst.Bucket, S3W001, errStr),
		}
		output.Body.Limited = true
		return nil
	default:
		output.MessageList = &[]models.Message{
			models.NewMessage(cnst.MessageTypeError, cnst.Bucket, S3E003, errStr),
		}
		return err
	}
}

func UnwrapAwsError(err error) string {
	if err == nil {
		return ""
	}

	var canceledErr *smithy.CanceledError
	if errors.As(err, &canceledErr) {
		return canceledErr.Error()
	}

	var apiErr smithy.APIError
	if errors.As(err, &apiErr) {
		return apiErr.ErrorCode()
	}

	var deserializationErr *smithy.DeserializationError
	if errors.As(err, &deserializationErr) {
		return deserializationErr.Error()
	}

	var serializationErr *smithy.SerializationError
	if errors.As(err, &serializationErr) {
		return serializationErr.Error()
	}

	var operationErr *smithy.OperationError
	if errors.As(err, &operationErr) {
		return operationErr.Error()
	}

	return ""
}

func newHTTPClient() (*http.Client, *http.Transport) {
	dialer := &net.Dialer{
		Timeout:   5 * time.Second,
		KeepAlive: 30 * time.Second,
	}

	tr := &http.Transport{
		DialContext:           dialer.DialContext,
		MaxIdleConns:          6000,
		MaxIdleConnsPerHost:   6000,
		MaxConnsPerHost:       5000,
		IdleConnTimeout:       90 * time.Second,
		WriteBufferSize:       64 * 1024,
		ReadBufferSize:        64 * 1024,
		ForceAttemptHTTP2:     false,
		ResponseHeaderTimeout: 30 * time.Second,
	}

	return &http.Client{Transport: tr}, tr
}
