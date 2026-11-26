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

// submoduleCfgMng tạo client S3 từ hồ sơ và kiểm tra các client đó.
type submoduleCfgMng struct {
	logger *slog.Logger
	oidc   *submoduleOidcMng
}

// newSubmoduleCfgMng tạo bộ dựng client; oidc cung cấp phiên đăng nhập cho hồ sơ minioOidc.
func newSubmoduleCfgMng(
	logger *slog.Logger,
	oidc *submoduleOidcMng,
) *submoduleCfgMng {
	return &submoduleCfgMng{
		logger: logger.With("submodules", "cfg_mng"),
		oidc:   oidc,
	}
}

// anonymousProbeConcurrency là số lần gọi HeadBucket tối đa chạy đồng thời khi kết nối ẩn danh.
const anonymousProbeConcurrency = 8

// buildClient tạo client S3, presigner và (với MinIO) client quản trị theo input. Mỗi kết nối có http.Transport riêng
// để Disconnect có thể đóng các kết nối nhàn rỗi mà không ảnh hưởng kết nối khác.
// Thông tin xác thực lấy từ buildCredentials nên lỗi xác thực được trả về trước khi tạo client.
// Client ký yêu cầu qua SwapCreds để ReauthConnection có thể thay thông tin xác thực mà không cần tạo client mới.
func (m *submoduleCfgMng) buildClient(
	ctx context.Context,
	input models.ConnectionProfileInput,
) (*global.S3Conn, error) {
	// CA bổ sung chỉ áp dụng cho kết nối MinIO.
	caFile := ""
	if input.Provider == cnst.ProviderMinio {
		caFile = input.AuthConfig.CaFile
	}
	transport, err := newTransport(caFile)
	if err != nil {
		return nil, err
	}

	// Provider thông tin xác thực (minio-go) cần transport nguyên bản; chỉ client S3 dùng http11Transport.
	creds, err := buildCredentials(ctx, input, &http.Client{Transport: transport}, m.oidc)
	if err != nil {
		transport.CloseIdleConnections()
		return nil, err
	}

	conn := &global.S3Conn{
		ProfileName:    input.Name,
		Provider:       input.Provider,
		AuthType:       input.AuthType,
		AwsProfile:     cmp.Or(input.AuthConfig.ProfileName, "default"),
		CustomEndpoint: input.Endpoint != "",
		Transport:      transport,
	}
	cfg := aws.Config{
		Credentials:      creds.AWS,
		Region:           cmp.Or(input.Region, creds.Region, defaultS3Region),
		HTTPClient:       &http.Client{Transport: http11Transport{transport}},
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
		// Endpoint rỗng nghĩa là AWS thật: để SDK tự phân giải theo region.
		if input.Endpoint != "" {
			o.BaseEndpoint = aws.String(input.Endpoint)
		}
		o.UsePathStyle = input.PathStyle
	})
	conn.Presign = s3.NewPresignClient(conn.Client)

	if input.Provider == cnst.ProviderMinio && conn.Creds != nil {
		// madmin cần host thuần; scheme quyết định có dùng TLS hay không.
		u, err := url.Parse(normalizeEndpoint(input.Endpoint))
		if err == nil && u.Host == "" {
			err = errors.New("endpoint has no host")
		}
		if err != nil {
			m.logger.Error("parse minio endpoint failed", slog.Any("error", err.Error()))
			return conn, nil
		}

		// Không để lỗi khởi tạo client quản trị làm hỏng kết nối: S3 vẫn hoạt động khi thiếu client này.
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

// normalizeEndpoint thêm https:// vào endpoint chưa có scheme (ví dụ "localhost:9000"), vì url.Parse
// không thể tách chuỗi đó thành host.
func normalizeEndpoint(endpoint string) string {
	if strings.Contains(endpoint, "://") {
		return endpoint
	}
	return "https://" + endpoint
}

// probe kiểm tra kết nối và ánh xạ lỗi sang thông báo kết nối. Kết nối ẩn danh kiểm tra bucket bằng HeadBucket,
// các kết nối khác dùng ListBuckets.
// AccessDenied không được xem là lỗi: kết nối vẫn hoạt động nhưng bị giới hạn (S3W001, Body.Limited).
// Nếu có lỗi, hàm đóng các kết nối nhàn rỗi của c.
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

// checkAnonymousBuckets gọi HeadBucket song song cho mọi bucket của kết nối ẩn danh rồi trả lỗi tương ứng của từng bucket
// (nil nếu truy cập được), theo thứ tự trong c.AnonymousBuckets(). Chỉ cập nhật cờ Accessible khi máy chủ phản hồi;
// nếu lỗi mạng thì giữ nguyên cờ trước đó.
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
		if err == nil || statusCode(err) != 0 {
			c.SetAnonymousAccessible(i, err == nil)
		}
	}
	return errs
}

// probeAnonymous kiểm tra mọi bucket đã nhập (checkAnonymousBuckets). Chỉ cần một bucket truy cập được là có thể kết nối;
// mỗi bucket thất bại được báo bằng S3W009. Nếu tất cả đều thất bại thì trả S3E044, trừ khi lỗi không phải phản hồi S3
// (lỗi mạng, timeout), khi đó báo lỗi kết nối.
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
		case statusCode(err) == 0:
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

// describeConnectStatus điền thông báo tương ứng với err vào output và trả lỗi khiến kết nối thất bại,
// hoặc nil nếu kết nối vẫn sử dụng được (quyền truy cập bị giới hạn). name là tên hồ sơ.
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

// UnwrapAwsError trả mã lỗi của AWS API hoặc nội dung lỗi canceled/serialization/deserialization/operation của smithy.
// Với lỗi khác, hàm trả "".
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

// newTransport trả về transport riêng được tinh chỉnh cho nhiều lượt truyền song song: pool kết nối nhàn rỗi lớn,
// bộ đệm 64 KiB, không dùng HTTP/2 (máy chủ tương thích S3 thường không hỗ trợ). Bên gọi đóng các kết nối nhàn rỗi.
// Nếu caFile không rỗng, chứng chỉ được thêm vào kho CA của hệ thống (không nạp được thì trả S3E049).
// TLSClientConfig luôn được thiết lập vì lời gọi STS bằng chứng chỉ của minio-go ghi cấu hình vào đây.
func newTransport(caFile string) (*http.Transport, error) {
	tlsConfig := &tls.Config{}
	if caFile != "" {
		pool, err := loadCaPool(caFile)
		if err != nil {
			return nil, err
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
		ExpectContinueTimeout: 1 * time.Second, // needed with http11Transport for "Expect: 100-continue"
		TLSClientConfig:       tlsConfig,
	}

	return tr, nil
}

// http11Transport đặt giao thức của yêu cầu thành HTTP/1.1 trước khi gửi. smithy-go để Proto là 0.0,
// còn net/http chỉ xử lý "Expect: 100-continue" với HTTP/1.1. Nếu thiếu thiết lập này, body được gửi ngay
// và lượt tải lên có thể bị treo khi máy chủ từ chối sớm (ví dụ 403) rồi ngừng đọc.
// Chỉ client S3 dùng transport này: lời gọi STS bằng chứng chỉ của minio-go ép kiểu transport của client thành
// *http.Transport, vì vậy provider xác thực và madmin vẫn dùng transport nguyên bản.
type http11Transport struct{ http.RoundTripper }

func (t http11Transport) RoundTrip(r *http.Request) (*http.Response, error) {
	if !r.ProtoAtLeast(1, 1) {
		r = r.WithContext(r.Context()) // shallow copy: a RoundTripper must not modify the request
		r.Proto, r.ProtoMajor, r.ProtoMinor = "HTTP/1.1", 1, 1
	}
	return t.RoundTripper.RoundTrip(r)
}
