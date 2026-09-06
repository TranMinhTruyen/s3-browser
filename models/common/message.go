package common

type Message struct {
	Order       *string         `json:"order"`
	MessageType *string         `json:"messageType"`
	MessageCode *string         `json:"messageCode"`
	Params      *map[string]any `json:"params"`
}
