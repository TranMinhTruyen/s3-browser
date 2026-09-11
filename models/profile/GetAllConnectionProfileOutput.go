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
	AccessKey    string    `json:"accessKey"`
	SecretKey    string    `json:"secretKey"`
	PathStyle    bool      `json:"pathStyle"`
	SavePassword bool      `json:"savePassword"`
	AutoConnect  bool      `json:"autoConnect"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
	Version      int64     `json:"version"`
	IsConnected  bool      `json:"isConnected"`
}

type GetAllConnectionProfileOutput struct {
	ConnectionProfiles map[string]ConnectionProfileOutput `json:"connectionProfiles"`
}
