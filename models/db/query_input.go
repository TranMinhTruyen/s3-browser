package db

// TableInfoInput names a table of a connected profile.
type TableInfoInput struct {
	ProfileId string `json:"profileId"`
	Schema    string `json:"schema"`
	Table     string `json:"table"`
}

// ExecuteSqlInput runs Sql (one or more statements) on the connection of tab TabId.
type ExecuteSqlInput struct {
	ProfileId string `json:"profileId"`
	TabId     string `json:"tabId"`
	Sql       string `json:"sql"`
}

// OpenTableRowsInput reads the rows of a table on the connection of tab TabId.
type OpenTableRowsInput struct {
	ProfileId string `json:"profileId"`
	TabId     string `json:"tabId"`
	Schema    string `json:"schema"`
	Table     string `json:"table"`
}

// FetchRowsInput loads the next page of the result cursor of tab TabId.
type FetchRowsInput struct {
	TabId    string `json:"tabId"`
	CursorId uint64 `json:"cursorId"`
}

// CloseDbTabInput closes the connection of tab TabId.
type CloseDbTabInput struct {
	TabId string `json:"tabId"`
}
