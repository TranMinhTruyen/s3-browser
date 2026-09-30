package profile

import "time"

type ConnectionProfileOutput struct {
	ID          string    `json:"id"`
	Name        string    `json:"name,omitempty"`
	Color       string    `json:"color,omitempty"`
	Provider    string    `json:"provider,omitempty"`
	Endpoint    string    `json:"endpoint,omitempty"`
	Region      string    `json:"region,omitempty"`
	AccessKey   string    `json:"accessKey,omitempty"`
	SecretKey   string    `json:"secretKey,omitempty"`
	PathStyle   bool      `json:"pathStyle"`
	AutoConnect bool      `json:"autoConnect"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
	Version     int64     `json:"version,omitempty"`
	IsConnected bool      `json:"isConnected"`
}
