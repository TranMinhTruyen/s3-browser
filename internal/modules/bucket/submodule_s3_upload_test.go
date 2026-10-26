package bucket

// Branch table (C1) for submodule_s3_upload.go.
//
// uploadFile
//   progress == nil -> no-op / progress given     TestUploadFile_Small (nil) / _Progress
//   os.Open error                                 TestUploadFile_OpenError
//   stat error                                    TestUploadFile_StatError
//   not a regular file                            TestUploadFile_NotRegular
//   size < minUploadPartSize (single) / multipart TestUploadFile_Small / TestUploadFile_Multipart
//   upload error / success                        TestUploadFile_PutError / _Small
// putSingle (returns the PutObject error)         TestUploadFile_PutError
// putMultipart
//   CreateMultipartUpload error                   TestUploadFile_CreateError
//   part error (abort ok)                         TestUploadFile_PartError
//   abort error joined                            TestUploadFile_AbortError
//   ctx canceled: loop break + ctx.Err()          TestUploadFile_CanceledBeforeParts
//   Complete error                                TestUploadFile_CompleteError
//   success                                       TestUploadFile_Multipart
// uploadPartSize: small / huge file               TestUploadPartSize
// progressReader.Read                             TestProgressReader
// progressReader.Seek: error / ok                 TestProgressReader
// nonEmpty: "" / value                            TestNonEmpty

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/aws/aws-sdk-go-v2/service/s3"
)

func TestUploadFile_Small(t *testing.T) {
	dir := t.TempDir()
	p := writeFile(t, dir, "a.txt", 10)
	fake := &fakeS3{}

	size, err := uploadFile(context.Background(), fake, "b", "k", p, nil)
	if err != nil || size != 10 {
		t.Fatalf("size=%d err=%v", size, err)
	}
	if len(fake.putKeys) != 1 || fake.putKeys[0] != "k" {
		t.Fatalf("putKeys=%v", fake.putKeys)
	}
}

func TestUploadFile_Progress(t *testing.T) {
	p := writeFile(t, t.TempDir(), "a.bin", 10)
	var last atomic.Int64
	// The final call from stop() reports the whole file.
	_, err := uploadFile(context.Background(), &fakeS3{}, "b", "k", p, func(done, total int64) {
		last.Store(done)
		if total != 10 {
			t.Errorf("total=%d", total)
		}
	})
	if err != nil || last.Load() != 10 {
		t.Fatalf("err=%v last=%d", err, last.Load())
	}
}

func TestUploadFile_OpenError(t *testing.T) {
	_, err := uploadFile(context.Background(), &fakeS3{}, "b", "k", filepath.Join(t.TempDir(), "nope"), nil)
	if err == nil {
		t.Fatal("want error")
	}
}

func TestUploadFile_StatError(t *testing.T) {
	p := writeFile(t, t.TempDir(), "a.txt", 1)
	old := statFile
	statFile = func(f *os.File) (os.FileInfo, error) { return nil, errBoom }
	t.Cleanup(func() { statFile = old })

	if _, err := uploadFile(context.Background(), &fakeS3{}, "b", "k", p, nil); !errors.Is(err, errBoom) {
		t.Fatalf("err=%v", err)
	}
}

func TestUploadFile_NotRegular(t *testing.T) {
	_, err := uploadFile(context.Background(), &fakeS3{}, "b", "k", t.TempDir(), nil)
	if err == nil || !strings.Contains(err.Error(), "not a regular file") {
		t.Fatalf("err=%v", err)
	}
}

func TestUploadFile_PutError(t *testing.T) {
	p := writeFile(t, t.TempDir(), "a.txt", 1)
	fake := &fakeS3{put: func(context.Context, *s3.PutObjectInput) error { return errBoom }}
	if _, err := uploadFile(context.Background(), fake, "b", "k", p, nil); !errors.Is(err, errBoom) {
		t.Fatalf("err=%v", err)
	}
}

// bigSize needs two parts (8 MiB each).
const bigSize = minUploadPartSize + 1<<20

func TestUploadFile_Multipart(t *testing.T) {
	p := writeFile(t, t.TempDir(), "big.bin", bigSize)
	fake := &fakeS3{}
	size, err := uploadFile(context.Background(), fake, "b", "k", p, nil)
	if err != nil || size != bigSize || fake.completed != 1 || fake.aborted != 0 {
		t.Fatalf("size=%d err=%v completed=%d aborted=%d", size, err, fake.completed, fake.aborted)
	}
}

func TestUploadFile_CreateError(t *testing.T) {
	p := writeFile(t, t.TempDir(), "big.bin", bigSize)
	fake := &fakeS3{create: func() error { return errBoom }}
	if _, err := uploadFile(context.Background(), fake, "b", "k", p, nil); !errors.Is(err, errBoom) {
		t.Fatalf("err=%v", err)
	}
	if fake.aborted != 0 {
		t.Fatal("nothing to abort when create failed")
	}
}

func TestUploadFile_PartError(t *testing.T) {
	p := writeFile(t, t.TempDir(), "big.bin", bigSize)
	fake := &fakeS3{part: func(_ context.Context, n int32) error {
		if n == 2 {
			return errBoom
		}
		return nil
	}}
	_, err := uploadFile(context.Background(), fake, "b", "k", p, nil)
	if !errors.Is(err, errBoom) || fake.aborted != 1 || fake.completed != 0 {
		t.Fatalf("err=%v aborted=%d completed=%d", err, fake.aborted, fake.completed)
	}
}

func TestUploadFile_AbortError(t *testing.T) {
	p := writeFile(t, t.TempDir(), "big.bin", bigSize)
	errAbort := errors.New("abort failed")
	fake := &fakeS3{
		complete: func() error { return errBoom },
		abort:    func() error { return errAbort },
	}
	_, err := uploadFile(context.Background(), fake, "b", "k", p, nil)
	if !errors.Is(err, errBoom) || !errors.Is(err, errAbort) {
		t.Fatalf("err=%v", err)
	}
}

func TestUploadFile_CompleteError(t *testing.T) {
	p := writeFile(t, t.TempDir(), "big.bin", bigSize)
	fake := &fakeS3{complete: func() error { return errBoom }}
	_, err := uploadFile(context.Background(), fake, "b", "k", p, nil)
	if !errors.Is(err, errBoom) || fake.aborted != 1 {
		t.Fatalf("err=%v aborted=%d", err, fake.aborted)
	}
}

func TestUploadFile_CanceledBeforeParts(t *testing.T) {
	p := writeFile(t, t.TempDir(), "big.bin", bigSize)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	fake := &fakeS3{}
	_, err := uploadFile(ctx, fake, "b", "k", p, nil)
	if !errors.Is(err, context.Canceled) || fake.aborted != 1 {
		t.Fatalf("err=%v aborted=%d", err, fake.aborted)
	}
}

func TestUploadPartSize(t *testing.T) {
	if got := uploadPartSize(100); got != minUploadPartSize {
		t.Fatalf("small: %d", got)
	}
	// 100 GiB / 10000 parts is about 10.24 MiB, rounded up to a whole MiB.
	if got := uploadPartSize(100 << 30); got != 11<<20 {
		t.Fatalf("huge: %d", got)
	}
}

func TestProgressReader(t *testing.T) {
	var sent atomic.Int64
	pr := &progressReader{r: strings.NewReader("hello world"), sent: &sent}
	buf := make([]byte, 5)
	if n, _ := pr.Read(buf); n != 5 || sent.Load() != 5 {
		t.Fatalf("n=%d sent=%d", n, sent.Load())
	}
	// Seeking back takes the bytes off again.
	if _, err := pr.Seek(0, io.SeekStart); err != nil || sent.Load() != 0 {
		t.Fatalf("err=%v sent=%d", err, sent.Load())
	}
	// A failing Seek leaves sent unchanged.
	if _, err := pr.Seek(-1, io.SeekStart); err == nil || sent.Load() != 0 {
		t.Fatalf("err=%v sent=%d", err, sent.Load())
	}
}

func TestNonEmpty(t *testing.T) {
	if nonEmpty("") != nil {
		t.Fatal("empty should be nil")
	}
	if p := nonEmpty("x"); p == nil || *p != "x" {
		t.Fatal("value should be kept")
	}
}
