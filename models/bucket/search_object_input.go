package bucket

// SearchObjectInput tìm key object dưới Prefix theo Keyword và tiếp tục từ NextCursor.
type SearchObjectInput struct {
	ConnectionId string `json:"connectionId"`
	ProfileName  string `json:"profileName,omitempty"`
	Bucket       string `json:"bucket"`
	Prefix       string `json:"prefix"`
	Keyword      string `json:"keyword"`
	NextCursor   string `json:"nextCursor,omitempty"`
}
