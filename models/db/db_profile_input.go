// Package db holds the input/output models of the database (SQL mode) module.
package db

// DbProfileConfig is the connection setting of a database profile, stored as JSON. Only the fields of the
// profile's provider are kept: sqlite uses FilePath and ReadOnly, postgres the others. The password is not here.
type DbProfileConfig struct {
	FilePath string `json:"filePath,omitempty"` // sqlite
	ReadOnly bool   `json:"readOnly,omitempty"` // sqlite
	Host     string `json:"host,omitempty"`     // postgres
	Port     int    `json:"port,omitempty"`     // postgres
	Database string `json:"database,omitempty"` // postgres
	Username string `json:"username,omitempty"` // postgres
	SslMode  string `json:"sslMode,omitempty"`  // postgres
}

// DbProfileInput is the form data to create or update a database profile. Id is empty on create. Secret is the
// plain password; empty on update keeps the stored one when the provider is unchanged.
type DbProfileInput struct {
	Id       string          `json:"id,omitempty"`
	Name     string          `json:"name,omitempty"`
	Color    string          `json:"color,omitempty"`
	Provider string          `json:"provider,omitempty"`
	Config   DbProfileConfig `json:"config"`
	Secret   string          `json:"secret,omitempty"`
}

// DbProfileRefInput names a saved database profile.
type DbProfileRefInput struct {
	ProfileId string `json:"profileId"`
}
