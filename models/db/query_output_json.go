//go:build !wailsgen

package db

import "encoding/json"

// Bộ sinh binding của Wails chuyển kiểu có phương thức MarshalJSON thành `any`, vì vậy bỏ qua các phương thức này
// khi chạy với tag wailsgen (go tool wails3 generate bindings -f "-tags=wailsgen" ...). Ứng dụng được build không có tag
// này và chuyển tiếp nguyên JSON native, đúng như các trường có kiểu mô tả.

// Các kiểu dữ liệu thuần không có phương thức nên marshal chúng sẽ không gọi lại MarshalJSON.
type (
	statementResultPlain  StatementResult
	executeSqlOutputPlain ExecuteSqlOutput
	fetchRowsOutputPlain  FetchRowsOutput
)

// MarshalJSON trả về JSON được chuyển tiếp hoặc các trường có kiểu nếu không có JSON đó.
func (r StatementResult) MarshalJSON() ([]byte, error) {
	if r.raw != nil {
		return r.raw, nil
	}
	return json.Marshal(statementResultPlain(r))
}

// MarshalJSON trả về JSON được chuyển tiếp hoặc các trường có kiểu nếu không có JSON đó.
func (o ExecuteSqlOutput) MarshalJSON() ([]byte, error) {
	if o.raw != nil {
		return o.raw, nil
	}
	return json.Marshal(executeSqlOutputPlain(o))
}

// MarshalJSON trả về JSON được chuyển tiếp hoặc các trường có kiểu nếu không có JSON đó.
func (o FetchRowsOutput) MarshalJSON() ([]byte, error) {
	if o.raw != nil {
		return o.raw, nil
	}
	return json.Marshal(fetchRowsOutputPlain(o))
}
