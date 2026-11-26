package bucket

// CreateBucketInput yêu cầu tạo bucket trên một kết nối.
type CreateBucketInput struct {
	ConnectionId string `json:"connectionId"`
	ProfileName  string `json:"profileName,omitempty"`
	Bucket       string `json:"bucket"`
	// Region chỉ được dùng với AWS thật; nếu rỗng thì dùng region của kết nối.
	Region string `json:"region,omitempty"`
	// Mode là quyền truy cập được đặt sau khi tạo: private (hoặc rỗng, không đặt quyền), public hoặc custom.
	Mode string `json:"mode,omitempty"`
	// Policy là JSON policy, chỉ dùng với chế độ custom.
	Policy string `json:"policy,omitempty"`
}
