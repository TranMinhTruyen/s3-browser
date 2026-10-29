package setting

import (
	"S3Browser/internal/pkg/portable"
	"encoding/json"
	"os"
	"path/filepath"
)

// dataFilePath returns the path of a file in the app data dir, creating the dir when missing.
func dataFilePath(appName, fileName string) (string, error) {
	dir, err := portable.DataDir(appName)
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, fileName), nil
}

// writeJSONAtomic saves v as JSON: a temp file in the same dir is flushed to disk, then renamed over the target,
// so a crash or power loss never leaves half a file.
// It takes no lock: callers serialize writes (submoduleSettingMng.mu for settings, submoduleTabMng.mu for tabs).
func writeJSONAtomic(path string, v any) error {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}

	tmp, err := os.CreateTemp(filepath.Dir(path), filepath.Base(path)+".*.tmp")
	if err != nil {
		return err
	}
	_, err = tmp.Write(data)
	if err == nil {
		// Without Sync the rename can reach the disk before the data, leaving an empty file after a crash.
		err = tmp.Sync()
	}
	if closeErr := tmp.Close(); err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(tmp.Name(), path)
	}
	if err != nil {
		_ = os.Remove(tmp.Name())
	}
	return err
}
