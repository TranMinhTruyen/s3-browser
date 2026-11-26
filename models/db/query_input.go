package db

// TableInfoInput chỉ định một bảng trong hồ sơ đã kết nối.
type TableInfoInput struct {
	ProfileId string `json:"profileId"`
	Schema    string `json:"schema"`
	Table     string `json:"table"`
}

// ExecuteSqlInput chạy Sql (một hoặc nhiều câu lệnh) trên kết nối của tab TabId.
type ExecuteSqlInput struct {
	ProfileId string `json:"profileId"`
	TabId     string `json:"tabId"`
	Sql       string `json:"sql"`
}

// OpenTableRowsInput đọc các hàng trong bảng qua kết nối của tab TabId.
type OpenTableRowsInput struct {
	ProfileId string `json:"profileId"`
	TabId     string `json:"tabId"`
	Schema    string `json:"schema"`
	Table     string `json:"table"`
}

// FetchRowsInput tải trang tiếp theo của cursor kết quả thuộc tab TabId.
type FetchRowsInput struct {
	TabId    string `json:"tabId"`
	CursorId uint64 `json:"cursorId"`
	// All đọc mọi hàng còn lại trong một lần gọi, không giới hạn số trang, cho đến khi hoàn tất hoặc bị hủy.
	All bool `json:"all"`
}

// CloseDbTabInput đóng kết nối của tab TabId.
type CloseDbTabInput struct {
	TabId string `json:"tabId"`
}
