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

// dllName is the native library, shipped next to the exe.
const dllName = "s3b_db.dll"

// nativeLib calls the exports of s3b_db.dll without cgo.
type nativeLib struct {
	callProc   uintptr
	cancelProc uintptr
	freeProc   uintptr
}

// loadNative loads s3b_db.dll from the folder of the exe (absolute path, so no search path can substitute it)
// and runs s3b_init.
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

// call runs s3b_call and returns a copy of the response; the library buffer is freed on every path.
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

// cancel asks the library to interrupt request id.
func (l *nativeLib) cancel(id uint64) {
	_, _, _ = syscall.SyscallN(l.cancelProc, uintptr(id))
}
