package profile

// ImportFileOutput describes the profile file chosen for import. Path is empty when the user cancels the dialog.
// Encrypted means the file holds secrets, so ImportProfile needs the password.
type ImportFileOutput struct {
	Path      string `json:"path"`
	Name      string `json:"name"`
	Encrypted bool   `json:"encrypted"`
}
