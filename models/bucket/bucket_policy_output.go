package bucket

// BucketPolicyOutput is the access state of a bucket.
type BucketPolicyOutput struct {
	// Mode is "private" (no policy), "public" (read-only public policy) or "custom".
	Mode string `json:"mode"`
	// Policy is the policy JSON, empty when private.
	Policy string `json:"policy"`
	// PublicBlocked is true when Block Public Access forbids a public policy (real AWS only).
	PublicBlocked bool `json:"publicBlocked"`
	// EditDenied is true when the account is known not to be allowed to change the policy.
	EditDenied bool `json:"editDenied"`
}
