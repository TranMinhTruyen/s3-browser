package bucket

// ObjectDetailOutput is the head information of one object.
type ObjectDetailOutput struct {
	Key         string `json:"key"`
	ContentType string `json:"contentType"`
	// StorageClass is empty when the provider doesn't return it (S3 omits it for STANDARD).
	StorageClass string `json:"storageClass"`
	// Metadata is the user metadata (x-amz-meta-*), keys are lower case. Never nil.
	Metadata map[string]string `json:"metadata"`
}
