package master

type MasterOutput struct {
	Code      string `json:"code"`
	Name      string `json:"name"`
	SortOrder int64  `json:"sortOrder"`
	Value1    string `json:"value1"`
	Value2    string `json:"value2,omitempty"`
	Value3    string `json:"value3,omitempty"`
	Value4    string `json:"value4,omitempty"`
	Value5    string `json:"value5,omitempty"`
	Value6    string `json:"value6,omitempty"`
	Value7    string `json:"value7,omitempty"`
	Value8    string `json:"value8,omitempty"`
	Value9    string `json:"value9,omitempty"`
	Value10   string `json:"value10,omitempty"`
}

type GetMasterDataOutput struct {
	MasterData map[string][]MasterOutput `json:"masterData"`
}
