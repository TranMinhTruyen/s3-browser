package setting

// SaveTabStateInput chứa bố cục tab người dùng muốn ghi nhớ.
type SaveTabStateInput struct {
	Tabs      []TabItem `json:"tabs"`
	ActiveTab string    `json:"activeTab"`
}

// SaveSqlTabStateInput chứa bố cục SQL cần ghi nhớ.
type SaveSqlTabStateInput struct {
	Tabs      []SqlTabItem `json:"tabs"`
	ActiveTab string       `json:"activeTab"`
}
