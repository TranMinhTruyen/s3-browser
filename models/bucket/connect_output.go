package bucket

type ConnectOutput struct {
	IsConnected  bool   `json:"isConnected,omitempty"`
	ConnectionId string `json:"connectionId"`
	Limited      bool   `json:"limited,omitempty"`
}
