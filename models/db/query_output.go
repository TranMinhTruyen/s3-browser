package db

import "encoding/json"

// DbColumn is a result column; Type is the declared type ("" when the engine has none).
type DbColumn struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

// StatementError is the error of one statement. Code is a message code (DBE006 for an SQL error) and
// Message the engine detail; it is shown with the result, not as a toast.
type StatementError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// StatementResult is the result of one statement. Kind is "rows" (Columns, Rows, and CursorId while Done is
// false) or "affected" (RowsAffected). A page can hold fewer rows than the page size without being Done.
// Truncated means rows were left unread and cannot be loaded (only the last statement keeps its cursor).
// Cells are text; a nil cell is NULL.
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

// WithRaw returns r that marshals as raw, the JSON the native library sent, without decoding it. The typed
// fields stay empty: they exist for the bindings and for the path that must read the result.
func (r StatementResult) WithRaw(raw json.RawMessage) StatementResult {
	r.raw = raw
	return r
}

// ExecuteSqlOutput lists the statements that ran; a failed statement is the last one and has Error.
type ExecuteSqlOutput struct {
	Statements []StatementResult `json:"statements"`

	raw json.RawMessage // see StatementResult.raw
}

// WithRaw is like StatementResult.WithRaw.
func (o ExecuteSqlOutput) WithRaw(raw json.RawMessage) ExecuteSqlOutput {
	o.raw = raw
	return o
}

// FetchRowsOutput is the next page of a cursor.
type FetchRowsOutput struct {
	Rows [][]*string `json:"rows"`
	Done bool        `json:"done"`

	raw json.RawMessage // see StatementResult.raw
}

// WithRaw is like StatementResult.WithRaw.
func (o FetchRowsOutput) WithRaw(raw json.RawMessage) FetchRowsOutput {
	o.raw = raw
	return o
}
