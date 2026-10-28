package bucket

// DeletePrefixInput asks to delete every object under Prefix, recursively.
type DeletePrefixInput struct {
	ConnectionId string `json:"connectionId"`
	ProfileName  string `json:"profileName,omitempty"`
	Bucket       string `json:"bucket"`
	Prefix       string `json:"prefix"`
}
