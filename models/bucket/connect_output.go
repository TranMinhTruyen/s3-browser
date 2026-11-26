// Package bucket chứa các model đầu vào/đầu ra của module bucket (bucket, object, tải lên, tải xuống).
package bucket

// ConnectOutput là kết quả mở kết nối đến hồ sơ.
// Limited là true nếu kết nối hoạt động nhưng bị từ chối quyền liệt kê (cảnh báo S3W001).
type ConnectOutput struct {
	IsConnected  bool   `json:"isConnected,omitempty"`
	ConnectionId string `json:"connectionId"`
	Limited      bool   `json:"limited,omitempty"`
}
