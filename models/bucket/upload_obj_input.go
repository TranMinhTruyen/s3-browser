package bucket

// UploadObj là một file trên máy cần tải lên.
type UploadObj struct {
	// Path là đường dẫn file trên máy cần tải lên.
	Path string `json:"path"`
	// RelKey là key tính tương đối với prefix, dùng dấu phân cách "/" (xem DroppedFile.RelKey).
	// Nếu rỗng thì dùng tên file. Không được là đường dẫn tuyệt đối hoặc chứa đoạn "." / "..".
	RelKey string `json:"relKey,omitempty"`
	// Backend đặt Key từ prefix và RelKey; mọi giá trị được gửi lên đều bị bỏ qua.
	Key string `json:"key,omitempty"`
}

// UploadObjInput yêu cầu tải các file trên máy lên bucket.
type UploadObjInput struct {
	ConnectionId string `json:"connectionId"`
	ProfileName  string `json:"profileName,omitempty"`
	Bucket       string `json:"bucket"`
	// Prefix là thư mục đích để tải file lên, ví dụ "photos/2026/".
	// Nếu rỗng thì tải vào gốc bucket.
	Prefix  string      `json:"prefix"`
	ObjList []UploadObj `json:"objList"`
}
