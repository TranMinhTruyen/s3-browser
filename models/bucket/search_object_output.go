package bucket

// SearchObjectOutput là một trang object khớp; NextCursor rỗng nghĩa là không còn kết quả.
type SearchObjectOutput struct {
	ObjectList []ObjectItem `json:"objectList"`
	NextCursor string       `json:"nextCursor"`
}
