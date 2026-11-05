package bucket

// BucketDetailInput identifies the bucket whose details are requested.
type BucketDetailInput struct {
	ConnectionId string `json:"connectionId"`
	ProfileName  string `json:"profileName,omitempty"`
	Bucket       string `json:"bucket"`
}
