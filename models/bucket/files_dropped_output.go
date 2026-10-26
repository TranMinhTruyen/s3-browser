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
	// IsLarge is true when Size is over LargeFileSize.
	IsLarge bool `json:"isLarge"`
}

// DroppedGroup is the files that sit directly in one folder of the drop. A folder with no
// file of its own (empty, or holding only sub folders) is not a group.
type DroppedGroup struct {
	// Name is the folder of the files relative to the prefix, e.g. "photos/2026"; empty for
	// files dropped directly (not inside a dropped folder).
	Name string `json:"name"`
	// Files are all the files found directly in the folder, in walk order. It can hold more
	// than MaxFilesPerFolder files so the user can pick which ones to upload.
	Files []DroppedFile `json:"files"`
	// TotalFiles is len(Files).
	TotalFiles int `json:"totalFiles"`
	// LargeCount is the number of large files in Files.
	LargeCount int `json:"largeCount"`
	// OverMaxFiles is true when TotalFiles is over MaxFilesPerFolder.
	OverMaxFiles bool `json:"overMaxFiles"`
	// OverLargeCount is true when LargeCount is over LargeFileMaxCount.
	OverLargeCount bool `json:"overLargeCount"`
}

// FilesDroppedOutput is sent to the frontend when files are dropped on a tab's object list.
type FilesDroppedOutput struct {
	// TabId is the tab the files were dropped on (the drop target's data-tab-id).
	TabId string `json:"tabId"`
	// Groups are the folders that hold files, in drop order.
	Groups []DroppedGroup `json:"groups"`
	// Skipped is the number of dropped items that are not uploadable (unreadable, symlink, special files).
	Skipped int `json:"skipped"`
	// TotalFiles is the number of files in Groups (at most MaxTotalFiles).
	TotalFiles int `json:"totalFiles"`
	// OverMaxTotal is true when the drop holds more than MaxTotalFiles files: the extra files
	// are left out of Groups.
	OverMaxTotal bool `json:"overMaxTotal"`
	// Capped is true when a folder had too many entries to be walked to the end, so Groups
	// may be incomplete.
	Capped bool `json:"capped"`
	// MaxFilesPerFolder is the most files uploaded from one folder.
	MaxFilesPerFolder int `json:"maxFilesPerFolder"`
	// LargeFileSize is the size in bytes above which a file counts as large.
	LargeFileSize int64 `json:"largeFileSize"`
	// LargeFileMaxCount is the most large files uploaded from one folder.
	LargeFileMaxCount int `json:"largeFileMaxCount"`
	// MaxTotalFiles is the most files uploaded in one call.
	MaxTotalFiles int `json:"maxTotalFiles"`
}
