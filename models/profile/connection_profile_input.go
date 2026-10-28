// Package profile holds the input/output models of the connection profile module.
package profile

// ConnectionProfileInput is the form data to create or update a connection profile.
// Version is used for optimistic locking on update.
type ConnectionProfileInput struct {
	Id           string `json:"id,omitempty"`
	Name         string `json:"name,omitempty"`
	Color        string `json:"color,omitempty"`
	Provider     string `json:"provider,omitempty"`
	Endpoint     string `json:"endpoint,omitempty"`
	Region       string `json:"region,omitempty"`
	AccessKey    string `json:"accessKey,omitempty"`
	SecretKey    string `json:"secretKey,omitempty"`
	PathStyle    bool   `json:"pathStyle,omitempty"`
	SavePassword bool   `json:"savePassword,omitempty"`
	AutoConnect  bool   `json:"autoConnect,omitempty"`
	Version      int64  `json:"version,omitempty"`
}
