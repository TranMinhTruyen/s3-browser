package bucket

import (
	"S3Browser/internal/pkg/cnst"
	"S3Browser/models"
	"cmp"
	"context"
	"errors"
	"fmt"
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
}

// credError is a credentials failure with its own message code (S3E030 - S3E036), see describeConnectStatus.
type credError struct {
	code   string
	params map[string]any
	err    error
}

func (e *credError) Error() string { return e.err.Error() }
func (e *credError) Unwrap() error { return e.err }

// buildCredentials resolves the credentials of input.AuthType and retrieves them once, so a wrong profile,
// an expired SSO session or a rejected role fails here with a specific message instead of at the first request.
func buildCredentials(ctx context.Context, input models.ConnectionProfileInput) (credSet, error) {
	switch input.AuthType {
	case "", cnst.AuthStatic:
		return staticCredentials(input), nil
	case cnst.AuthSharedProfile, cnst.AuthSSO:
		return profileCredentials(ctx, input)
	case cnst.AuthAssumeRole:
		return assumeRoleCredentials(ctx, input)
	case cnst.AuthDefaultChain:
		return defaultChainCredentials(ctx, input)
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
	}
}

// profileCredentials uses an AWS CLI profile (static keys, role_arn, credential_process, SSO).
func profileCredentials(ctx context.Context, input models.ConnectionProfileInput) (credSet, error) {
	awsCfg, err := loadAwsConfig(ctx, input.AuthConfig, true)
	if err != nil {
		return credSet{}, mapCredError(input, err)
	}
	return retrieveCredSet(ctx, input, awsCfg.Credentials, awsCfg.Region)
}

// defaultChainCredentials uses the AWS SDK default chain: environment, shared files, container/EC2 role.
func defaultChainCredentials(ctx context.Context, input models.ConnectionProfileInput) (credSet, error) {
	awsCfg, err := loadAwsConfig(ctx, models.AuthConfig{}, false)
	if err != nil {
		return credSet{}, mapCredError(input, err)
	}
	return retrieveCredSet(ctx, input, awsCfg.Credentials, awsCfg.Region)
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
	cached := aws.NewCredentialsCache(provider, func(o *aws.CredentialsCacheOptions) {
		o.ExpiryWindow = credExpiryWindow
	})

	return retrieveCredSet(ctx, input, cached, region)
}

// retrieveCredSet fetches the credentials once to surface their errors, then wraps provider into a credSet.
func retrieveCredSet(
	ctx context.Context,
	input models.ConnectionProfileInput,
	provider aws.CredentialsProvider,
	region string,
) (credSet, error) {
	if _, err := provider.Retrieve(ctx); err != nil {
		return credSet{}, mapCredError(input, err)
	}
	return credSet{AWS: provider, Region: region}, nil
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

// oneTimeToken returns an MFA token provider that hands out code once: the code is single use, so a
// later renewal must fail instead of sending the same code again.
func oneTimeToken(code string) func() (string, error) {
	var used atomic.Bool
	return func() (string, error) {
		if code == "" || used.Swap(true) {
			return "", errors.New("MFA code is required")
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
