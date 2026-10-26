package bucket

type DeletePrefixInput struct {
	ConnectionId string `json:"connectionId"`
	ProfileName  string `json:"profileName,omitempty"`
	Bucket       string `json:"bucket"`
	Prefix       string `json:"prefix"`
}
