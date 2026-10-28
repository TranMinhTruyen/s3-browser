package bucket

// DeleteObjInput asks to delete the given object keys of a bucket.
type DeleteObjInput struct {
	ConnectionId string   `json:"connectionId"`
	ProfileName  string   `json:"profileName,omitempty"`
	Bucket       string   `json:"bucket"`
	Objects      []string `json:"objects"`
}
