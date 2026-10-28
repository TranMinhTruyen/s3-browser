package bucket

// ObjectDetailInput identifies the object whose details are requested.
type ObjectDetailInput struct {
	ConnectionId string `json:"connectionId"`
	ProfileName  string `json:"profileName,omitempty"`
	Bucket       string `json:"bucket"`
	Key          string `json:"key"`
}
