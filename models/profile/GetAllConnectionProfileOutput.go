package profile

import (
	"time"
)

type ConnectionProfileOutput struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	Color        string    `json:"color"`
	Endpoint     string    `json:"endpoint"`
	Region       string    `json:"region"`
	AccessKey    string    `json:"access_key"`
	SecretKey    string    `json:"secret_key"`
	PathStyle    bool      `json:"path_style"`
	SavePassword bool      `json:"save_password"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
	Version      int64     `json:"version"`
	IsConnected  bool      `json:"isConnected"`
}

type GetAllConnectionProfileOutput struct {
	ConnectionProfiles map[string]ConnectionProfileOutput `json:"connectionProfiles"`
}
