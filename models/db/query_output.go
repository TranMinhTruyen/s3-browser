package db

import "encoding/json"

// DbColumn là một cột kết quả; Type là kiểu đã khai báo ("" nếu engine không có kiểu).
type DbColumn struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

// StatementError là lỗi của một câu lệnh. Code là mã thông báo (DBE006 cho lỗi SQL), còn Message là chi tiết từ engine;
// lỗi được hiển thị cùng kết quả, không hiện dưới dạng toast.
type StatementError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// StatementResult là kết quả của một câu lệnh. Kind là "rows" (Columns, Rows và CursorId khi Done là false)
// hoặc "affected" (RowsAffected). Trang có thể chứa ít hàng hơn page size mà Done vẫn chưa bật.
// Truncated nghĩa là còn hàng chưa đọc nhưng không thể tải thêm (chỉ câu lệnh cuối cùng giữ cursor).
// Cells chứa văn bản; cell nil là NULL.
type StatementResult struct {
	Index        int             `json:"index"`
	Sql          string          `json:"sql"`
	Kind         string          `json:"kind"`
	Columns      []DbColumn      `json:"columns"`
	Rows         [][]*string     `json:"rows"`
	CursorId     *uint64         `json:"cursorId"`
	Done         bool            `json:"done"`
	Truncated    bool            `json:"truncated"`
	RowsAffected int64           `json:"rowsAffected"`
	ElapsedMs    int64           `json:"elapsedMs"`
	Error        *StatementError `json:"error"`

	raw json.RawMessage // JSON of the whole result when the native library's bytes are forwarded as they are
}

// WithRaw trả về r được marshal thành JSON thô do thư viện native gửi, không giải mã JSON. Các trường có kiểu vẫn rỗng:
// chúng tồn tại cho binding và cho luồng cần đọc kết quả.
func (r StatementResult) WithRaw(raw json.RawMessage) StatementResult {
	r.raw = raw
	return r
}

// ExecuteSqlOutput liệt kê các câu lệnh đã chạy; câu lệnh thất bại nằm cuối cùng và có Error.
type ExecuteSqlOutput struct {
	Statements []StatementResult `json:"statements"`

	raw json.RawMessage // see StatementResult.raw
}

// WithRaw hoạt động tương tự StatementResult.WithRaw.
func (o ExecuteSqlOutput) WithRaw(raw json.RawMessage) ExecuteSqlOutput {
	o.raw = raw
	return o
}

// FetchRowsOutput chứa trang tiếp theo của cursor.
type FetchRowsOutput struct {
	Rows [][]*string `json:"rows"`
	Done bool        `json:"done"`

	raw json.RawMessage // see StatementResult.raw
}

// WithRaw hoạt động tương tự StatementResult.WithRaw.
func (o FetchRowsOutput) WithRaw(raw json.RawMessage) FetchRowsOutput {
	o.raw = raw
	return o
}
