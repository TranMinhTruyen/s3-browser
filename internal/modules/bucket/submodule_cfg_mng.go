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
	"net/url"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/smithy-go"
	"github.com/minio/madmin-go/v4"
	miniocredentials "github.com/minio/minio-go/v7/pkg/credentials"
)

// submoduleCfgMng builds S3 clients from a profile and probes them. It has no state besides the logger.
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

// buildClient creates the S3 client, presigner and (for MinIO) admin client of input. Each connection
// gets its own http.Transport so Disconnect can close its idle connections without touching others.
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
		// madmin wants a bare host, and the scheme decides whether TLS is used.
		// An endpoint without a scheme (e.g. "localhost:9000") would not parse a host, so default to https.
		endpoint := input.Endpoint
		if !strings.Contains(endpoint, "://") {
			endpoint = "https://" + endpoint
		}
		u, err := url.Parse(endpoint)
		if err == nil && u.Host == "" {
			err = errors.New("endpoint has no host")
		}
		if err != nil {
			m.logger.Error("parse minio endpoint failed", slog.Any("error", err.Error()))
			return conn
		}

		admin, err := madmin.NewWithOptions(u.Host, &madmin.Options{
			Creds:     miniocredentials.NewStaticV4(input.AccessKey, input.SecretKey, ""),
			Secure:    u.Scheme == "https",
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

// probe checks the connection with ListBuckets and maps the error to a connect message.
// AccessDenied is not an error: the connection works but is limited (S3W001, Body.Limited).
// On error it closes the idle connections of c.
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

// describeConnectStatus fills output with the message for err and returns the error that makes the
// connect fail, or nil when the connection is usable (limited access).
func describeConnectStatus(err error, output *models.Output[models.ConnectOutput]) error {
	if errors.Is(err, context.DeadlineExceeded) {
		output.MessageList = []models.Message{
			models.NewMessage(cnst.MessageTypeError, cnst.Bucket, S3E003, err.Error()),
		}
		return err
	}

	errStr := UnwrapAwsError(err)

	switch errStr {
	case "InvalidAccessKeyId", "SignatureDoesNotMatch", "InvalidClientTokenId":
		output.MessageList = []models.Message{
			models.NewMessage(cnst.MessageTypeError, cnst.Bucket, S3E001, errStr),
		}
		return err
	case "AuthorizationHeaderMalformed", "InvalidRegion":
		output.MessageList = []models.Message{
			models.NewMessage(cnst.MessageTypeError, cnst.Bucket, S3E002, errStr),
		}
		return err
	case "AccessDenied", "AllAccessDisabled", "UnauthorizedAccess":
		output.MessageList = []models.Message{
			models.NewMessage(cnst.MessageTypeWarn, cnst.Bucket, S3W001, errStr),
		}
		output.Body.Limited = true
		return nil
	case "":
		output.MessageList = []models.Message{
			models.NewMessage(cnst.MessageTypeError, cnst.Bucket, S3E004, err.Error()),
		}
		return err
	default:
		output.MessageList = []models.Message{
			models.NewMessage(cnst.MessageTypeError, cnst.Bucket, S3E003, errStr),
		}
		return err
	}
}

// UnwrapAwsError returns the error code of an AWS API error, or the text of a smithy
// canceled/serialization/deserialization/operation error. It returns "" for any other error.
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

// newHTTPClient returns an HTTP client with a dedicated transport tuned for many parallel
// transfers: large idle pool, 64 KiB buffers, no HTTP/2 (S3-compatible servers often lack it).
// The transport is returned too so the caller can close its idle connections.
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
