package bucket

// CreateBucketInput asks to create a bucket on a connection.
type CreateBucketInput struct {
	ConnectionId string `json:"connectionId"`
	ProfileName  string `json:"profileName,omitempty"`
	Bucket       string `json:"bucket"`
	// Region is only used by real AWS; empty means the region of the connection.
	Region string `json:"region,omitempty"`
}
