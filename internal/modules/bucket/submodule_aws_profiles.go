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

// awsProfileEntry is what is read of one profile; hasProcess and isSso are set only by the profile's own keys.
type awsProfileEntry struct {
	region        string
	sourceProfile string
	isSso         bool
	hasProcess    bool
}

// submoduleAwsProfilesMng lists the profiles of the AWS CLI config files. It only parses text: it never runs a
// credential_process or reads a secret.
type submoduleAwsProfilesMng struct {
	logger *slog.Logger
}

// newSubmoduleAwsProfilesMng creates the AWS CLI profile reader.
func newSubmoduleAwsProfilesMng(logger *slog.Logger) *submoduleAwsProfilesMng {
	return &submoduleAwsProfilesMng{
		logger: logger.With("submodules", "aws_profiles"),
	}
}

// list returns the profiles of the config and credentials files sorted by name. An empty path means the standard
// file (AWS_CONFIG_FILE / AWS_SHARED_CREDENTIALS_FILE, else ~/.aws/...). A missing file is not an error.
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

// awsFilePath resolves an AWS CLI file: the path given, else the env variable, else ~/.aws/<name>.
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

// expandHome replaces a leading "~" with the user's home directory.
func expandHome(path string) string {
	if path == "~" || strings.HasPrefix(path, "~/") || strings.HasPrefix(path, `~\`) {
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, path[1:])
		}
	}
	return path
}

// readAwsIni adds the profiles of an AWS INI file to entries. Sections are "[default]" and "[profile x]" in the
// config file, "[x]" in the credentials file; other sections (sso-session, services) are skipped.
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

// profileSectionName extracts the profile name of an INI section header; ok is false for non-profile sections.
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

// setAwsProfileKey records the keys of a profile that the UI needs.
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

// hasCredentialProcess reports whether name or a profile in its source_profile chain runs a credential_process.
// The visited set stops source_profile loops.
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

// utf8BOM may start a file saved by Windows editors.
var utf8BOM = string(rune(0xFEFF))
