package profile

// GetAllConnectionProfileOutput ánh xạ ID hồ sơ sang hồ sơ tương ứng.
type GetAllConnectionProfileOutput struct {
	ConnectionProfiles map[string]ConnectionProfileOutput `json:"connectionProfiles"`
}
