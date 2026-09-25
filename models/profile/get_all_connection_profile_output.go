package profile

import (
	"time"
)

type ConnectionProfileOutput struct {
	ID           string    `json:"id,omitempty"`
	Name         string    `json:"name,omitempty"`
	Color        string    `json:"color,omitempty"`
	Endpoint     string    `json:"endpoint,omitempty"`
	Region       string    `json:"region,omitempty"`
	AccessKey    string    `json:"accessKey,omitempty"`
	SecretKey    string    `json:"secretKey,omitempty"`
	PathStyle    bool      `json:"pathStyle,omitempty"`
	SavePassword bool      `json:"savePassword,omitempty"`
	AutoConnect  bool      `json:"autoConnect,omitempty"`
	CreatedAt    time.Time `json:"createdAt,omitempty"`
	UpdatedAt    time.Time `json:"updatedAt,omitempty"`
	Version      int64     `json:"version,omitempty"`
	IsConnected  bool      `json:"isConnected,omitempty"`
}

type GetAllConnectionProfileOutput struct {
	ConnectionProfiles map[string]ConnectionProfileOutput `json:"connectionProfiles,omitempty"`
}
