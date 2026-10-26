package bucket

type DeletePrefixOutput struct {
	Deleted int `json:"deleted"`
	Failed  int `json:"failed"`
}
