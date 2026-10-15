package bucket

type DeleteObjInput struct {
	ConnectionId string   `json:"connectionId"`
	ProfileName  string   `json:"profileName,omitempty"`
	Bucket       string   `json:"bucket"`
	Objects      []string `json:"objects"`
}
