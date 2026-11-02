package bucket

import (
	"S3Browser/internal/modules/global"
	"S3Browser/internal/pkg/cnst"
	"S3Browser/models"
	"cmp"
	"context"
	"crypto/tls"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/smithy-go"
	"github.com/minio/madmin-go/v4"
	"golang.org/x/sync/errgroup"
)

// submoduleCfgMng builds S3 clients from a profile and probes them.
type submoduleCfgMng struct {
	logger *slog.Logger
	oidc   *submoduleOidcMng
}

// newSubmoduleCfgMng builds the client builder; oidc supplies the sign-in sessions of minioOidc profiles.
func newSubmoduleCfgMng(
	logger *slog.Logger,
	oidc *submoduleOidcMng,
) *submoduleCfgMng {
	return &submoduleCfgMng{
		logger: logger.With("submodules", "cfg_mng"),
		oidc:   oidc,
	}
}

// anonymousProbeConcurrency is the most HeadBucket calls at the same time when connecting anonymously.
const anonymousProbeConcurrency = 8

// buildClient creates the S3 client, presigner and (for MinIO) admin client of input. Each connection
// gets its own http.Transport so Disconnect can close its idle connections without touching others.
// The credentials come from buildCredentials, so a credentials failure is returned before any client exists.
// The client signs through a SwapCreds, so ReauthConnection can replace the credentials without a new client.
func (m *submoduleCfgMng) buildClient(
	ctx context.Context,
	input models.ConnectionProfileInput,
) (*global.S3Conn, error) {
	// The extra CA only applies to MinIO connections.
	caFile := ""
	if input.Provider == cnst.ProviderMinio {
		caFile = input.AuthConfig.CaFile
	}
	client, transport, err := newHTTPClient(caFile)
	if err != nil {
		return nil, err
	}

	creds, err := buildCredentials(ctx, input, client, m.oidc)
	if err != nil {
		transport.CloseIdleConnections()
		return nil, err
	}

	conn := &global.S3Conn{
		ProfileName: input.Name,
		Provider:    input.Provider,
		AuthType:    input.AuthType,
		AwsProfile:  cmp.Or(input.AuthConfig.ProfileName, "default"),
		Transport:   transport,
	}
	cfg := aws.Config{
		Credentials:      creds.AWS,
		Region:           cmp.Or(input.Region, creds.Region, defaultS3Region),
		HTTPClient:       client,
		RetryMaxAttempts: 3,
	}

	if creds.Anonymous {
		conn.CredInfo = global.CredInfo{Refreshable: true}
		conn.SetAnonymousBuckets(input.AuthConfig.BucketNames())
	} else {
		conn.Creds = global.NewSwapCreds(creds.AWS)
		expiry := conn.Creds.Expiry
		if input.AuthType == cnst.AuthSSO {
			expiry = creds.Expiry // the SSO login token, not the role credentials the SDK renews
		}
		conn.CredInfo = global.CredInfo{Refreshable: creds.Refreshable, Expiry: expiry}
		cfg.Credentials = conn.Creds
	}

	conn.Client = s3.NewFromConfig(cfg, func(o *s3.Options) {
		// An empty endpoint means AWS itself: leave the SDK to resolve it from the region.
		if input.Endpoint != "" {
			o.BaseEndpoint = aws.String(input.Endpoint)
		}
		o.UsePathStyle = input.PathStyle
	})
	conn.Presign = s3.NewPresignClient(conn.Client)

	if input.Provider == cnst.ProviderMinio && conn.Creds != nil {
		// madmin wants a bare host, and the scheme decides whether TLS is used.
		u, err := url.Parse(normalizeEndpoint(input.Endpoint))
		if err == nil && u.Host == "" {
			err = errors.New("endpoint has no host")
		}
		if err != nil {
			m.logger.Error("parse minio endpoint failed", slog.Any("error", err.Error()))
			return conn, nil
		}

		// A refused admin client must not break the connection: S3 works without it.
		admin, err := madmin.NewWithOptions(u.Host, &madmin.Options{
			Creds:     newAdminCreds(conn.Creds),
			Secure:    u.Scheme == "https",
			Transport: transport,
		})
		if err != nil {
			m.logger.Error("create madmin failed", slog.Any("error", err.Error()))
		} else {
			conn.MinioAdmin = admin
		}
	}

	return conn, nil
}

// normalizeEndpoint adds https:// to an endpoint without a scheme (e.g. "localhost:9000"), which url.Parse
// would not split into a host.
func normalizeEndpoint(endpoint string) string {
	if strings.Contains(endpoint, "://") {
		return endpoint
	}
	return "https://" + endpoint
}

// probe checks the connection and maps the error to a connect message. An anonymous connection checks its
// buckets with HeadBucket, any other one uses ListBuckets.
// AccessDenied is not an error: the connection works but is limited (S3W001, Body.Limited).
// On error it closes the idle connections of c.
func (m *submoduleCfgMng) probe(ctx context.Context, c *global.S3Conn) (models.Output[models.ConnectOutput], error) {
	if c.AuthType == cnst.AuthAnonymous {
		return m.probeAnonymous(ctx, c)
	}

	output := models.NewOutput[models.ConnectOutput]()

	if _, err := c.Client.ListBuckets(ctx, &s3.ListBucketsInput{}); err != nil {
		mappedErr := describeConnectStatus(err, c.ProfileName, &output)
		if mappedErr != nil {
			c.Close()
			m.logger.Error("connect to S3 failed", slog.Any("error", mappedErr.Error()))
		}
		return output, mappedErr
	}

	return output, nil
}

// isS3Answer reports whether err is an answer of the S3 server (AccessDenied, NoSuchBucket, 403, 404...) rather
// than a network failure or timeout.
func isS3Answer(err error) bool {
	var apiErr smithy.APIError
	return errors.As(err, &apiErr)
}

// checkAnonymousBuckets runs HeadBucket on every bucket of an anonymous connection, in parallel, and returns the
// error of each (nil when accessible), in the order of c.AnonymousBuckets(). The Accessible flags are updated
// only when the server answered; on a network failure the previous flag is kept.
func checkAnonymousBuckets(ctx context.Context, c *global.S3Conn) []error {
	buckets := c.AnonymousBuckets()
	errs := make([]error, len(buckets))
	var g errgroup.Group
	g.SetLimit(anonymousProbeConcurrency)
	for i, b := range buckets {
		g.Go(func() error {
			_, errs[i] = c.Client.HeadBucket(ctx, &s3.HeadBucketInput{Bucket: aws.String(b.Name)})
			return nil
		})
	}
	_ = g.Wait()

	for i, err := range errs {
		if err == nil || isS3Answer(err) {
			c.SetAnonymousAccessible(i, err == nil)
		}
	}
	return errs
}

// probeAnonymous checks every entered bucket (checkAnonymousBuckets). One accessible
// bucket is enough to connect; each failed one is reported with S3W009. All failing is S3E044, unless the
// failures are not S3 answers (network, timeout), which are reported as a connect error.
func (m *submoduleCfgMng) probeAnonymous(
	ctx context.Context,
	c *global.S3Conn,
) (models.Output[models.ConnectOutput], error) {
	output := models.NewOutput[models.ConnectOutput]()

	buckets, errs := c.AnonymousBuckets(), checkAnonymousBuckets(ctx, c)

	accessible, networkErr := 0, error(nil)
	for i, err := range errs {
		switch {
		case err == nil:
			accessible++
		case !isS3Answer(err):
			networkErr = err
		}
		if err != nil {
			output.AddMessage(
				models.NewParamsMessage(
					cnst.MessageTypeWarn, cnst.Bucket, S3W009, UnwrapAwsError(err),
					map[string]any{"bucket": buckets[i].Name},
				),
			)
		}
	}
	if accessible > 0 {
		return output, nil
	}

	c.Close()
	failure := models.NewOutput[models.ConnectOutput]()
	err := networkErr
	if err != nil {
		_ = describeConnectStatus(err, c.ProfileName, &failure)
	} else {
		err = errors.New("no entered bucket can be accessed anonymously")
		failure.MessageList = []models.Message{models.NewMessage(cnst.MessageTypeError, cnst.Bucket, S3E044, "")}
	}
	m.logger.Error("connect to S3 anonymously failed", slog.Any("error", err.Error()))
	return failure, err
}

// describeConnectStatus fills output with the message for err and returns the error that makes the
// connect fail, or nil when the connection is usable (limited access). name is the profile name.
func describeConnectStatus(err error, name string, output *models.Output[models.ConnectOutput]) error {
	if errors.Is(err, context.DeadlineExceeded) {
		output.MessageList = []models.Message{
			models.NewMessage(cnst.MessageTypeError, cnst.Bucket, S3E003, err.Error()),
		}
		return err
	}

	var credErr *credError
	if errors.As(err, &credErr) {
		output.MessageList = []models.Message{
			models.NewParamsMessage(
				cnst.MessageTypeError,
				cmp.Or(credErr.module, cnst.Bucket),
				credErr.code,
				credErr.Error(),
				credErr.params,
			),
		}
		return err
	}

	if isCredentialsExpired(err) {
		output.MessageList = []models.Message{expiredMessage(name, err)}
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
// A non-empty caFile adds its certificates to the system CA pool (S3E049 if it can't be loaded). TLSClientConfig is
// always set: minio-go's certificate STS call writes into it.
func newHTTPClient(caFile string) (*http.Client, *http.Transport, error) {
	tlsConfig := &tls.Config{}
	if caFile != "" {
		pool, err := loadCaPool(caFile)
		if err != nil {
			return nil, nil, err
		}
		tlsConfig.RootCAs = pool
	}

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
		TLSClientConfig:       tlsConfig,
	}

	return &http.Client{Transport: tr}, tr, nil
}
