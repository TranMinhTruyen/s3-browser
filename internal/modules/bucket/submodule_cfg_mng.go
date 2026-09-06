package bucket

import (
	"context"
	"errors"
	models "minio-browser/models/bucket"
	"net"
	"net/http"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/smithy-go"
)

var (
	// Test connection to S3 success
	S3_SUCCES_001 = "S3S001"

	// S3 is connected
	S3_SUCCES_002 = "S3S002"

	// access key or secret key is not valid for this endpoint
	S3_ERROR_001 = "S3E001"

	// the endpoint rejected
	S3_ERROR_002 = "S3E002"

	// timed out reaching the endpoint, check the address and whether the server is running
	S3_ERROR_003 = "S3E003"

	// error while connect to S3 bucket
	S3_ERROR_004 = "S3E004"

	// Access bucket is limited
	S3_WARN_001 = "S3W001"
)

type S3Conn struct {
	Client    *s3.Client
	Presign   *s3.PresignClient
	Transport *http.Transport
}

func buildClient(input models.ConnectionInput) *S3Conn {
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

	return &S3Conn{
		Client:    s3Client,
		Presign:   s3Presigner,
		Transport: transport,
	}
}

func probe(ctx context.Context, c *S3Conn) (models.ConnectionOutput, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	if _, err := c.Client.ListBuckets(ctx, &s3.ListBucketsInput{}); err != nil {
		status, mappedErr := describeConnectStatus(err)
		if mappedErr != nil {
			c.Transport.CloseIdleConnections()
		}
		return status, mappedErr
	}

	return models.ConnectionOutput{}, nil
}

func describeConnectStatus(err error) (models.ConnectionOutput, error) {
	var apiErr smithy.APIError
	if errors.As(err, &apiErr) {
		switch apiErr.ErrorCode() {
		case "InvalidAccessKeyId", "SignatureDoesNotMatch", "InvalidClientTokenId":
			return models.ConnectionOutput{Message: S3_ERROR_001}, err
		case "AuthorizationHeaderMalformed", "InvalidRegion":
			return models.ConnectionOutput{Message: S3_ERROR_002}, err
		case "AccessDenied", "AllAccessDisabled", "UnauthorizedAccess":
			return models.ConnectionOutput{Limited: true, Message: S3_WARN_001}, nil
		default:
			return models.ConnectionOutput{Message: apiErr.ErrorMessage()}, err
		}
	}

	if errors.Is(err, context.DeadlineExceeded) {
		return models.ConnectionOutput{Message: S3_ERROR_003}, err
	}

	if err != nil {
		return models.ConnectionOutput{Message: S3_ERROR_004}, err
	}

	return models.ConnectionOutput{}, nil
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
