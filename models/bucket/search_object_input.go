package bucket

// SearchObjectInput searches object keys under Prefix by Keyword, continuing from NextCursor.
type SearchObjectInput struct {
	ConnectionId string `json:"connectionId"`
	ProfileName  string `json:"profileName,omitempty"`
	Bucket       string `json:"bucket"`
	Prefix       string `json:"prefix"`
	Keyword      string `json:"keyword"`
	NextCursor   string `json:"nextCursor,omitempty"`
}
