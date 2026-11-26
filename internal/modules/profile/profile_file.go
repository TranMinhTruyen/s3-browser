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

// errInvalidProfileFile đánh dấu file không phải file hồ sơ (PFE012).
var errInvalidProfileFile = errors.New("not a profile file")

// unsupportedVersionError đánh dấu file hồ sơ dùng phiên bản định dạng khác (PFE013).
type unsupportedVersionError struct{ version int }

func (e unsupportedVersionError) Error() string {
	return fmt.Sprintf("profile file version %d is not supported", e.version)
}

// secretAAD trả về dữ liệu xác thực bổ sung của secret đã mã hóa: tên định dạng và provider, endpoint, authType
// của hồ sơ dưới dạng JSON để các trường không bị nối lẫn nhau. Nếu sửa một trường trong file thì không thể giải mã
// secret (PFE014); các trường khác (name, color...) vẫn có thể thay đổi.
func secretAAD(p *fileProfile) []byte {
	aad, _ := json.Marshal([]string{profileFileFormat, p.Provider, p.Endpoint, p.AuthType})
	return aad
}

// profileFile chứa nội dung file hồ sơ đã xuất (phiên bản 1). Không có id, dấu thời gian hay phiên bản DB.
// Version là phiên bản định dạng, không phải phiên bản khóa lạc quan.
type profileFile struct {
	Format  string                `json:"format"`
	Version int                   `json:"version"`
	Profile *fileProfile          `json:"profile"`
	Secret  *utils.PasswordSealed `json:"secret,omitempty"`
}

// fileProfile là phần hồ sơ trong file hồ sơ.
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

// fileSecret là secret dạng văn bản thuần được mã hóa vào profileFile.Secret.
type fileSecret struct {
	SecretKey string `json:"secretKey,omitempty"`
	models.AuthSecret
}

// parseProfileFile đọc và kiểm tra định dạng, phiên bản của file hồ sơ. Lỗi không bao giờ chứa nội dung file.
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
