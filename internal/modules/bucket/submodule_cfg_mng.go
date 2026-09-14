package bucket

import (
	"S3Browser/internal/modules/global"
	"S3Browser/internal/pkg/cnst"
	"S3Browser/models/bucket"
	models "S3Browser/models/bucket"
	"S3Browser/models/common"
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
)

func (m *Module) buildClient(input models.ConnectionInput) *global.S3Conn {
	client, transport := newHTTPClient()

	region := input.Region
	if region == "" {
		region = "us-east-1"
	}

	cfg := aws.Config{
		Credentials:      credentials.NewStaticCredentialsProvider(input.AccessKey, input.SecretKey, ""),
		Region:           region,
		HTTPClient:       client,
		RetryMaxAttempts: 3,
	}

	s3Client := s3.NewFromConfig(cfg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(input.Endpoint)
		o.UsePathStyle = input.PathStyle
	})

	s3Presigner := s3.NewPresignClient(s3Client)

	return &global.S3Conn{
		ProfileName: input.Name,
		Client:      s3Client,
		Presign:     s3Presigner,
		Transport:   transport,
	}
}

func (m *Module) probe(ctx context.Context, c *global.S3Conn) (common.Output[bucket.ConnectionOutput], error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	output := common.Output[bucket.ConnectionOutput]{}
	output.New()

	if _, err := c.Client.ListBuckets(ctx, &s3.ListBucketsInput{}); err != nil {
		mappedErr := describeConnectStatus(err, &output)
		if mappedErr != nil {
			c.Transport.CloseIdleConnections()
			m.logger.Error("connect to S3 failed", slog.Any("error", mappedErr))
		}
		return output, mappedErr
	}

	return output, nil
}

func describeConnectStatus(err error, output *common.Output[bucket.ConnectionOutput]) error {
	var apiErr smithy.APIError
	if errors.As(err, &apiErr) {
		switch apiErr.ErrorCode() {
		case "InvalidAccessKeyId", "SignatureDoesNotMatch", "InvalidClientTokenId":
			output.MessageList = &[]common.Message{
				common.CreateMessage(cnst.MessageTypeError, cnst.Bucket, S3E001, err.Error()),
			}
			return err
		case "AuthorizationHeaderMalformed", "InvalidRegion":
			output.MessageList = &[]common.Message{
				common.CreateMessage(cnst.MessageTypeError, cnst.Bucket, S3E002, err.Error()),
			}
			return err
		case "AccessDenied", "AllAccessDisabled", "UnauthorizedAccess":
			output.MessageList = &[]common.Message{
				common.CreateMessage(cnst.MessageTypeWarn, cnst.Bucket, S3W001, err.Error()),
			}
			output.Body.Limited = true
			return nil
		default:
			output.MessageList = &[]common.Message{
				common.CreateMessage(cnst.MessageTypeError, cnst.Bucket, S3E003, err.Error()),
			}
			return err
		}
	}

	if errors.Is(err, context.DeadlineExceeded) {
		output.MessageList = &[]common.Message{
			common.CreateMessage(cnst.MessageTypeError, cnst.Bucket, S3E003, err.Error()),
		}
		return err
	}

	if err != nil {
		output.MessageList = &[]common.Message{
			common.CreateMessage(cnst.MessageTypeError, cnst.Bucket, S3E004, err.Error()),
		}
		return err
	}

	return nil
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
