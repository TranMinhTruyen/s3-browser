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

// Error codes of the native library (protocol.rs).
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

// cancelRetry is how often a canceled call repeats s3b_cancel until it returns: the first cancel can arrive
// before the library has registered the request, and is then ignored.
const cancelRetry = 100 * time.Millisecond

// nativeCaller is the s3b_db library: call blocks until the response JSON is ready, cancel interrupts the
// running request id.
type nativeCaller interface {
	call(req []byte) ([]byte, error)
	cancel(id uint64)
}

// nativeError is an error answered by the native library.
type nativeError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e *nativeError) Error() string {
	return e.Code + ": " + e.Message
}

// loadError means the native library could not be loaded or called (DBE009).
type loadError struct{ err error }

func (e *loadError) Error() string { return e.err.Error() }
func (e *loadError) Unwrap() error { return e.err }

// submoduleNativeMng calls the native library. It is loaded by the first call, and a failed load is retried.
type submoduleNativeMng struct {
	logger *slog.Logger
	load   func() (nativeCaller, error)
	nextId atomic.Uint64

	mu     sync.Mutex
	caller nativeCaller
}

// newSubmoduleNativeMng creates the caller; load returns the library on first use.
func newSubmoduleNativeMng(logger *slog.Logger, load func() (nativeCaller, error)) *submoduleNativeMng {
	return &submoduleNativeMng{logger: logger.With("submodules", "native"), load: load}
}

// get returns the loaded library, loading it if needed.
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

// response is the envelope of a native response when it is not the expected success shape.
type response struct {
	Ok     bool            `json:"ok"`
	Result json.RawMessage `json:"result"`
	Error  *nativeError    `json:"error"`
}

// okPrefix starts every success response (ok_response in protocol/mod.rs), so the result is the bytes after it
// up to the closing brace. Taking them without parsing keeps a big page from being scanned again.
var okPrefix = []byte(`{"ok":true,"result":`)

// callNative sends one request and decodes the result into T.
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

// callNativeRaw sends one request and returns the JSON of the result as the library wrote it. When ctx ends
// first it asks the library to cancel; the library then answers "cancelled" and the error carries that code.
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

// withCallContext derives the context of one Wails call. The call context only ends when the frontend cancels
// the call, so it also stops on appCtx (app shutdown) and after timeout. The returned cancel must be deferred.
func withCallContext(ctx, appCtx context.Context, timeout time.Duration) (context.Context, context.CancelFunc) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	stop := context.AfterFunc(appCtx, cancel)

	return ctx, func() {
		stop()
		cancel()
	}
}

// isCallCanceled reports whether the frontend canceled the call; nobody waits for the result then. A timeout
// is not a cancel and is still reported.
func isCallCanceled(ctx context.Context) bool {
	return errors.Is(ctx.Err(), context.Canceled)
}

// logCallFailure logs a failed call: a call the frontend canceled is expected, so it is only a debug line;
// a timeout and every other failure stay errors. attrs are key-value pairs.
func logCallFailure(ctx context.Context, logger *slog.Logger, msg string, err error, attrs ...any) {
	attrs = append(attrs, "error", err)
	if isCallCanceled(ctx) {
		logger.Debug(msg, attrs...)
		return
	}
	logger.Error(msg, attrs...)
}

// timeoutText formats a timeout for the DBE015 message: 5m, 30s.
func timeoutText(d time.Duration) string {
	if d%time.Minute == 0 {
		return fmt.Sprintf("%dm", int(d/time.Minute))
	}
	return d.String()
}

// errorCodeMessage maps a native error code to its message code; SQL errors are DBE006.
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

// failCall ends a failed native call. A call the frontend canceled returns silently; a timeout is DBE015;
// params fill the message ({path}, {name}) and timeout is the limit of the call.
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
