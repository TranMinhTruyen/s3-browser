package bucket

type ConnectionOutput struct {
	IsConnected  bool   `json:"isConnected,omitempty"`
	ConnectionId string `json:"connectionId"`
	Limited      bool   `json:"limited,omitempty"`
}
