package setting

// TabItem is one remembered tab; ProfileID is null when the tab has no profile.
type TabItem struct {
	ID        string  `json:"id"`
	ProfileID *string `json:"profileId"`
}

// TabState is the content of tabs.json: tab order, the active tab and each tab's profile.
type TabState struct {
	Tabs      []TabItem `json:"tabs"`
	ActiveTab string    `json:"activeTab"`
}
