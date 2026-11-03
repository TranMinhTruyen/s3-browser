package bucket

// DeleteFailure is one object that could not be deleted and why.
type DeleteFailure struct {
	Key   string `json:"key"`
	Error string `json:"error"`
}
