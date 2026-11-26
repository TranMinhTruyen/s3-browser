package bucket

// ObjectDetailInput chỉ định object cần lấy thông tin chi tiết.
type ObjectDetailInput struct {
	ConnectionId string `json:"connectionId"`
	ProfileName  string `json:"profileName,omitempty"`
	Bucket       string `json:"bucket"`
	Key          string `json:"key"`
}
