package master

// RegionOutput nhóm các hàng region theo cột Value2 (provider).
type RegionOutput struct {
	RegionData map[string][]MasterOutput `json:"regionData,omitempty"`
}
