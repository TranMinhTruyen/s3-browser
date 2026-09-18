package master

type RegionOutput struct {
	RegionData map[string][]MasterOutput `json:"regionData,omitempty"`
}
