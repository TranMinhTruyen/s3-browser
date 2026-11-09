package profile

import (
	"S3Browser/internal/pkg/cnst"
	"S3Browser/internal/pkg/db/sqlc"
	"S3Browser/internal/pkg/utils"
	"S3Browser/models"
	"cmp"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// Range of the OIDC callback port (0 means the default).
const (
	minCallbackPort = 1024
	maxCallbackPort = 65535
)

// errInvalidAuthConfig marks a stored auth_config that cannot be parsed (PFE009).
var errInvalidAuthConfig = errors.New("auth config invalid")

// plainSecrets is every secret of a profile in plain text. It only lives in memory, never in a log or output.
type plainSecrets struct {
	secretKey string
	models.AuthSecret
}

// names lists the secrets that hold a value, as reported to the frontend in SavedSecrets.
func (s plainSecrets) names() []string {
	names := make([]string, 0, 4)
	for _, f := range []struct{ name, value string }{
		{"secretKey", s.secretKey},
		{"sessionToken", s.SessionToken},
		{"ldapPassword", s.LdapPassword},
		{"keyPassword", s.KeyPassword},
	} {
		if f.value != "" {
			names = append(names, f.name)
		}
	}
	return names
}

// fillEmpty copies the secrets of old into the empty ones of s: an empty input means "keep what is stored".
func (s plainSecrets) fillEmpty(old plainSecrets) plainSecrets {
	s.secretKey = cmp.Or(s.secretKey, old.secretKey)
	s.SessionToken = cmp.Or(s.SessionToken, old.SessionToken)
	s.LdapPassword = cmp.Or(s.LdapPassword, old.LdapPassword)
	s.KeyPassword = cmp.Or(s.KeyPassword, old.KeyPassword)
	return s
}

// authColumns are the auth related columns of a profile row, ready to store.
type authColumns struct {
	authType    string
	accessKey   sql.NullString
	config      sql.NullString
	secretKey   sql.NullString
	secret      sql.NullString
	autoConnect bool
}

// submoduleAuthMng validates the authentication settings of a profile and seals/opens its secrets.
type submoduleAuthMng struct {
	km *utils.KeyManager
}

// newSubmoduleAuthMng creates the auth submodule.
func newSubmoduleAuthMng(km *utils.KeyManager) *submoduleAuthMng {
	return &submoduleAuthMng{km: km}
}

// prepare validates input and builds the auth columns to store; a non-nil message means it was rejected.
// stored is the current row on update (nil on create). Secrets are stored only with SavePassword (otherwise
// all stored secrets are cleared), and an empty input secret keeps the stored one when the authType is unchanged.
// allowMissingCertKey (import only) accepts a minioCert profile without certificate or key file.
func (m *submoduleAuthMng) prepare(
	input models.ConnectionProfileInput,
	stored *sqlc.ConnectionProfile,
	allowMissingCertKey bool,
) (authColumns, *models.Message) {
	if input.AuthType == "" {
		input.AuthType = cnst.AuthStatic
	}
	if !cnst.IsAuthTypeValid(input.Provider, input.AuthType) {
		msg := models.NewParamsMessage(cnst.MessageTypeError, cnst.Profile, PFE008, "", map[string]any{
			"authType": input.AuthType,
			"provider": input.Provider,
		})
		return authColumns{}, &msg
	}

	if input.AuthType == cnst.AuthAnonymous {
		// An anonymous client can't list buckets, so the ones to browse must be entered.
		input.AuthConfig.Buckets = input.AuthConfig.BucketNames()
		if len(input.AuthConfig.Buckets) == 0 {
			return authColumns{}, errMessage(PFE009, errors.New("anonymous access needs at least one bucket"))
		}
	}

	if err := validateAuthConfig(input, allowMissingCertKey); err != nil {
		return authColumns{}, errMessage(PFE009, err)
	}
	if input.Provider != cnst.ProviderMinio {
		input.AuthConfig.CaFile = "" // the extra CA only applies to MinIO connections
	}

	config, err := json.Marshal(input.AuthConfig)
	if err != nil {
		return authColumns{}, errMessage(PFE009, err)
	}
	cols := authColumns{
		authType:    input.AuthType,
		accessKey:   sql.NullString{String: input.AccessKey, Valid: input.AccessKey != "" && usesKeys(input)},
		config:      sql.NullString{String: string(config), Valid: true},
		autoConnect: input.AutoConnect && cnst.IsAutoConnectAllowed(input.AuthType, input.AuthConfig.MfaSerial),
	}
	if !input.SavePassword {
		return cols, nil
	}

	secrets := plainSecrets{secretKey: input.SecretKey, AuthSecret: input.AuthSecret}
	if stored != nil && stored.AuthType == input.AuthType {
		old, err := m.open(*stored)
		if err != nil {
			return authColumns{}, errMessage(PFE002, err)
		}
		secrets = secrets.fillEmpty(old)
	}
	secrets = keepNeeded(secrets, input)

	if cols.secretKey, err = m.seal(secrets.secretKey); err != nil {
		return authColumns{}, errMessage(PFE002, err)
	}
	if secrets.AuthSecret != (models.AuthSecret{}) {
		raw, err := json.Marshal(secrets.AuthSecret)
		if err != nil {
			return authColumns{}, errMessage(PFE002, err)
		}
		if cols.secret, err = m.seal(string(raw)); err != nil {
			return authColumns{}, errMessage(PFE002, err)
		}
	}
	return cols, nil
}

// validateAuthConfig checks the fields the OIDC and certificate methods cannot connect without.
// With allowMissingCertKey a minioCert profile may lack the certificate and key file.
func validateAuthConfig(input models.ConnectionProfileInput, allowMissingCertKey bool) error {
	cfg := input.AuthConfig
	switch input.AuthType {
	case cnst.AuthMinioOidc:
		if cfg.ClientId == "" || cfg.IssuerUrl == "" {
			return errors.New("OIDC needs a client id and an issuer URL")
		}
		if !utils.IsSecureUrl(cfg.IssuerUrl) {
			return errors.New("OIDC issuer URL must be https (http only for localhost)")
		}
		if cfg.CallbackPort != 0 && (cfg.CallbackPort < minCallbackPort || cfg.CallbackPort > maxCallbackPort) {
			return fmt.Errorf("OIDC callback port must be between %d and %d", minCallbackPort, maxCallbackPort)
		}
	case cnst.AuthMinioCert:
		if !allowMissingCertKey && (cfg.CertFile == "" || cfg.KeyFile == "") {
			return errors.New("certificate authentication needs a certificate file and a key file")
		}
		if strings.HasPrefix(strings.ToLower(strings.TrimSpace(input.Endpoint)), "http://") {
			return errors.New("certificate authentication needs an https endpoint")
		}
	}
	return nil
}

// seal encrypts v; an empty v is stored as NULL.
func (m *submoduleAuthMng) seal(v string) (sql.NullString, error) {
	if v == "" {
		return sql.NullString{}, nil
	}
	cipher, err := m.km.Encrypt(v)
	return sql.NullString{String: cipher, Valid: err == nil}, err
}

// open decrypts the secrets stored in p.
func (m *submoduleAuthMng) open(p sqlc.ConnectionProfile) (plainSecrets, error) {
	var secrets plainSecrets
	var err error

	if p.SecretKey.String != "" {
		if secrets.secretKey, err = m.km.Decrypt(p.SecretKey.String); err != nil {
			return plainSecrets{}, err
		}
	}
	if p.AuthSecret.String != "" {
		raw, err := m.km.Decrypt(p.AuthSecret.String)
		if err != nil {
			return plainSecrets{}, err
		}
		if err := json.Unmarshal([]byte(raw), &secrets.AuthSecret); err != nil {
			return plainSecrets{}, utils.ErrInvalidCiphertext
		}
	}
	return secrets, nil
}

// parseAuthConfig reads the auth_config JSON of p; an empty column gives an empty config.
func parseAuthConfig(p sqlc.ConnectionProfile) (models.AuthConfig, error) {
	var cfg models.AuthConfig
	if p.AuthConfig.String == "" {
		return cfg, nil
	}
	if err := json.Unmarshal([]byte(p.AuthConfig.String), &cfg); err != nil {
		return models.AuthConfig{}, fmt.Errorf("%w: %w", errInvalidAuthConfig, err)
	}
	return cfg, nil
}

// errMessage builds the error message of code with err as its detail.
func errMessage(code string, err error) *models.Message {
	msg := models.NewMessage(cnst.MessageTypeError, cnst.Profile, code, err.Error())
	return &msg
}

// usesKeys reports whether the method signs with an access key and secret key: static, MinIO AssumeRole, and
// AWS AssumeRole whose source is not a CLI profile.
func usesKeys(input models.ConnectionProfileInput) bool {
	switch input.AuthType {
	case "", cnst.AuthStatic, cnst.AuthMinioAssumeRole:
		return true
	case cnst.AuthAssumeRole:
		return input.AuthConfig.SourceType != "profile"
	}
	return false
}

// keepNeeded zeroes the secrets the method doesn't use, so switching method never keeps a stale secret.
func keepNeeded(s plainSecrets, input models.ConnectionProfileInput) plainSecrets {
	keys := usesKeys(input)
	if !keys {
		s.secretKey = ""
		s.SessionToken = ""
	}
	if input.AuthType == cnst.AuthMinioAssumeRole {
		s.SessionToken = "" // the session token only goes with static keys and AssumeRole source keys
	}
	if input.AuthType != cnst.AuthMinioLdap {
		s.LdapPassword = ""
	}
	if input.AuthType != cnst.AuthMinioCert || !input.AuthConfig.KeyEncrypted {
		s.KeyPassword = ""
	}
	return s
}
