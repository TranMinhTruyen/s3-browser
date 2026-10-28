package bucket

// DownloadObjInput asks to download the given object keys of a bucket.
type DownloadObjInput struct {
	ConnectionId string   `json:"connectionId"`
	ProfileName  string   `json:"profileName,omitempty"`
	Bucket       string   `json:"bucket"`
	Objects      []string `json:"objects"`
}
