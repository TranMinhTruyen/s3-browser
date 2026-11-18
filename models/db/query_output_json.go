//go:build !wailsgen

package db

import "encoding/json"

// The Wails bindings generator renders a type with a MarshalJSON method as `any`, so these methods are left
// out when it runs with the tag wailsgen (go tool wails3 generate bindings -f "-tags=wailsgen" ...). The
// app is built without the tag and forwards the native JSON as it is, which is what the typed fields describe.

// The plain types have no methods, so marshaling them does not call MarshalJSON again.
type (
	statementResultPlain  StatementResult
	executeSqlOutputPlain ExecuteSqlOutput
	fetchRowsOutputPlain  FetchRowsOutput
)

// MarshalJSON returns the forwarded JSON, or the typed fields when there is none.
func (r StatementResult) MarshalJSON() ([]byte, error) {
	if r.raw != nil {
		return r.raw, nil
	}
	return json.Marshal(statementResultPlain(r))
}

// MarshalJSON returns the forwarded JSON, or the typed fields when there is none.
func (o ExecuteSqlOutput) MarshalJSON() ([]byte, error) {
	if o.raw != nil {
		return o.raw, nil
	}
	return json.Marshal(executeSqlOutputPlain(o))
}

// MarshalJSON returns the forwarded JSON, or the typed fields when there is none.
func (o FetchRowsOutput) MarshalJSON() ([]byte, error) {
	if o.raw != nil {
		return o.raw, nil
	}
	return json.Marshal(fetchRowsOutputPlain(o))
}
