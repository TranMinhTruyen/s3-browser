package bucket

// FilesDroppedOutput is sent to the frontend when files are dropped on a tab's object list.
type FilesDroppedOutput struct {
	// TabId is the tab the files were dropped on (the drop target's data-tab-id).
	TabId string `json:"tabId"`
	// Paths are the dropped regular files, in drop order.
	Paths []string `json:"paths"`
	// Skipped is the number of dropped items that are not regular files (e.g. folders).
	Skipped int `json:"skipped"`
}
