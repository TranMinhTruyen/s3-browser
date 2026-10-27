package bucket

type SearchObjectOutput struct {
	ObjectList []ObjectItem `json:"objectList"`
	NextCursor string       `json:"nextCursor"`
}
