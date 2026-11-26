package db

import (
	"S3Browser/internal/pkg/cnst"
	"S3Browser/models"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"
)

// Mã lỗi của thư viện native (protocol.rs).
const (
	codeInvalidRequest = "invalidRequest"
	codeOpenFailed     = "openFailed"
	codeNotADatabase   = "notADatabase"
	codeConnNotFound   = "connNotFound"
	codeCursorNotFound = "cursorNotFound"
	codeSqlError       = "sqlError"
	codeTableNotFound  = "tableNotFound"
	codeInternal       = "internal"
	codeCancelled      = "cancelled"
)

// cancelRetry là số lần một lời gọi đã hủy thử lại s3b_cancel trước khi trả về: lần hủy đầu tiên có thể đến
// trước khi thư viện đăng ký yêu cầu nên bị bỏ qua.
const cancelRetry = 100 * time.Millisecond

// nativeError là lỗi do thư viện native trả về.
type nativeError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e *nativeError) Error() string {
	return e.Code + ": " + e.Message
}

// loadError cho biết không thể nạp hoặc gọi thư viện native (DBE009).
type loadError struct{ err error }

func (e *loadError) Error() string { return e.err.Error() }
func (e *loadError) Unwrap() error { return e.err }

// submoduleNativeMng gọi thư viện native. Thư viện được nạp ở lần gọi đầu tiên; nếu nạp thất bại thì sẽ thử lại.
type submoduleNativeMng struct {
	logger *slog.Logger
	load   func() (nativeCaller, error)
	nextId atomic.Uint64

	mu     sync.Mutex
	caller nativeCaller
}

// newSubmoduleNativeMng tạo bộ gọi; load trả về thư viện ở lần sử dụng đầu tiên.
func newSubmoduleNativeMng(logger *slog.Logger, load func() (nativeCaller, error)) *submoduleNativeMng {
	return &submoduleNativeMng{logger: logger.With("submodules", "native"), load: load}
}

// get trả về thư viện đã nạp hoặc nạp thư viện nếu cần.
func (m *submoduleNativeMng) get() (nativeCaller, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.caller == nil {
		caller, err := m.load()
		if err != nil {
			m.logger.Error("load native library failed", "error", err)
			return nil, &loadError{err: err}
		}
		m.caller = caller
	}
	return m.caller, nil
}

// loaded cho biết thư viện đã được nạp hay chưa mà không tự nạp thư viện.
func (m *submoduleNativeMng) loaded() bool {
	m.mu.Lock()
	defer m.mu.Unlock()

	return m.caller != nil
}

// response là cấu trúc bao ngoài của phản hồi native khi phản hồi không có dạng thành công như mong đợi.
type response struct {
	Ok     bool            `json:"ok"`
	Result json.RawMessage `json:"result"`
	Error  *nativeError    `json:"error"`
}

// okPrefix mở đầu mọi phản hồi thành công (ok_response trong protocol/mod.rs), vì vậy kết quả là các byte sau tiền tố
// đến trước dấu ngoặc đóng. Tách trực tiếp mà không phân tích lại giúp tránh quét lần nữa một trang dữ liệu lớn.
var okPrefix = []byte(`{"ok":true,"result":`)

// callNative gửi một yêu cầu rồi giải mã kết quả thành T.
func callNative[T any](ctx context.Context, m *submoduleNativeMng, method string, params any) (T, error) {
	var res T

	result, err := callNativeRaw(ctx, m, method, params)
	if err != nil {
		return res, err
	}
	if len(result) > 0 {
		if err := json.Unmarshal(result, &res); err != nil {
			var zero T
			return zero, &nativeError{Code: codeInternal, Message: "decode response: " + err.Error()}
		}
	}
	return res, nil
}

// callNativeRaw gửi một yêu cầu rồi trả về JSON kết quả nguyên trạng do thư viện tạo. Nếu ctx kết thúc trước,
// hàm yêu cầu thư viện hủy; thư viện sau đó trả lời "cancelled" và lỗi sẽ chứa mã tương ứng.
func callNativeRaw(ctx context.Context, m *submoduleNativeMng, method string, params any) (json.RawMessage, error) {
	caller, err := m.get()
	if err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	id := m.nextId.Add(1)
	req, err := json.Marshal(struct {
		Id     uint64 `json:"id"`
		Method string `json:"method"`
		Params any    `json:"params"`
	}{id, method, params})
	if err != nil {
		return nil, &nativeError{Code: codeInternal, Message: err.Error()}
	}

	finished := make(chan struct{})
	defer close(finished)
	go func() {
		select {
		case <-finished:
			return
		case <-ctx.Done():
		}
		ticker := time.NewTicker(cancelRetry)
		defer ticker.Stop()
		for {
			caller.cancel(id)
			select {
			case <-finished:
				return
			case <-ticker.C:
			}
		}
	}()

	raw, err := caller.call(req)
	if err != nil {
		return nil, &nativeError{Code: codeInternal, Message: err.Error()}
	}

	if bytes.HasPrefix(raw, okPrefix) && raw[len(raw)-1] == '}' {
		return raw[len(okPrefix) : len(raw)-1], nil
	}

	var resp response
	if err := json.Unmarshal(raw, &resp); err != nil {
		return nil, &nativeError{Code: codeInternal, Message: "decode response: " + err.Error()}
	}
	if !resp.Ok {
		if resp.Error == nil {
			return nil, &nativeError{Code: codeInternal, Message: "response without error"}
		}
		return nil, resp.Error
	}
	return resp.Result, nil
}

// withCallContext tạo context dẫn xuất cho một lời gọi Wails. Context của lời gọi chỉ kết thúc khi frontend hủy,
// vì vậy hàm cũng dừng theo appCtx (ứng dụng tắt) hoặc khi hết timeout
// (timeout <= 0: không đặt thời hạn). Phải defer hàm cancel được trả về.
func withCallContext(ctx, appCtx context.Context, timeout time.Duration) (context.Context, context.CancelFunc) {
	var cancel context.CancelFunc
	if timeout > 0 {
		ctx, cancel = context.WithTimeout(ctx, timeout)
	} else {
		ctx, cancel = context.WithCancel(ctx)
	}
	stop := context.AfterFunc(appCtx, cancel)

	return ctx, func() {
		stop()
		cancel()
	}
}

// isCallCanceled cho biết frontend có hủy lời gọi hay không; khi đó không còn bên nào chờ kết quả. Timeout
// không được xem là thao tác hủy và vẫn phải được báo.
func isCallCanceled(ctx context.Context) bool {
	return errors.Is(ctx.Err(), context.Canceled)
}

// logCallFailure ghi log lời gọi thất bại: việc frontend hủy là bình thường nên chỉ ghi ở mức debug;
// timeout và mọi lỗi khác vẫn ghi ở mức error. attrs là các cặp key-value.
func logCallFailure(ctx context.Context, logger *slog.Logger, msg string, err error, attrs ...any) {
	attrs = append(attrs, "error", err)
	if isCallCanceled(ctx) {
		logger.Debug(msg, attrs...)
		return
	}
	logger.Error(msg, attrs...)
}

// timeoutText định dạng thời gian chờ cho thông báo DBE015: 5m, 30s.
func timeoutText(d time.Duration) string {
	if d%time.Minute == 0 {
		return fmt.Sprintf("%dm", int(d/time.Minute))
	}
	return d.String()
}

// errorCodeMessage ánh xạ mã lỗi native sang mã thông báo; lỗi SQL dùng DBE006.
func errorCodeMessage(code string) string {
	switch code {
	case codeInvalidRequest:
		return DBE001
	case codeOpenFailed:
		return DBE002
	case codeNotADatabase:
		return DBE003
	case codeConnNotFound:
		return DBE004
	case codeCursorNotFound:
		return DBE005
	case codeSqlError:
		return DBE006
	case codeTableNotFound:
		return DBE007
	}
	return DBE008
}

// failCall kết thúc lời gọi native thất bại. Nếu frontend đã hủy thì dừng im lặng; timeout dùng DBE015;
// params điền thông tin vào thông báo ({path}, {name}), timeout là giới hạn thời gian của lời gọi.
func failCall[T any](
	ctx context.Context,
	output models.Output[T],
	err error,
	timeout time.Duration,
	params map[string]any,
) models.Output[T] {
	timedOut := models.NewParamsMessage(cnst.MessageTypeError, cnst.Db, DBE015, "",
		map[string]any{"timeout": timeoutText(timeout)})

	var native *nativeError
	var load *loadError
	switch {
	case errors.As(err, &load):
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Db, DBE009, err.Error()))
	case errors.Is(ctx.Err(), context.Canceled):
		return output.ThrowError()
	case errors.Is(ctx.Err(), context.DeadlineExceeded):
		return output.ThrowError(timedOut)
	case errors.As(err, &native) && native.Code != codeCancelled:
		return output.ThrowError(models.NewParamsMessage(cnst.MessageTypeError, cnst.Db,
			errorCodeMessage(native.Code), native.Message, params))
	}
	return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Db, DBE008, err.Error()))
}
