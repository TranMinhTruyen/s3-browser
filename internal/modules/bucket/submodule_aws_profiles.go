package bucket

import (
	"S3Browser/internal/pkg/cnst"
	"S3Browser/models"
	"bufio"
	"cmp"
	"errors"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"slices"
	"strings"
)

// awsProfileEntry chứa dữ liệu đọc được của một hồ sơ; chỉ đặt hasProcess và isSso theo key của chính hồ sơ đó.
type awsProfileEntry struct {
	region        string
	sourceProfile string
	isSso         bool
	hasProcess    bool
}

// submoduleAwsProfilesMng liệt kê hồ sơ trong các file cấu hình AWS CLI. Hàm chỉ phân tích văn bản:
// không chạy credential_process hoặc đọc thông tin bí mật.
type submoduleAwsProfilesMng struct {
	logger *slog.Logger
}

// newSubmoduleAwsProfilesMng tạo bộ đọc hồ sơ AWS CLI.
func newSubmoduleAwsProfilesMng(logger *slog.Logger) *submoduleAwsProfilesMng {
	return &submoduleAwsProfilesMng{
		logger: logger.With("submodules", "aws_profiles"),
	}
}

// list trả về hồ sơ trong file cấu hình và file thông tin xác thực, sắp xếp theo tên. Đường dẫn rỗng nghĩa là dùng file
// mặc định (AWS_CONFIG_FILE / AWS_SHARED_CREDENTIALS_FILE, nếu không có thì dùng ~/.aws/...). File không tồn tại không phải lỗi.
func (m *submoduleAwsProfilesMng) list(configFile, credentialsFile string) models.Output[[]models.AwsProfileOutput] {
	output := models.NewOutput[[]models.AwsProfileOutput]()

	files := []struct {
		path     string
		isConfig bool
	}{
		{awsFilePath(configFile, "AWS_CONFIG_FILE", "config"), true},
		{awsFilePath(credentialsFile, "AWS_SHARED_CREDENTIALS_FILE", "credentials"), false},
	}

	entries := map[string]*awsProfileEntry{}
	for _, f := range files {
		if err := readAwsIni(f.path, f.isConfig, entries); err != nil {
			m.logger.Error("read aws config file failed", "path", f.path, "error", err)
			return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Bucket, S3E045, err.Error()))
		}
	}

	output.Body = make([]models.AwsProfileOutput, 0, len(entries))
	for name, e := range entries {
		output.Body = append(output.Body, models.AwsProfileOutput{
			Name:                 name,
			Region:               e.region,
			IsSso:                e.isSso,
			HasCredentialProcess: hasCredentialProcess(name, entries),
		})
	}
	slices.SortFunc(output.Body, func(a, b models.AwsProfileOutput) int { return cmp.Compare(a.Name, b.Name) })

	return output
}

// awsFilePath xác định file AWS CLI cần dùng: ưu tiên đường dẫn đã cho, tiếp theo là biến môi trường,
// cuối cùng là ~/.aws/<name>.
func awsFilePath(path, envName, name string) string {
	if path = cmp.Or(path, os.Getenv(envName)); path != "" {
		return expandHome(path)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".aws", name)
}

// expandHome thay dấu "~" ở đầu bằng thư mục home của người dùng.
func expandHome(path string) string {
	if path == "~" || strings.HasPrefix(path, "~/") || strings.HasPrefix(path, `~\`) {
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, path[1:])
		}
	}
	return path
}

// readAwsIni thêm hồ sơ trong file AWS INI vào entries. Section trong file cấu hình là "[default]" và "[profile x]",
// trong file thông tin xác thực là "[x]"; bỏ qua các section khác (sso-session, services).
func readAwsIni(path string, isConfig bool, entries map[string]*awsProfileEntry) error {
	if path == "" {
		return nil
	}
	file, err := os.Open(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer func() { _ = file.Close() }() // read-only file: close error is harmless

	var current *awsProfileEntry
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(strings.TrimPrefix(scanner.Text(), utf8BOM))
		switch {
		case line == "" || line[0] == '#' || line[0] == ';':
			continue
		case line[0] == '[' && strings.HasSuffix(line, "]"):
			name, ok := profileSectionName(strings.TrimSpace(line[1:len(line)-1]), isConfig)
			current = nil
			if ok {
				if entries[name] == nil {
					entries[name] = &awsProfileEntry{}
				}
				current = entries[name]
			}
		case current != nil:
			key, value, _ := strings.Cut(line, "=")
			setAwsProfileKey(current, strings.TrimSpace(key), strings.TrimSpace(value))
		}
	}
	return scanner.Err()
}

// profileSectionName lấy tên hồ sơ từ header section INI; ok là false với section không phải hồ sơ.
func profileSectionName(section string, isConfig bool) (name string, ok bool) {
	if !isConfig {
		return section, section != ""
	}
	if section == "default" {
		return section, true
	}
	fields := strings.Fields(section)
	if len(fields) == 2 && fields[0] == "profile" {
		return fields[1], true
	}
	return "", false
}

// setAwsProfileKey ghi nhận các key của hồ sơ mà UI cần dùng.
func setAwsProfileKey(e *awsProfileEntry, key, value string) {
	switch key {
	case "region":
		e.region = value
	case "source_profile":
		e.sourceProfile = value
	case "sso_session", "sso_start_url":
		e.isSso = true
	case "credential_process":
		e.hasProcess = value != ""
	}
}

// hasCredentialProcess cho biết name hoặc một hồ sơ trong chuỗi source_profile có chạy credential_process hay không.
// Tập visited dùng để ngăn vòng lặp source_profile.
func hasCredentialProcess(name string, entries map[string]*awsProfileEntry) bool {
	visited := map[string]bool{}
	for e := entries[name]; e != nil && !visited[name]; e = entries[name] {
		if e.hasProcess {
			return true
		}
		visited[name] = true
		name = e.sourceProfile
	}
	return false
}

// File được lưu bằng trình soạn thảo Windows có thể bắt đầu bằng utf8BOM.
var utf8BOM = string(rune(0xFEFF))
