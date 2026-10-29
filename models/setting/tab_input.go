package setting

// SaveTabStateInput is the tab layout the user wants to remember.
type SaveTabStateInput struct {
	Tabs      []TabItem `json:"tabs"`
	ActiveTab string    `json:"activeTab"`
}
