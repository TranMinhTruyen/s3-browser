package profile

import (
	"time"
)

type ConnectionProfileOutput struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Color     string    `json:"color"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
	Version   int64     `json:"version"`
}

type GetAllConnectionProfileOutput struct {
	ConnectionProfiles []ConnectionProfileOutput `json:"connectionProfiles"`
	Message            string                    `json:"message,omitempty"`
}
