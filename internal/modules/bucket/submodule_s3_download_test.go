package bucket

// Branch table for submodule_s3_download.go.
//
// download
//   progress == nil -> no-op / progress given     TestDownload_Success / _Progress
//   os.Create error                               TestDownload_CreateError
//   GetObject error: no .part left                TestDownload_GetObjectError
//   PreconditionFailed -> "object has changed"    TestDownload_PreconditionFailed
//   ctx canceled: no file left                    TestDownload_Canceled
//   os.Rename error: .part removed                TestDownload_RenameError
//   f.Close error                                 not unit tested (needs a failing disk)
//   success: file written, .part gone             TestDownload_Success
// countingWriterAt.WriteAt                        TestDownload_Success / TestCountingWriterAt
// onTransferStart.OnObjectTransferStart           TestDownload_Progress

import (
	"S3Browser/internal/modules/global"
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"sync/atomic"
	"testing"

	"github.com/aws/aws-sdk-go-v2/feature/s3/transfermanager"
)

const downloadBody = "hello download"

// serveObject answers every GET with downloadBody as a single, unchunked object.
func serveObject(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("ETag", `"etag-1"`)
	w.Header().Set("Content-Length", strconv.Itoa(len(downloadBody)))
	_, _ = w.Write([]byte(downloadBody))
}

// newTestTM returns a transfer manager that talks to the fake S3 server h.
func newTestTM(t *testing.T, h http.HandlerFunc) (*transfermanager.Client, *global.S3Conn) {
	t.Helper()
	conn := newTestS3Conn(newS3Server(t, h).URL)
	return transfermanager.New(conn.Client), conn
}

func TestDownload_Success(t *testing.T) {
	tm, _ := newTestTM(t, serveObject)
	dest := filepath.Join(t.TempDir(), "out.txt")

	size, err := download(context.Background(), tm, "b", "k", dest, nil)
	if err != nil || size != int64(len(downloadBody)) {
		t.Fatalf("size=%d err=%v", size, err)
	}
	if got, _ := os.ReadFile(dest); string(got) != downloadBody {
		t.Fatalf("content: %q", got)
	}
	if pathExists(dest + ".part") {
		t.Fatal(".part must be renamed")
	}
}

func TestDownload_Progress(t *testing.T) {
	tm, _ := newTestTM(t, serveObject)
	var done, total atomic.Int64
	_, err := download(context.Background(), tm, "b", "k", filepath.Join(t.TempDir(), "out.txt"),
		func(d, tot int64) { done.Store(d); total.Store(tot) })
	// stop() always reports once more, so the final value is known without waiting for the ticker.
	if err != nil || done.Load() != int64(len(downloadBody)) || total.Load() != int64(len(downloadBody)) {
		t.Fatalf("err=%v done=%d total=%d", err, done.Load(), total.Load())
	}
}

func TestDownload_CreateError(t *testing.T) {
	tm, _ := newTestTM(t, serveObject)
	dest := filepath.Join(t.TempDir(), "missing-dir", "out.txt")
	if _, err := download(context.Background(), tm, "b", "k", dest, nil); err == nil {
		t.Fatal("want error")
	}
}

func TestDownload_GetObjectError(t *testing.T) {
	tm, _ := newTestTM(t, func(w http.ResponseWriter, _ *http.Request) {
		writeS3Error(w, http.StatusNotFound, "NoSuchKey")
	})
	dest := filepath.Join(t.TempDir(), "out.txt")

	_, err := download(context.Background(), tm, "b", "k", dest, nil)
	if err == nil || UnwrapAwsError(err) != "NoSuchKey" {
		t.Fatalf("err=%v", err)
	}
	if pathExists(dest) || pathExists(dest+".part") {
		t.Fatal("no file may be left")
	}
}

func TestDownload_PreconditionFailed(t *testing.T) {
	// Part 1 says the object has 2 parts; part 2 (sent with If-Match) fails.
	tm, _ := newTestTM(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("partNumber") != "1" {
			writeS3Error(w, http.StatusPreconditionFailed, "PreconditionFailed")
			return
		}
		w.Header().Set("ETag", `"etag-1"`)
		w.Header().Set("x-amz-mp-parts-count", "2")
		w.Header().Set("Content-Range", "bytes 0-4/10")
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write([]byte("12345"))
	})
	dest := filepath.Join(t.TempDir(), "out.txt")

	_, err := download(context.Background(), tm, "b", "k", dest, nil)
	if err == nil || err.Error() != "object has changed on server during download" {
		t.Fatalf("err=%v", err)
	}
	if pathExists(dest) || pathExists(dest+".part") {
		t.Fatal("no file may be left")
	}
}

func TestDownload_Canceled(t *testing.T) {
	tm, _ := newTestTM(t, serveObject)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	dest := filepath.Join(t.TempDir(), "out.txt")

	if _, err := download(ctx, tm, "b", "k", dest, nil); !errors.Is(err, context.Canceled) {
		t.Fatalf("err=%v", err)
	}
	if pathExists(dest) || pathExists(dest+".part") {
		t.Fatal("no file may be left")
	}
}

func TestDownload_RenameError(t *testing.T) {
	tm, _ := newTestTM(t, serveObject)
	dest := t.TempDir() // a directory: the .part file can't replace it

	if _, err := download(context.Background(), tm, "b", "k", dest, nil); err == nil {
		t.Fatal("want error")
	}
	if pathExists(dest + ".part") {
		t.Fatal(".part must be removed")
	}
}

func TestCountingWriterAt(t *testing.T) {
	f, err := os.Create(filepath.Join(t.TempDir(), "f"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = f.Close() }()
	w := &countingWriterAt{w: f}
	if n, err := w.WriteAt([]byte("abc"), 2); n != 3 || err != nil || w.n.Load() != 3 {
		t.Fatalf("n=%d err=%v counted=%d", n, err, w.n.Load())
	}
}
