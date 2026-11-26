package db

import (
	"S3Browser/models"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// executeParams là tham số của phương thức native "execute".
type executeParams struct {
	ConnId       uint64 `json:"connId"`
	Sql          string `json:"sql"`
	PageSize     int    `json:"pageSize"`
	MaxPageBytes int    `json:"maxPageBytes"`
}

// fetchParams là tham số của phương thức native "fetch".
type fetchParams struct {
	ConnId       uint64 `json:"connId"`
	CursorId     uint64 `json:"cursorId"`
	PageSize     int    `json:"pageSize"`
	MaxPageBytes int    `json:"maxPageBytes"`
}

// tableRowsParams là tham số của phương thức native "tableRows".
type tableRowsParams struct {
	ConnId       uint64 `json:"connId"`
	Schema       string `json:"schema"`
	Table        string `json:"table"`
	PageSize     int    `json:"pageSize"`
	MaxPageBytes int    `json:"maxPageBytes"`
}

// submoduleQueryMng chạy truy vấn và phân trang kết quả trên kết nối của tab. Các hàng chỉ được chuyển tiếp:
// module không lưu hay ghi log câu SQL hoặc dữ liệu.
type submoduleQueryMng struct {
	logger *slog.Logger
	app    *application.App
	native *submoduleNativeMng
	conns  *submoduleConnMng
}

// newSubmoduleQueryMng tạo bộ chạy truy vấn.
func newSubmoduleQueryMng(
	app *application.App,
	logger *slog.Logger,
	native *submoduleNativeMng,
	conns *submoduleConnMng,
) *submoduleQueryMng {
	m := &submoduleQueryMng{logger: logger.With("submodules", "query"), app: app, native: native, conns: conns}
	app.HandleStream("db-fetch-rows", m.streamFetchAll)
	return m
}

// streamFetchAll drains a cursor page by page and sends each page over Wails Stream.
// Closing the frontend stream cancels the active native call through c.Context().
func (m *submoduleQueryMng) streamFetchAll(c *application.StreamConn) {
	defer c.Close()

	var input models.FetchRowsInput
	if err := c.ReceiveJSON(&input); err != nil {
		return
	}
	started := time.Now()
	pages := 0
	var bytesSent int64
	outcome := "completed"
	defer func() {
		m.logger.Info("fetch all stream finished",
			"tabId", input.TabId,
			"duration_ms", time.Since(started).Milliseconds(),
			"pages", pages,
			"bytes", bytesSent,
			"outcome", outcome,
		)
	}()

	for {
		if c.Context().Err() != nil {
			outcome = "cancelled"
			return
		}
		// Stream mode always uses the normal bounded page size. The `all` flag
		// on the regular FetchRows method deliberately remains a single-call API.
		page := m.fetchRows(c.Context(), models.FetchRowsInput{TabId: input.TabId, CursorId: input.CursorId})
		pageRaw, err := json.Marshal(page)
		if err != nil {
			outcome = "encode_error"
			logCallFailure(c.Context(), m.logger, "encode streamed SQL page failed", err, "tabId", input.TabId)
			return
		}
		if err := c.Send(pageRaw); err != nil {
			if c.Context().Err() != nil {
				outcome = "cancelled"
			} else {
				outcome = "stream_error"
			}
			return
		}
		pages++
		bytesSent += int64(len(pageRaw))
		if !page.Result {
			outcome = "query_error"
			return
		}

		// Only inspect `done`; json.Unmarshal skips the potentially large rows array.
		var pageMeta struct {
			Body struct {
				Done bool `json:"done"`
			} `json:"body"`
		}
		if err := json.Unmarshal(pageRaw, &pageMeta); err != nil {
			outcome = "decode_error"
			logCallFailure(c.Context(), m.logger, "read streamed SQL page metadata failed", err, "tabId", input.TabId)
			return
		}
		if pageMeta.Body.Done {
			// The frontend acknowledges the final frame after parsing it and
			// applying the last page, so this duration includes client receipt.
			var ack struct {
				Type string `json:"type"`
			}
			if err := c.ReceiveJSON(&ack); err != nil || ack.Type != "ack" {
				if c.Context().Err() != nil {
					outcome = "cancelled"
				} else {
					outcome = "ack_error"
				}
			}
			return
		}
	}
}

// statementErrorKey đánh dấu câu lệnh lỗi trong JSON kết quả. Cell và câu SQL không thể chứa chuỗi này
// (dấu ngoặc kép được escape), nên kết quả không có chuỗi này nghĩa là không có câu lệnh lỗi; nếu khớp nhầm thì chỉ tốn thêm một lần decode.
var statementErrorKey = []byte(`"error":`)

// tabFail kết thúc lời gọi thất bại cần kết nối của tab: hồ sơ chưa kết nối trả DBE014, lỗi khác là lỗi native.
// errTabClosed (tab đóng trong lúc mở kết nối) trả Result=false mà không gửi thông báo.
func tabFail[T any](
	ctx context.Context,
	m *submoduleQueryMng,
	output models.Output[T],
	profileId string,
	err error,
	params map[string]any,
) models.Output[T] {
	if errors.Is(err, errTabClosed) {
		return output.ThrowError() // the tab is gone, nobody waits for the result
	}
	if errors.Is(err, errNotConnected) {
		return output.ThrowError(m.conns.notConnectedMessage(profileId))
	}
	return failCall(ctx, output, err, queryTimeout, params)
}

// execute chạy câu SQL của tab. Lỗi câu lệnh được trả về bên trong kết quả câu lệnh dưới dạng DBE006.
func (m *submoduleQueryMng) execute(
	ctx context.Context,
	input models.ExecuteSqlInput,
) models.Output[models.ExecuteSqlOutput] {
	output := models.NewOutput[models.ExecuteSqlOutput]()

	ctx, cancel := withCallContext(ctx, m.app.Context(), queryTimeout)
	defer cancel()

	connId, err := m.conns.tabConnOf(ctx, input.ProfileId, input.TabId)
	if err != nil {
		if !errors.Is(err, errTabClosed) { // expected when the tab closes while opening
			logCallFailure(ctx, m.logger, "open tab connection failed", err, "tabId", input.TabId)
		}
		return tabFail(ctx, m, output, input.ProfileId, err, nil)
	}

	raw, err := callNativeRaw(ctx, m.native, "execute", executeParams{connId, input.Sql, pageSize, maxPageBytes})
	if err != nil {
		logCallFailure(ctx, m.logger, "execute failed", err, "tabId", input.TabId)
		return failCall(ctx, output, err, queryTimeout, nil)
	}

	// Chuyển tiếp nguyên trạng các hàng; chỉ cần decode để ánh xạ mã lỗi của câu lệnh thất bại.
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

// openTableRows đọc trang đầu tiên của các hàng trong bảng.
func (m *submoduleQueryMng) openTableRows(
	ctx context.Context,
	input models.OpenTableRowsInput,
) models.Output[models.StatementResult] {
	output := models.NewOutput[models.StatementResult]()

	ctx, cancel := withCallContext(ctx, m.app.Context(), queryTimeout)
	defer cancel()

	connId, err := m.conns.tabConnOf(ctx, input.ProfileId, input.TabId)
	if err != nil {
		if !errors.Is(err, errTabClosed) { // expected when the tab closes while opening
			logCallFailure(ctx, m.logger, "open tab connection failed", err, "tabId", input.TabId)
		}
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

// fetchRows tải trang tiếp theo của cursor thuộc tab; trả DBE004 nếu tab chưa có kết nối.
func (m *submoduleQueryMng) fetchRows(
	ctx context.Context,
	input models.FetchRowsInput,
) models.Output[models.FetchRowsOutput] {
	output := models.NewOutput[models.FetchRowsOutput]()

	tab, ok := m.conns.tabOf(input.TabId)
	if !ok {
		return output.ThrowError(closedMessage())
	}

	size, maxBytes, timeout := pageSize, maxPageBytes, queryTimeout
	if input.All {
		size, maxBytes, timeout = unlimited, unlimited, 0
	}
	ctx, cancel := withCallContext(ctx, m.app.Context(), timeout)
	defer cancel()

	raw, err := callNativeRaw(ctx, m.native, "fetch", fetchParams{tab.connId, input.CursorId, size, maxBytes})
	if err != nil {
		logCallFailure(ctx, m.logger, "fetch rows failed", err, "tabId", input.TabId)
		return failCall(ctx, output, err, queryTimeout, nil)
	}
	output.Body = output.Body.WithRaw(raw)
	return output
}
