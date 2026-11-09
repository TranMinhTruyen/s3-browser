package profile

// ImportProfileInput selects the profile file to import. Password opens the secrets of an encrypted file and is
// never stored or logged.
type ImportProfileInput struct {
	Path     string `json:"path"`
	Password string `json:"password,omitempty"`
}
