package bucket

// SearchObjectOutput is one page of matching objects; an empty NextCursor means no more results.
type SearchObjectOutput struct {
	ObjectList []ObjectItem `json:"objectList"`
	NextCursor string       `json:"nextCursor"`
}
