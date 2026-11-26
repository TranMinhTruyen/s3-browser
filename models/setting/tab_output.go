package setting

// TabItem là một tab đã ghi nhớ; ProfileID là null nếu tab chưa gắn hồ sơ.
type TabItem struct {
	ID        string  `json:"id"`
	ProfileID *string `json:"profileId"`
}

// SqlTabTable là bảng được mở trong một tab cấu trúc.
type SqlTabTable struct {
	Schema string `json:"schema"`
	Name   string `json:"name"`
}

// SqlTabItem là một tab SQL đã ghi nhớ.
type SqlTabItem struct {
	ID        string       `json:"id"`
	ProfileID *string      `json:"profileId"`
	Query     string       `json:"query"`
	Table     *SqlTabTable `json:"table,omitempty"`
}

// TabState là nội dung của tabs.json: bố cục tab S3 và SQL.
type TabState struct {
	Tabs         []TabItem    `json:"tabs"`
	ActiveTab    string       `json:"activeTab"`
	SqlTabs      []SqlTabItem `json:"sqlTabs,omitempty"`
	ActiveSqlTab string       `json:"activeSqlTab,omitempty"`
}
