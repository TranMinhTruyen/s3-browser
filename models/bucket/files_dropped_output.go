package bucket

// DroppedFile is one file found in a drop. A dropped folder is expanded into its files.
type DroppedFile struct {
	// Path is the absolute local path of the file.
	Path string `json:"path"`
	// RelKey is the key of the file relative to the upload prefix, with "/" separators.
	// A dropped file has just its name; a file in a dropped folder starts with the
	// folder's name, e.g. "photos/2026/a.jpg".
	RelKey string `json:"relKey"`
	// Size is the file size in bytes.
	Size int64 `json:"size"`
}

// FilesDroppedOutput is sent to the frontend when files are dropped on a tab's object list.
type FilesDroppedOutput struct {
	// TabId is the tab the files were dropped on (the drop target's data-tab-id).
	TabId string `json:"tabId"`
	// Files are the files to upload, in drop order, at most MaxFiles.
	Files []DroppedFile `json:"files"`
	// Truncated is true when the drop holds more than MaxFiles files; Files keeps the first MaxFiles.
	Truncated bool `json:"truncated"`
	// Skipped is the number of dropped items that are not uploadable (unreadable, symlink, special files).
	Skipped int `json:"skipped"`
	// MaxFiles is the most files one upload accepts.
	MaxFiles int `json:"maxFiles"`
	// LargeFileSize is the size in bytes above which a file counts as large. When Files holds a
	// larger file, only the largest file may be uploaded.
	LargeFileSize int64 `json:"largeFileSize"`
}
