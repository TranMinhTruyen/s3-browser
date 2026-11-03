package profile

import "time"

// ConnectionProfileOutput is a saved connection profile with its live connection state.
// It never carries a secret: SavedSecrets only names the secrets that are stored
// ("secretKey", "sessionToken", "ldapPassword", "keyPassword").
type ConnectionProfileOutput struct {
	ID           string     `json:"id"`
	Name         string     `json:"name,omitempty"`
	Color        string     `json:"color,omitempty"`
	Provider     string     `json:"provider,omitempty"`
	Endpoint     string     `json:"endpoint,omitempty"`
	Region       string     `json:"region,omitempty"`
	AccessKey    string     `json:"accessKey,omitempty"`
	PathStyle    bool       `json:"pathStyle"`
	AutoConnect  bool       `json:"autoConnect"`
	CreatedAt    time.Time  `json:"createdAt"`
	UpdatedAt    time.Time  `json:"updatedAt"`
	Version      int64      `json:"version,omitempty"`
	IsConnected  bool       `json:"isConnected"`
	AuthType     string     `json:"authType"`
	AuthConfig   AuthConfig `json:"authConfig"`
	SavedSecrets []string   `json:"savedSecrets"`
}
