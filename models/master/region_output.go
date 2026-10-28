package master

// RegionOutput groups region rows by their Value2 column (the provider).
type RegionOutput struct {
	RegionData map[string][]MasterOutput `json:"regionData,omitempty"`
}
