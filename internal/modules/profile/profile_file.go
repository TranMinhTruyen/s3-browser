package profile

import (
	"S3Browser/internal/pkg/utils"
	"S3Browser/models"
	"encoding/json"
	"errors"
	"fmt"
)

const (
	profileFileFormat  = "s3browser-profile"
	profileFileVersion = 1
)

// errInvalidProfileFile marks a file that is not a profile file (PFE012).
var errInvalidProfileFile = errors.New("not a profile file")

// unsupportedVersionError marks a profile file of another format version (PFE013).
type unsupportedVersionError struct{ version int }

func (e unsupportedVersionError) Error() string {
	return fmt.Sprintf("profile file version %d is not supported", e.version)
}

// secretAAD returns the additional authenticated data of the sealed secrets: the format name and the provider,
// endpoint and authType of the profile, as JSON so the fields cannot run into each other. Editing one of them in
// the file makes the secrets impossible to open (PFE014); other fields (name, color...) can still change.
func secretAAD(p *fileProfile) []byte {
	aad, _ := json.Marshal([]string{profileFileFormat, p.Provider, p.Endpoint, p.AuthType})
	return aad
}

// profileFile is the content of an exported profile file (version 1). It has no id, timestamps or DB version.
// Version is the format version, not the optimistic-lock one.
type profileFile struct {
	Format  string                `json:"format"`
	Version int                   `json:"version"`
	Profile *fileProfile          `json:"profile"`
	Secret  *utils.PasswordSealed `json:"secret,omitempty"`
}

// fileProfile is the profile part of a profile file.
type fileProfile struct {
	Name        string            `json:"name"`
	Color       string            `json:"color,omitempty"`
	Provider    string            `json:"provider"`
	Endpoint    string            `json:"endpoint"`
	Region      string            `json:"region,omitempty"`
	AccessKey   string            `json:"accessKey,omitempty"`
	PathStyle   bool              `json:"pathStyle"`
	AutoConnect bool              `json:"autoConnect"`
	AuthType    string            `json:"authType"`
	AuthConfig  models.AuthConfig `json:"authConfig"`
}

// fileSecret is the plaintext sealed into profileFile.Secret.
type fileSecret struct {
	SecretKey string `json:"secretKey,omitempty"`
	models.AuthSecret
}

// parseProfileFile reads and checks the format and version of a profile file. The error never carries file content.
func parseProfileFile(data []byte) (profileFile, error) {
	var f profileFile
	if err := json.Unmarshal(data, &f); err != nil || f.Format != profileFileFormat {
		return profileFile{}, errInvalidProfileFile
	}
	if f.Version != profileFileVersion {
		return profileFile{}, unsupportedVersionError{version: f.Version}
	}
	if f.Profile == nil {
		return profileFile{}, errInvalidProfileFile
	}
	return f, nil
}
