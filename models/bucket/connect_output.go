// Package bucket holds the input/output models of the bucket module (buckets, objects, upload, download).
package bucket

// ConnectOutput is the result of opening a connection to a profile.
// Limited is true when the connection works but access was denied for listing (warning S3W001).
type ConnectOutput struct {
	IsConnected  bool   `json:"isConnected,omitempty"`
	ConnectionId string `json:"connectionId"`
	Limited      bool   `json:"limited,omitempty"`
}
