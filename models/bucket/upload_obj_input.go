package bucket

type UploadObj struct {
	// Path is the local file to upload.
	Path string `json:"path"`
	// Key is set by the backend from the prefix and the file name; any value sent is ignored.
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
