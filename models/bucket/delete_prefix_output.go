package bucket

// DeletePrefixOutput counts the objects deleted and the ones that failed.
type DeletePrefixOutput struct {
	Deleted int `json:"deleted"`
	Failed  int `json:"failed"`
}
