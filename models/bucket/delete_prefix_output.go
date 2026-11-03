package bucket

// DeletePrefixOutput counts the objects deleted and the ones that failed.
// Failed is the total; Failures keeps the details of the first ones only.
type DeletePrefixOutput struct {
	Deleted  int             `json:"deleted"`
	Failed   int             `json:"failed"`
	Failures []DeleteFailure `json:"failures"`
}
