package profile

// GetAllConnectionProfileOutput maps profile ID to profile.
type GetAllConnectionProfileOutput struct {
	ConnectionProfiles map[string]ConnectionProfileOutput `json:"connectionProfiles"`
}
