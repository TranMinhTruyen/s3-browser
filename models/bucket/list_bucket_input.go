package bucket

// ListBucketInput is a page request for the buckets of a connection.
type ListBucketInput struct {
	ConnectionId string `json:"connectionId"`
	ProfileName  string `json:"profileName,omitempty"`
	NextCursor   string `json:"nextCursor,omitempty"`
	Limit        int32  `json:"limit,omitempty"`
	// CheckWrite asks to flag read-only buckets. Only the upload bucket picker sets it, the check costs extra
	// requests.
	CheckWrite bool `json:"checkWrite,omitempty"`
	// LazyAccess is set by the bucket list screen: a bucket that needs its own probe (HeadBucket / write probe) with
	// no cached result is not probed but returned with AccessPending, so the frontend checks it once it is shown.
	LazyAccess bool `json:"lazyAccess,omitempty"`
}
