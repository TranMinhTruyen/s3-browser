package db

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// dllName là thư viện native được đặt cạnh exe.
const dllName = "s3b_db.dll"

// nativeCaller là thư viện s3b_db: call chờ đến khi JSON phản hồi sẵn sàng, cancel ngắt yêu cầu đang chạy theo id.
type nativeCaller interface {
	call(req []byte) ([]byte, error)
	cancel(id uint64)
}

// nativeLib gọi các hàm export của s3b_db.dll mà không dùng cgo.
type nativeLib struct {
	callProc   uintptr
	cancelProc uintptr
	freeProc   uintptr
}

// loadNative nạp s3b_db.dll từ thư mục exe (dùng đường dẫn tuyệt đối để không thể bị thay thế qua search path)
// rồi gọi s3b_init.
func loadNative() (nativeCaller, error) {
	exe, err := os.Executable()
	if err != nil {
		return nil, err
	}
	handle, err := windows.LoadLibraryEx(filepath.Join(filepath.Dir(exe), dllName), 0,
		windows.LOAD_LIBRARY_SEARCH_APPLICATION_DIR|windows.LOAD_LIBRARY_SEARCH_SYSTEM32)
	if err != nil {
		return nil, fmt.Errorf("load %s: %w", dllName, err)
	}

	lib := &nativeLib{}
	var initProc uintptr
	for name, dst := range map[string]*uintptr{
		"s3b_init": &initProc, "s3b_call": &lib.callProc, "s3b_cancel": &lib.cancelProc, "s3b_free": &lib.freeProc,
	} {
		if *dst, err = windows.GetProcAddress(handle, name); err != nil {
			_ = windows.FreeLibrary(handle)
			return nil, fmt.Errorf("find %s: %w", name, err)
		}
	}
	if r, _, _ := syscall.SyscallN(initProc); int32(r) != 0 {
		_ = windows.FreeLibrary(handle)
		return nil, fmt.Errorf("s3b_init failed: %d", int32(r))
	}
	return lib, nil
}

// call chạy s3b_call và trả bản sao phản hồi; buffer của thư viện luôn được giải phóng trên mọi luồng xử lý.
func (l *nativeLib) call(req []byte) ([]byte, error) {
	if len(req) == 0 {
		return nil, errors.New("empty request")
	}
	var outPtr *byte
	var outLen uintptr
	r, _, _ := syscall.SyscallN(l.callProc,
		uintptr(unsafe.Pointer(&req[0])), uintptr(len(req)),
		uintptr(unsafe.Pointer(&outPtr)), uintptr(unsafe.Pointer(&outLen)))
	if outPtr != nil {
		defer func() { _, _, _ = syscall.SyscallN(l.freeProc, uintptr(unsafe.Pointer(outPtr)), outLen) }()
	}
	if int32(r) != 0 || outPtr == nil {
		return nil, fmt.Errorf("s3b_call failed: %d", int32(r))
	}
	return append([]byte(nil), unsafe.Slice(outPtr, outLen)...), nil
}

// cancel yêu cầu thư viện ngắt request id.
func (l *nativeLib) cancel(id uint64) {
	_, _, _ = syscall.SyscallN(l.cancelProc, uintptr(id))
}
