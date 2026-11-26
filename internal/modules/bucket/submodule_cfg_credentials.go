package bucket

import (
	"S3Browser/internal/modules/profile"
	"S3Browser/internal/pkg/cnst"
	"S3Browser/models"
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/user"
	"regexp"
	"strings"
	"sync/atomic"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/credentials/processcreds"
	"github.com/aws/aws-sdk-go-v2/credentials/ssocreds"
	"github.com/aws/aws-sdk-go-v2/credentials/stscreds"
	"github.com/aws/aws-sdk-go-v2/service/sts"
	"github.com/aws/smithy-go"
	miniocredentials "github.com/minio/minio-go/v7/pkg/credentials"
)

const (
	// credExpiryWindow là khoảng thời gian trước khi hết hạn để gia hạn thông tin xác thực đã lưu tạm.
	credExpiryWindow = 5 * time.Minute

	// defaultSTSRegion dùng để ký yêu cầu STS của AssumeRole khi cả hồ sơ lẫn hồ sơ CLI đều không có region.
	defaultSTSRegion = "us-east-1"

	// defaultS3Region được dùng khi hồ sơ hoàn toàn không có region (AWS chấp nhận mọi region với endpoint toàn cục;
	// SDK sẽ chuyển hướng đến region của bucket).
	defaultS3Region = "us-east-1"

	// defaultAssumeRoleDuration là thời lượng phiên nếu hồ sơ không chỉ định giá trị này.
	defaultAssumeRoleDuration = time.Hour
)

// credSet là giá trị buildCredentials trả về cho một kết nối.
type credSet struct {
	// AWS ký các yêu cầu S3.
	AWS aws.CredentialsProvider
	// Lấy Region từ hồ sơ CLI nếu hồ sơ hiện tại chưa có.
	Region string
	// Refreshable là false nếu không thể gia hạn thông tin xác thực mà không cần người dùng (xem global.CredInfo).
	Refreshable bool
	// Anonymous cho biết yêu cầu không được ký.
	Anonymous bool
	// Nếu được đặt, Expiry thay thế thời hạn của thông tin xác thực lấy được để dùng làm mốc cảnh báo cho người dùng
	// (token đăng nhập SSO). Expiry bằng nil trên hồ sơ sso nghĩa là chưa xác định được thời hạn.
	Expiry func() (time.Time, bool)
}

// credError là lỗi thông tin xác thực có mã thông báo riêng (S3E030 - S3E038, PFE009), xem describeConnectStatus.
type credError struct {
	// module là module sở hữu thông báo; để trống nghĩa là module bucket.
	module string
	code   string
	params map[string]any
	err    error
}

func (e *credError) Error() string { return e.err.Error() }
func (e *credError) Unwrap() error { return e.err }

// errMFACodeRequired cho biết nhà cung cấp token MFA chỉ cấp mã một lần nhưng lại được gọi lần nữa:
// phiên MFA đã hết hạn và cần mã mới. Lỗi này được báo bằng S3E030, giống token hết hạn.
var errMFACodeRequired = errors.New("MFA code is required")

// buildCredentials chọn thông tin xác thực theo input.AuthType và lấy chúng một lần, nhờ đó hồ sơ sai,
// phiên SSO hết hạn hoặc role bị từ chối sẽ báo lỗi cụ thể tại đây thay vì đợi đến yêu cầu đầu tiên.
// httpClient là client của kết nối, dùng cho các yêu cầu MinIO STS; oidc lưu các phiên đăng nhập.
func buildCredentials(
	ctx context.Context,
	input models.ConnectionProfileInput,
	httpClient *http.Client,
	oidc *submoduleOidcMng,
) (credSet, error) {
	switch input.AuthType {
	case "", cnst.AuthStatic:
		return staticCredentials(input), nil
	case cnst.AuthSharedProfile, cnst.AuthSSO:
		return profileCredentials(ctx, input)
	case cnst.AuthAssumeRole:
		return assumeRoleCredentials(ctx, input)
	case cnst.AuthDefaultChain:
		return defaultChainCredentials(ctx, input)
	case cnst.AuthAnonymous:
		return anonymousCredentials(input)
	case cnst.AuthMinioAssumeRole, cnst.AuthMinioLdap:
		return minioSTSCredentials(ctx, input, httpClient)
	case cnst.AuthMinioOidc:
		return minioOidcCredentials(ctx, input, httpClient, oidc)
	case cnst.AuthMinioCert:
		return minioCertCredentials(ctx, input, httpClient)
	default:
		return credSet{}, fmt.Errorf("authentication method %q is not supported yet", input.AuthType)
	}
}

// staticCredentials ký yêu cầu bằng access key, secret key và session token nếu có.
func staticCredentials(input models.ConnectionProfileInput) credSet {
	token := input.AuthSecret.SessionToken
	return credSet{
		AWS: credentials.NewStaticCredentialsProvider(input.AccessKey, input.SecretKey, token),
		// Session token có thể hết hạn nhưng không xác định được thời điểm, nên không thể gửi cảnh báo trước.
		Refreshable: true,
	}
}

// profileCredentials dùng hồ sơ AWS CLI (khóa tĩnh, role_arn, credential_process, SSO).
// SDK tự gia hạn thông tin xác thực role của hồ sơ SSO, nhưng chỉ khi token đăng nhập SSO còn hạn,
// vì vậy thời hạn hiển thị cho người dùng của sso là thời hạn token đó (ssoTokenExpiry), không phải thời hạn thông tin xác thực role.
func profileCredentials(ctx context.Context, input models.ConnectionProfileInput) (credSet, error) {
	awsCfg, err := loadAwsConfig(ctx, input.AuthConfig, true)
	if err != nil {
		return credSet{}, mapCredError(input, err)
	}
	isSSO := input.AuthType == cnst.AuthSSO
	set, err := retrieveCredSet(ctx, input, awsCfg.Credentials, awsCfg.Region, !isSSO)
	if isSSO {
		set.Expiry = ssoTokenExpiry(awsCfg)
	}
	return set, err
}

// ssoTokenExpiry trả về hàm đọc thời hạn token đăng nhập SSO đã lưu tạm của hồ sơ, hoặc nil nếu không tìm thấy token.
// Hàm chỉ đọc ~/.aws/sso/cache và trả false nếu file không tồn tại hoặc không đọc được, nhờ đó thời hạn chưa biết
// sẽ không kích hoạt cảnh báo.
func ssoTokenExpiry(awsCfg aws.Config) func() (time.Time, bool) {
	var key string
	for _, src := range awsCfg.ConfigSources {
		// Tên file cache dựa trên sso-session hoặc URL khởi tạo của hồ sơ cũ.
		// Như SDK, cấu hình dùng chung đầu tiên sẽ được ưu tiên.
		switch shared := src.(type) {
		case config.SharedConfig:
			key = cmp.Or(shared.SSOSessionName, shared.SSOStartURL)
		case *config.SharedConfig:
			key = cmp.Or(shared.SSOSessionName, shared.SSOStartURL)
		}
		if key != "" {
			break
		}
	}
	if key == "" {
		return nil
	}
	path, err := ssocreds.StandardCachedTokenFilepath(key)
	if err != nil {
		return nil
	}

	return func() (time.Time, bool) {
		data, err := os.ReadFile(path)
		if err != nil {
			return time.Time{}, false
		}
		var token struct {
			ExpiresAt string `json:"expiresAt"`
		}
		if json.Unmarshal(data, &token) != nil {
			return time.Time{}, false
		}
		// AWS CLI v1 ghi "...UTC" thay vì "Z".
		at, err := time.Parse(time.RFC3339, strings.Replace(token.ExpiresAt, "UTC", "Z", 1))
		return at, err == nil
	}
}

// defaultChainCredentials dùng chuỗi mặc định của AWS SDK: biến môi trường, file dùng chung, role của container/EC2.
func defaultChainCredentials(ctx context.Context, input models.ConnectionProfileInput) (credSet, error) {
	awsCfg, err := loadAwsConfig(ctx, models.AuthConfig{}, false)
	if err != nil {
		return credSet{}, mapCredError(input, err)
	}
	return retrieveCredSet(ctx, input, awsCfg.Credentials, awsCfg.Region, true)
}

// assumeRoleCredentials gọi STS AssumeRole với khóa tĩnh hoặc hồ sơ CLI làm nguồn. Khi có MFA serial,
// mã dùng một lần chỉ được dùng một lần và thông tin xác thực không thể gia hạn nếu thiếu mã mới.
func assumeRoleCredentials(ctx context.Context, input models.ConnectionProfileInput) (credSet, error) {
	cfg := input.AuthConfig

	var source aws.CredentialsProvider
	region := input.Region
	if cfg.SourceType == "profile" {
		awsCfg, err := loadAwsConfig(ctx, cfg, true)
		if err != nil {
			return credSet{}, mapCredError(input, err)
		}
		source, region = awsCfg.Credentials, cmp.Or(region, awsCfg.Region)
	} else {
		source = staticCredentials(input).AWS
	}

	stsClient := sts.NewFromConfig(aws.Config{
		Credentials: source,
		Region:      cmp.Or(region, defaultSTSRegion),
	})
	provider := stscreds.NewAssumeRoleProvider(stsClient, cfg.RoleArn, func(o *stscreds.AssumeRoleOptions) {
		o.RoleSessionName = cmp.Or(cfg.SessionName, defaultSessionName())
		o.Duration = defaultAssumeRoleDuration
		if cfg.DurationSeconds > 0 {
			o.Duration = time.Duration(cfg.DurationSeconds) * time.Second
		}
		if cfg.ExternalId != "" {
			o.ExternalID = aws.String(cfg.ExternalId)
		}
		if cfg.MfaSerial != "" {
			o.SerialNumber = aws.String(cfg.MfaSerial)
			o.TokenProvider = oneTimeToken(input.MfaCode)
		}
	})
	// Nếu có MFA, gia hạn sớm 5 phút sẽ cần mã mới và thất bại, vì vậy dùng thông tin xác thực đến khi hết hạn
	// rồi cảnh báo người dùng qua sự kiện credential-expiring.
	renewable := cfg.MfaSerial == ""
	cached := aws.NewCredentialsCache(provider, func(o *aws.CredentialsCacheOptions) {
		if renewable {
			o.ExpiryWindow = credExpiryWindow
		}
	})

	return retrieveCredSet(ctx, input, cached, region, renewable)
}

// retrieveCredSet lấy thông tin xác thực một lần để phát hiện lỗi, rồi bọc provider trong credSet.
func retrieveCredSet(
	ctx context.Context,
	input models.ConnectionProfileInput,
	provider aws.CredentialsProvider,
	region string,
	refreshable bool,
) (credSet, error) {
	if _, err := provider.Retrieve(ctx); err != nil {
		return credSet{}, mapCredError(input, err)
	}
	return credSet{AWS: provider, Region: region, Refreshable: refreshable}, nil
}

// loadAwsConfig tải cấu hình AWS CLI. Khi useProfile được bật, hàm đọc cfg.ProfileName ("default" nếu để trống)
// từ các file trong cfg (hoặc các file ~/.aws mặc định, AWS_CONFIG_FILE và AWS_SHARED_CREDENTIALS_FILE).
func loadAwsConfig(ctx context.Context, cfg models.AuthConfig, useProfile bool) (aws.Config, error) {
	var opts []func(*config.LoadOptions) error
	if useProfile {
		opts = append(opts, config.WithSharedConfigProfile(cmp.Or(cfg.ProfileName, "default")))
		if cfg.ConfigFile != "" {
			opts = append(opts, config.WithSharedConfigFiles([]string{expandHome(cfg.ConfigFile)}))
		}
		if cfg.CredentialsFile != "" {
			opts = append(opts, config.WithSharedCredentialsFiles([]string{expandHome(cfg.CredentialsFile)}))
		}
	}
	return config.LoadDefaultConfig(ctx, opts...)
}

// anonymousCredentials gửi yêu cầu không ký. Cần có bucket do người dùng nhập vì client ẩn danh không thể
// liệt kê bucket hoặc kiểm tra endpoint nếu thiếu bucket.
func anonymousCredentials(input models.ConnectionProfileInput) (credSet, error) {
	if len(input.AuthConfig.BucketNames()) == 0 {
		err := errors.New("anonymous access needs at least one bucket")
		return credSet{}, &credError{module: cnst.Profile, code: profile.PFE009, err: err}
	}
	return credSet{AWS: aws.AnonymousCredentials{}, Refreshable: true, Anonymous: true}, nil
}

// minioSTSCredentials yêu cầu endpoint MinIO STS (endpoint S3) cấp thông tin xác thực tạm thời:
// AssumeRole bằng access key và secret key, hoặc LDAP bằng tên người dùng và mật khẩu LDAP. MinIO tự gia hạn chúng.
func minioSTSCredentials(
	ctx context.Context,
	input models.ConnectionProfileInput,
	httpClient *http.Client,
) (credSet, error) {
	cfg := input.AuthConfig
	endpoint := normalizeEndpoint(input.Endpoint)
	duration := time.Duration(cfg.DurationSeconds) * time.Second

	var (
		minio *miniocredentials.Credentials
		err   error
	)
	if input.AuthType == cnst.AuthMinioLdap {
		var opts []miniocredentials.LDAPIdentityOpt
		if duration > 0 {
			opts = append(opts, miniocredentials.LDAPIdentityExpiryOpt(duration))
		}
		minio, err = miniocredentials.NewLDAPIdentity(
			endpoint,
			cfg.LdapUsername,
			input.AuthSecret.LdapPassword,
			opts...)
	} else {
		minio, err = miniocredentials.NewSTSAssumeRole(endpoint, miniocredentials.STSAssumeRoleOptions{
			AccessKey:       input.AccessKey,
			SecretKey:       input.SecretKey,
			Policy:          cfg.Policy,
			Location:        input.Region, // the signing region of a MinIO with a custom region
			DurationSeconds: int(duration.Seconds()),
		})
	}
	if err != nil {
		return credSet{}, err
	}

	return minioCredSet(ctx, input, minio, httpClient, endpoint, credExpiryWindow, true)
}

// minioCredSet bọc thông tin xác thực MinIO cho AWS SDK và lấy chúng một lần để phát hiện lỗi STS.
// expiryWindow là khoảng thời gian trước hạn để gia hạn; refreshable cho biết có thể gia hạn mà không cần người dùng hay không.
// minio giữ các thông tin bí mật được dùng để tạo nó (mật khẩu, khóa) nhằm tự gia hạn thông tin xác thực.
// Giá trị này chỉ được provider trả về tham chiếu; SwapCreds loại bỏ nó khi Reauth và không ghi log.
func minioCredSet(
	ctx context.Context,
	input models.ConnectionProfileInput,
	minio *miniocredentials.Credentials,
	httpClient *http.Client,
	endpoint string,
	expiryWindow time.Duration,
	refreshable bool,
) (credSet, error) {
	provider := aws.NewCredentialsCache(
		&minioProvider{creds: minio, client: httpClient, endpoint: endpoint},
		func(o *aws.CredentialsCacheOptions) { o.ExpiryWindow = expiryWindow },
	)
	return retrieveCredSet(ctx, input, provider, "", refreshable)
}

// minioOidcCredentials đổi token của phiên đăng nhập OIDC lấy thông tin xác thực MinIO (AssumeRoleWithWebIdentity).
// Token chỉ được cấp một lần và có thể không còn hợp lệ ở lần gia hạn tiếp theo; khi đó người dùng phải đăng nhập lại
// (S3E030), MinIO không thể tự gia hạn.
func minioOidcCredentials(
	ctx context.Context,
	input models.ConnectionProfileInput,
	httpClient *http.Client,
	oidc *submoduleOidcMng,
) (credSet, error) {
	session, ok := oidc.session(input.OidcSessionId)
	if !ok {
		return credSet{}, &credError{code: S3E047, err: errors.New("OIDC session not found or expired")}
	}

	var used atomic.Bool
	idToken, accessToken := session.idToken, session.accessToken
	tokens := func() (*miniocredentials.WebIdentityToken, error) {
		if used.Swap(true) {
			return nil, errOidcLoginRequired
		}
		token := &miniocredentials.WebIdentityToken{Token: idToken, AccessToken: accessToken}
		idToken, accessToken = "", "" // not kept after the single use
		return token, nil
	}
	endpoint := normalizeEndpoint(input.Endpoint)
	minio, err := miniocredentials.NewSTSWebIdentity(endpoint, tokens, func(i *miniocredentials.STSWebIdentity) {
		i.RoleARN = input.AuthConfig.RoleArn
	})
	if err != nil {
		return credSet{}, err
	}
	// Không gia hạn sớm vì cần đăng nhập lại; dùng thông tin xác thực đến khi hết hạn.
	return minioCredSet(ctx, input, minio, httpClient, endpoint, 0, false)
}

// minioCertCredentials yêu cầu MinIO STS cấp thông tin xác thực bằng chứng chỉ TLS của client (AssumeRoleWithCertificate).
// MinIO yêu cầu https; chứng chỉ được gửi qua transport của httpClient.
func minioCertCredentials(
	ctx context.Context,
	input models.ConnectionProfileInput,
	httpClient *http.Client,
) (credSet, error) {
	endpoint := normalizeEndpoint(input.Endpoint)
	if !strings.HasPrefix(strings.ToLower(endpoint), "https://") {
		err := errors.New("certificate authentication needs an https endpoint")
		return credSet{}, &credError{module: cnst.Profile, code: profile.PFE009, err: err}
	}

	cfg := input.AuthConfig
	cert, err := loadClientCertificate(cfg.CertFile, cfg.KeyFile, input.AuthSecret.KeyPassword)
	if err != nil {
		return credSet{}, err
	}
	minio, err := miniocredentials.NewSTSCertificateIdentity(endpoint, cert)
	if err != nil {
		return credSet{}, err
	}
	return minioCredSet(ctx, input, minio, httpClient, endpoint, credExpiryWindow, true)
}

// minioProvider chuyển đổi thông tin xác thực MinIO sang định dạng AWS SDK để client S3 và madmin dùng chung một phiên STS.
type minioProvider struct {
	creds    *miniocredentials.Credentials
	client   *http.Client
	endpoint string
}

// Retrieve trả về thông tin xác thực MinIO đã lưu tạm hoặc yêu cầu STS cấp lại khi chúng sắp hết hạn.
func (p *minioProvider) Retrieve(ctx context.Context) (aws.Credentials, error) {
	v, err := p.creds.GetWithContext(
		&miniocredentials.CredContext{Client: p.client, Endpoint: p.endpoint, Context: ctx},
	)
	if err != nil {
		return aws.Credentials{}, err
	}
	return aws.Credentials{
		AccessKeyID:     v.AccessKeyID,
		SecretAccessKey: v.SecretAccessKey,
		SessionToken:    v.SessionToken,
		Source:          "MinIOSTS",
		CanExpire:       !v.Expiration.IsZero(),
		Expires:         v.Expiration,
	}, nil
}

// oneTimeToken trả về provider MFA chỉ cấp mã một lần: mã chỉ dùng được một lần nên lần gia hạn sau phải thất bại,
// không được gửi lại cùng mã.
func oneTimeToken(code string) func() (string, error) {
	var used atomic.Bool
	return func() (string, error) {
		if code == "" || used.Swap(true) {
			return "", errMFACodeRequired
		}
		return code, nil
	}
}

var invalidSessionNameChars = regexp.MustCompile(`[^\w+=,.@-]`)

// defaultSessionName tạo tên s3browser-<os user> và loại bỏ các ký tự STS không chấp nhận.
func defaultSessionName() string {
	name := "s3browser"
	if u, err := user.Current(); err == nil {
		name += "-" + invalidSessionNameChars.ReplaceAllString(u.Username, "-")
	}
	return name
}

// mapCredError bọc err trong credError nếu lỗi khớp với một lỗi thông tin xác thực đã biết; nếu không thì trả nguyên lỗi.
func mapCredError(input models.ConnectionProfileInput, err error) error {
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return err
	}

	cfg := input.AuthConfig
	profileParams := map[string]any{"profile": cfg.ProfileName}

	var (
		notExist     config.SharedConfigProfileNotExistError
		roleErr      config.SharedConfigAssumeRoleError
		needARN      config.CredentialRequiresARNError
		invalidToken *ssocreds.InvalidTokenError
		processErr   *processcreds.ProviderError
		stsErr       miniocredentials.ErrorResponse
		apiErr       smithy.APIError
	)
	isAPI := errors.As(err, &apiErr)

	switch {
	case errors.As(err, &notExist), errors.As(err, &roleErr), errors.As(err, &needARN):
		return &credError{code: S3E033, params: profileParams, err: err}
	case errors.As(err, &invalidToken),
		input.AuthType == cnst.AuthSSO && isAPI && isSsoSessionCode(apiErr.ErrorCode()):
		return &credError{code: S3E034, params: profileParams, err: err}
	case errors.As(err, &processErr):
		return &credError{code: S3E036, params: profileParams, err: err}
	case input.AuthType == cnst.AuthDefaultChain && !isAPI:
		return &credError{code: S3E035, err: err}
	case errors.As(err, &stsErr):
		// MinIO đã phản hồi nhưng từ chối yêu cầu STS.
		if input.AuthType == cnst.AuthMinioLdap {
			return &credError{code: S3E038, err: err}
		}
		return &credError{code: S3E037, err: err}
	case isAPI && apiErr.ErrorCode() == "AccessDenied":
		return assumeRoleDenied(input, err)
	}
	return err
}

// isSsoSessionCode cho biết code có nghĩa là phiên đăng nhập SSO đã mất hoặc không còn hợp lệ hay không.
func isSsoSessionCode(code string) bool {
	switch code {
	case "UnauthorizedException", "InvalidGrantException", "ExpiredTokenException":
		return true
	}
	return false
}

// assumeRoleDenied phân biệt mã MFA sai (S3E032) với role không thể AssumeRole (S3E031). Hồ sơ CLI dùng chuỗi role_arn
// không có ARN trong input nên thay vào đó hiển thị tên hồ sơ.
func assumeRoleDenied(input models.ConnectionProfileInput, err error) error {
	cfg := input.AuthConfig
	if cfg.MfaSerial != "" && strings.Contains(err.Error(), "MultiFactorAuthentication") {
		return &credError{code: S3E032, err: err}
	}
	params := map[string]any{"roleArn": cmp.Or(cfg.RoleArn, cfg.ProfileName)}
	return &credError{code: S3E031, params: params, err: err}
}
