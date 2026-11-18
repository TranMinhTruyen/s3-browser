package db

import (
	"S3Browser/models"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// executeParams are the params of the native "execute" method.
type executeParams struct {
	ConnId       uint64 `json:"connId"`
	Sql          string `json:"sql"`
	PageSize     int    `json:"pageSize"`
	MaxPageBytes int    `json:"maxPageBytes"`
}

// fetchParams are the params of the native "fetch" method.
type fetchParams struct {
	ConnId       uint64 `json:"connId"`
	CursorId     uint64 `json:"cursorId"`
	PageSize     int    `json:"pageSize"`
	MaxPageBytes int    `json:"maxPageBytes"`
}

// tableRowsParams are the params of the native "tableRows" method.
type tableRowsParams struct {
	ConnId       uint64 `json:"connId"`
	Schema       string `json:"schema"`
	Table        string `json:"table"`
	PageSize     int    `json:"pageSize"`
	MaxPageBytes int    `json:"maxPageBytes"`
}

// submoduleQueryMng runs queries and pages through their results on the connection of a tab. Rows are only
// forwarded: the module neither keeps nor logs SQL or data.
type submoduleQueryMng struct {
	logger *slog.Logger
	app    *application.App
	native *submoduleNativeMng
	conns  *submoduleConnMng
}

// newSubmoduleQueryMng creates the query runner.
func newSubmoduleQueryMng(
	app *application.App,
	logger *slog.Logger,
	native *submoduleNativeMng,
	conns *submoduleConnMng,
) *submoduleQueryMng {
	return &submoduleQueryMng{logger: logger.With("submodules", "query"), app: app, native: native, conns: conns}
}

// statementErrorKey is how a failed statement shows in the result JSON. Cell and SQL text cannot contain it
// (their quotes are escaped), so a result without it has no failed statement; a false match only costs a decode.
var statementErrorKey = []byte(`"error":`)

// tabFail ends a failed call that needed the connection of a tab: a profile that is not connected is DBE014,
// anything else is a native failure.
func tabFail[T any](
	ctx context.Context,
	m *submoduleQueryMng,
	output models.Output[T],
	profileId string,
	err error,
	params map[string]any,
) models.Output[T] {
	if errors.Is(err, errNotConnected) {
		return output.ThrowError(m.conns.notConnectedMessage(profileId))
	}
	return failCall(ctx, output, err, queryTimeout, params)
}

// execute runs the SQL of the tab. A statement error comes back inside the statement as a DBE006 error.
func (m *submoduleQueryMng) execute(
	ctx context.Context,
	input models.ExecuteSqlInput,
) models.Output[models.ExecuteSqlOutput] {
	output := models.NewOutput[models.ExecuteSqlOutput]()

	ctx, cancel := withCallContext(ctx, m.app.Context(), queryTimeout)
	defer cancel()

	connId, err := m.conns.tabConnOf(ctx, input.ProfileId, input.TabId)
	if err != nil {
		logCallFailure(ctx, m.logger, "open tab connection failed", err, "tabId", input.TabId)
		return tabFail(ctx, m, output, input.ProfileId, err, nil)
	}

	raw, err := callNativeRaw(ctx, m.native, "execute", executeParams{connId, input.Sql, pageSize, maxPageBytes})
	if err != nil {
		logCallFailure(ctx, m.logger, "execute failed", err, "tabId", input.TabId)
		return failCall(ctx, output, err, queryTimeout, nil)
	}

	// Rows are forwarded as they are; only a failed statement needs its code mapped, which means decoding.
	if !bytes.Contains(raw, statementErrorKey) {
		output.Body = output.Body.WithRaw(raw)
		return output
	}

	var res models.ExecuteSqlOutput
	if err := json.Unmarshal(raw, &res); err != nil {
		err = &nativeError{Code: codeInternal, Message: "decode response: " + err.Error()}
		logCallFailure(ctx, m.logger, "execute failed", err, "tabId", input.TabId)
		return failCall(ctx, output, err, queryTimeout, nil)
	}
	for i := range res.Statements {
		if e := res.Statements[i].Error; e != nil {
			e.Code = errorCodeMessage(e.Code)
		}
	}
	output.Body = res
	return output
}

// openTableRows reads the first page of the rows of a table.
func (m *submoduleQueryMng) openTableRows(
	ctx context.Context,
	input models.OpenTableRowsInput,
) models.Output[models.StatementResult] {
	output := models.NewOutput[models.StatementResult]()

	ctx, cancel := withCallContext(ctx, m.app.Context(), queryTimeout)
	defer cancel()

	connId, err := m.conns.tabConnOf(ctx, input.ProfileId, input.TabId)
	if err != nil {
		logCallFailure(ctx, m.logger, "open tab connection failed", err, "tabId", input.TabId)
		return tabFail(ctx, m, output, input.ProfileId, err, nil)
	}

	raw, err := callNativeRaw(ctx, m.native, "tableRows",
		tableRowsParams{connId, input.Schema, input.Table, pageSize, maxPageBytes})
	if err != nil {
		logCallFailure(ctx, m.logger, "read table rows failed", err, "tabId", input.TabId)
		return failCall(ctx, output, err, queryTimeout, map[string]any{"name": input.Table})
	}
	output.Body = output.Body.WithRaw(raw)
	return output
}

// fetchRows loads the next page of the cursor of the tab; DBE004 if the tab has no connection.
func (m *submoduleQueryMng) fetchRows(
	ctx context.Context,
	input models.FetchRowsInput,
) models.Output[models.FetchRowsOutput] {
	output := models.NewOutput[models.FetchRowsOutput]()

	tab, ok := m.conns.tabOf(input.TabId)
	if !ok {
		return output.ThrowError(closedMessage())
	}

	ctx, cancel := withCallContext(ctx, m.app.Context(), queryTimeout)
	defer cancel()

	raw, err := callNativeRaw(ctx, m.native, "fetch", fetchParams{tab.connId, input.CursorId, pageSize, maxPageBytes})
	if err != nil {
		logCallFailure(ctx, m.logger, "fetch rows failed", err, "tabId", input.TabId)
		return failCall(ctx, output, err, queryTimeout, nil)
	}
	output.Body = output.Body.WithRaw(raw)
	return output
}
