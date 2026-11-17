package db

// DbProfileOutput is a saved database profile. The secret is never returned, only whether one is stored.
type DbProfileOutput struct {
	Id        string          `json:"id"`
	Name      string          `json:"name"`
	Color     string          `json:"color"`
	Provider  string          `json:"provider"`
	Config    DbProfileConfig `json:"config"`
	HasSecret bool            `json:"hasSecret"`
}

// GetAllDbProfileOutput lists the saved database profiles, oldest first.
type GetAllDbProfileOutput struct {
	DbProfiles []DbProfileOutput `json:"dbProfiles"`
}
