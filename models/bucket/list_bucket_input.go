package bucket

// ListBucketInput is a page request for the buckets of a connection.
type ListBucketInput struct {
	ConnectionId string `json:"connectionId"`
	ProfileName  string `json:"profileName,omitempty"`
	NextCursor   string `json:"nextCursor,omitempty"`
	Limit        int32  `json:"limit,omitempty"`
}
