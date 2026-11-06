package bucket

// SearchBucketInput searches bucket names by Keyword, continuing from NextCursor.
type SearchBucketInput struct {
	ConnectionId string `json:"connectionId"`
	ProfileName  string `json:"profileName,omitempty"`
	Keyword      string `json:"keyword"`
	NextCursor   string `json:"nextCursor,omitempty"`
	// CheckWrite asks to flag read-only buckets. Only the upload bucket picker sets it, the check costs extra
	// requests.
	CheckWrite bool `json:"checkWrite,omitempty"`
	// LazyAccess is set by the bucket list screen: a bucket that needs its own probe (HeadBucket / write probe) with
	// no cached result is not probed but returned with AccessPending, so the frontend checks it once it is shown.
	LazyAccess bool `json:"lazyAccess,omitempty"`
}
