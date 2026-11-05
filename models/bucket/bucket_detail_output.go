package bucket

// BucketDetailOutput is the read-only detail of a bucket. A nil pointer means the item could not be read
// (denied, not supported, timeout), the frontend shows "-".
type BucketDetailOutput struct {
	Region      *string `json:"region"`
	Arn         string  `json:"arn"`
	EndpointUrl string  `json:"endpointUrl"`
	// PolicyMode is "private", "public" or "custom".
	PolicyMode    *string `json:"policyMode"`
	PublicBlocked *bool   `json:"publicBlocked"`
	// Versioning is "Enabled", "Suspended" or "Off".
	Versioning *string `json:"versioning"`
	// Encryption is the default algorithm (with the KMS key id if any), or "None".
	Encryption *string `json:"encryption"`
	// ObjectLock is "Enabled" (with the default retention if any) or "Disabled".
	ObjectLock *string `json:"objectLock"`
	// Tags is empty when the bucket has no tag.
	Tags *map[string]string `json:"tags"`
	// RootCount is the number of objects and folders at the root, at most 10,000.
	RootCount *int `json:"rootCount"`
	// RootCountCapped is true when the root has more than RootCount items.
	RootCountCapped bool `json:"rootCountCapped"`
}
