package bucket

// DeletePrefixInput yêu cầu xóa đệ quy mọi object nằm dưới Prefix.
type DeletePrefixInput struct {
	ConnectionId string `json:"connectionId"`
	ProfileName  string `json:"profileName,omitempty"`
	Bucket       string `json:"bucket"`
	Prefix       string `json:"prefix"`
}
