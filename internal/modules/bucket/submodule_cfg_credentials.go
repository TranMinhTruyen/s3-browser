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
	// credExpiryWindow renews cached credentials this long before they expire.
	credExpiryWindow = 5 * time.Minute

	// defaultSTSRegion signs the STS call of AssumeRole when neither the profile nor the CLI profile has a region.
	defaultSTSRegion = "us-east-1"

	// defaultS3Region is used when the profile has no region at all (AWS accepts any region for the
	// global endpoint; the SDK redirects to the bucket's region).
	defaultS3Region = "us-east-1"

	// defaultAssumeRoleDuration is the session length when the profile doesn't set one.
	defaultAssumeRoleDuration = time.Hour
)

// credSet is what buildCredentials returns for one connection.
type credSet struct {
	// AWS signs the S3 requests.
	AWS aws.CredentialsProvider
	// Minio signs the madmin requests; nil when the method has no MinIO equivalent.
	Minio *miniocredentials.Credentials
	// Region comes from the CLI profile when the profile has none.
	Region string
	// Refreshable is false when the credentials can't be renewed without the user (see global.CredInfo).
	Refreshable bool
	// Anonymous means requests are not signed.
	Anonymous bool
	// Expiry, when set, replaces the expiry of the retrieved credentials as what the user is warned about (SSO
	// login token). A nil Expiry on an sso profile means the expiry is unknown.
	Expiry func() (time.Time, bool)
}

// credError is a credentials failure with its own message code (S3E030 - S3E038, PFE009), see describeConnectStatus.
type credError struct {
	// module is the message module; empty means the bucket module.
	module string
	code   string
	params map[string]any
	err    error
}

func (e *credError) Error() string { return e.err.Error() }
func (e *credError) Unwrap() error { return e.err }

// errMFACodeRequired means an MFA token provider that hands out a code once was asked again: the MFA session
// expired and needs a new code. It is reported as S3E030, like an expired token.
var errMFACodeRequired = errors.New("MFA code is required")

// buildCredentials resolves the credentials of input.AuthType and retrieves them once, so a wrong profile,
// an expired SSO session or a rejected role fails here with a specific message instead of at the first request.
// httpClient is the one of the connection, used for the MinIO STS calls.
func buildCredentials(
	ctx context.Context,
	input models.ConnectionProfileInput,
	httpClient *http.Client,
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
	default:
		return credSet{}, fmt.Errorf("authentication method %q is not supported yet", input.AuthType)
	}
}

// staticCredentials signs with the access key, secret key and the optional session token.
func staticCredentials(input models.ConnectionProfileInput) credSet {
	token := input.AuthSecret.SessionToken
	return credSet{
		AWS:   credentials.NewStaticCredentialsProvider(input.AccessKey, input.SecretKey, token),
		Minio: miniocredentials.NewStaticV4(input.AccessKey, input.SecretKey, token),
		// A session token may expire, but not at a time we know, so there is nothing to warn about.
		Refreshable: true,
	}
}

// profileCredentials uses an AWS CLI profile (static keys, role_arn, credential_process, SSO).
// The SDK renews the role credentials of an SSO profile on its own, but only while the SSO login token is valid,
// so for sso the user-facing expiry is the one of that token (ssoTokenExpiry), not of the role credentials.
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

// ssoTokenExpiry returns a function that reads when the cached SSO login token of the profile expires, or nil
// when the token can't be located. The function only reads ~/.aws/sso/cache and reports false when the file is
// missing or unreadable, so an unknown expiry never triggers a warning.
func ssoTokenExpiry(awsCfg aws.Config) func() (time.Time, bool) {
	var key string
	for _, src := range awsCfg.ConfigSources {
		// The cache file is named after the sso-session, or after the start URL of a legacy profile.
		// The first shared config wins, as in the SDK.
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
		// AWS CLI v1 wrote "...UTC" instead of "Z".
		at, err := time.Parse(time.RFC3339, strings.Replace(token.ExpiresAt, "UTC", "Z", 1))
		return at, err == nil
	}
}

// defaultChainCredentials uses the AWS SDK default chain: environment, shared files, container/EC2 role.
func defaultChainCredentials(ctx context.Context, input models.ConnectionProfileInput) (credSet, error) {
	awsCfg, err := loadAwsConfig(ctx, models.AuthConfig{}, false)
	if err != nil {
		return credSet{}, mapCredError(input, err)
	}
	return retrieveCredSet(ctx, input, awsCfg.Credentials, awsCfg.Region, true)
}

// assumeRoleCredentials calls STS AssumeRole with static keys or a CLI profile as the source. With an MFA
// serial the one-time code is used once and the credentials cannot be renewed without a new code.
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
	// With MFA a renewal 5 minutes early would ask for a new code and fail, so the credentials are used until
	// they expire and the user is warned by the credential-expiring event instead.
	renewable := cfg.MfaSerial == ""
	cached := aws.NewCredentialsCache(provider, func(o *aws.CredentialsCacheOptions) {
		if renewable {
			o.ExpiryWindow = credExpiryWindow
		}
	})

	return retrieveCredSet(ctx, input, cached, region, renewable)
}

// retrieveCredSet fetches the credentials once to surface their errors, then wraps provider into a credSet.
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

// loadAwsConfig loads the AWS CLI config. With useProfile it reads cfg.ProfileName ("default" when empty) from
// the files in cfg (or the standard ~/.aws files, AWS_CONFIG_FILE and AWS_SHARED_CREDENTIALS_FILE).
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

// anonymousCredentials sends unsigned requests. The buckets the user entered are required because an anonymous
// client can neither list buckets nor probe the endpoint without one.
func anonymousCredentials(input models.ConnectionProfileInput) (credSet, error) {
	if len(input.AuthConfig.BucketNames()) == 0 {
		err := errors.New("anonymous access needs at least one bucket")
		return credSet{}, &credError{module: cnst.Profile, code: profile.PFE009, err: err}
	}
	return credSet{AWS: aws.AnonymousCredentials{}, Refreshable: true, Anonymous: true}, nil
}

// minioSTSCredentials asks the MinIO STS endpoint (the S3 endpoint) for temporary credentials: AssumeRole with
// the access key and secret key, or LDAP with the LDAP user and password. MinIO renews them on its own.
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

	provider := aws.NewCredentialsCache(
		&minioProvider{creds: minio, client: httpClient, endpoint: endpoint},
		func(o *aws.CredentialsCacheOptions) { o.ExpiryWindow = credExpiryWindow },
	)
	set, err := retrieveCredSet(ctx, input, provider, "", true)
	set.Minio = minio
	return set, err
}

// minioProvider adapts MinIO credentials to the AWS SDK, so the S3 client and madmin share one STS session.
type minioProvider struct {
	creds    *miniocredentials.Credentials
	client   *http.Client
	endpoint string
}

// Retrieve returns the cached MinIO credentials, or asks STS again when they are about to expire.
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

// oneTimeToken returns an MFA token provider that hands out code once: the code is single use, so a
// later renewal must fail instead of sending the same code again.
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

// defaultSessionName is s3browser-<os user>, cleaned to the characters STS accepts.
func defaultSessionName() string {
	name := "s3browser"
	if u, err := user.Current(); err == nil {
		name += "-" + invalidSessionNameChars.ReplaceAllString(u.Username, "-")
	}
	return name
}

// mapCredError wraps err in a credError when it matches a known credentials failure, else returns it as is.
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
		// MinIO answered but refused the STS request.
		if input.AuthType == cnst.AuthMinioLdap {
			return &credError{code: S3E038, err: err}
		}
		return &credError{code: S3E037, err: err}
	case isAPI && apiErr.ErrorCode() == "AccessDenied":
		return assumeRoleDenied(input, err)
	}
	return err
}

// isSsoSessionCode reports whether code means the SSO login session is gone or no longer valid.
func isSsoSessionCode(code string) bool {
	switch code {
	case "UnauthorizedException", "InvalidGrantException", "ExpiredTokenException":
		return true
	}
	return false
}

// assumeRoleDenied tells a wrong MFA code (S3E032) apart from a role that can't be assumed (S3E031). A CLI profile
// that chains a role_arn has no ARN in the input, so its name is shown instead.
func assumeRoleDenied(input models.ConnectionProfileInput, err error) error {
	cfg := input.AuthConfig
	if cfg.MfaSerial != "" && strings.Contains(err.Error(), "MultiFactorAuthentication") {
		return &credError{code: S3E032, err: err}
	}
	params := map[string]any{"roleArn": cmp.Or(cfg.RoleArn, cfg.ProfileName)}
	return &credError{code: S3E031, params: params, err: err}
}
