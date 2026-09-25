package bucket

type ListObjectInput struct {
	ConnectionId string `json:"connectionId"`
	ProfileName  string `json:"profileName,omitempty"`
	Bucket       string `json:"bucket"`
	Prefix       string `json:"prefix"`
	NextCursor   string `json:"nextCursor,omitempty"`
	Limit        int32  `json:"limit,omitempty"`
}
