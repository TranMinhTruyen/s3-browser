package bucket

// DownloadObjInput yêu cầu tải xuống các key object đã cho trong bucket.
type DownloadObjInput struct {
	ConnectionId string   `json:"connectionId"`
	ProfileName  string   `json:"profileName,omitempty"`
	Bucket       string   `json:"bucket"`
	Objects      []string `json:"objects"`
}
