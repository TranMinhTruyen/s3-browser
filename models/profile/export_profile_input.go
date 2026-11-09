package profile

// ExportProfileInput selects the profile to export. With IncludeSecret the saved secrets go into the file,
// encrypted with Password (at least 8 characters). Password is never stored or logged.
type ExportProfileInput struct {
	Id            string `json:"id"`
	IncludeSecret bool   `json:"includeSecret"`
	Password      string `json:"password,omitempty"`
}
