package bucket

// DeleteObjOutput lists the keys deleted and the ones that failed.
type DeleteObjOutput struct {
	Deleted []string        `json:"deleted"`
	Failed  []DeleteFailure `json:"failed"`
}
