package bucket

// DeleteBucketInfoOutput is what the delete bucket dialog needs to know.
type DeleteBucketInfoOutput struct {
	// Empty is nil when it could not be read.
	Empty *bool `json:"empty"`
	// Versioning is "Enabled", "Suspended" or "Off"; empty when it could not be read.
	Versioning string `json:"versioning"`
	// ObjectLock is true when Object Lock is enabled; false also when it could not be read.
	ObjectLock bool `json:"objectLock"`
}
