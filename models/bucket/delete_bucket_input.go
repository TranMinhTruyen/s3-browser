package bucket

// DeleteBucketInput identifies the bucket to delete, or whose delete info is requested.
type DeleteBucketInput struct {
	ConnectionId string `json:"connectionId"`
	ProfileName  string `json:"profileName,omitempty"`
	Bucket       string `json:"bucket"`
}
