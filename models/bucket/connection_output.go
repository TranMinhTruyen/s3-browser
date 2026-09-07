package bucket

type ConnectionOutput struct {
	IsConnected  bool   `json:"isConnected"`
	ConnectionId string `json:"connectionId,omitempty"`
	Limited      bool   `json:"limited"`
}
