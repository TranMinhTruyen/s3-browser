package bucket

type UploadObj struct {
	// Path is the local file to upload.
	Path string `json:"path"`
	// RelKey is the key relative to the prefix, with "/" separators (see DroppedFile.RelKey).
	// Empty means the file name. It must not be absolute or contain "." / ".." segments.
	RelKey string `json:"relKey,omitempty"`
	// Key is set by the backend from the prefix and RelKey; any value sent is ignored.
	Key string `json:"key,omitempty"`
}

type UploadObjInput struct {
	ConnectionId string `json:"connectionId"`
	ProfileName  string `json:"profileName,omitempty"`
	Bucket       string `json:"bucket"`
	// Prefix is the folder the files are uploaded into, e.g. "photos/2026/".
	// Empty uploads to the bucket root.
	Prefix  string      `json:"prefix"`
	ObjList []UploadObj `json:"objList"`
}
