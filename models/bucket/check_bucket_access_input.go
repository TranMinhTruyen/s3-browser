package bucket

// CheckBucketAccessInput asks for the access flags of the given buckets of a connection.
type CheckBucketAccessInput struct {
	ConnectionId string   `json:"connectionId"`
	ProfileName  string   `json:"profileName,omitempty"`
	BucketNames  []string `json:"bucketNames"`
	// CheckWrite also flags read-only buckets.
	CheckWrite bool `json:"checkWrite,omitempty"`
}
