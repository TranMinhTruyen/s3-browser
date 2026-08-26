package bucket

import (
	"context"
	"errors"
	"minio-browser/models"
	"net"
	"net/http"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/smithy-go"
)

type S3Conn struct {
	Client    *s3.Client
	Presign   *s3.PresignClient
	Transport *http.Transport
}

func buildClient(ctx context.Context, input models.ConnectionInput) *S3Conn {
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
			return models.ConnectionOutput{
				Message: "access key or secret key is not valid for this endpoint",
			}, err
		case "AuthorizationHeaderMalformed", "InvalidRegion":
			return models.ConnectionOutput{Message: "the endpoint rejected"}, err
		case "AccessDenied", "AllAccessDisabled", "UnauthorizedAccess":
			return models.ConnectionOutput{
				Limited: true,
				Message: "Access bucket is limited",
			}, nil
		default:
			return models.ConnectionOutput{Message: apiErr.ErrorMessage()}, err
		}
	}

	if errors.Is(err, context.DeadlineExceeded) {
		return models.ConnectionOutput{
			Message: "timed out reaching the endpoint, check the address and whether the server is running",
		}, err
	}

	if err != nil {
		return models.ConnectionOutput{Message: err.Error()}, err
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
