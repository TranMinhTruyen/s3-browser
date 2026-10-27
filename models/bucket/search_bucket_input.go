package bucket

type SearchBucketInput struct {
	ConnectionId string `json:"connectionId"`
	ProfileName  string `json:"profileName,omitempty"`
	Keyword      string `json:"keyword"`
	NextCursor   string `json:"nextCursor,omitempty"`
}
