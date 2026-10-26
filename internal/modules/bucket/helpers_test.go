package bucket

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// fakeS3 is an in-memory s3Uploader. Every hook is optional; a nil hook succeeds.
type fakeS3 struct {
	mu sync.Mutex

	head     func(key string) error
	put      func(ctx context.Context, in *s3.PutObjectInput) error
	create   func() error
	part     func(ctx context.Context, n int32) error
	complete func() error
	abort    func() error

	putKeys   []string
	completed int
	aborted   int
}

func (f *fakeS3) PutObject(ctx context.Context, in *s3.PutObjectInput, _ ...func(*s3.Options),
) (*s3.PutObjectOutput, error) {
	f.mu.Lock()
	f.putKeys = append(f.putKeys, *in.Key)
	f.mu.Unlock()
	if f.put != nil {
		if err := f.put(ctx, in); err != nil {
			return nil, err
		}
	}
	// Read the body twice, like the SDK does for the checksum, to exercise Seek.
	_, _ = io.Copy(io.Discard, in.Body)
	_, _ = in.Body.(io.Seeker).Seek(0, io.SeekStart)
	_, _ = io.Copy(io.Discard, in.Body)
	return &s3.PutObjectOutput{}, nil
}

func (f *fakeS3) CreateMultipartUpload(_ context.Context, _ *s3.CreateMultipartUploadInput, _ ...func(*s3.Options),
) (*s3.CreateMultipartUploadOutput, error) {
	if f.create != nil {
		if err := f.create(); err != nil {
			return nil, err
		}
	}
	id := "upload-id"
	return &s3.CreateMultipartUploadOutput{UploadId: &id}, nil
}

func (f *fakeS3) UploadPart(ctx context.Context, in *s3.UploadPartInput, _ ...func(*s3.Options),
) (*s3.UploadPartOutput, error) {
	if f.part != nil {
		if err := f.part(ctx, *in.PartNumber); err != nil {
			return nil, err
		}
	}
	_, _ = io.Copy(io.Discard, in.Body)
	etag := "etag"
	return &s3.UploadPartOutput{ETag: &etag}, nil
}

func (f *fakeS3) CompleteMultipartUpload(
	_ context.Context, _ *s3.CompleteMultipartUploadInput, _ ...func(*s3.Options),
) (*s3.CompleteMultipartUploadOutput, error) {
	f.mu.Lock()
	f.completed++
	f.mu.Unlock()
	if f.complete != nil {
		if err := f.complete(); err != nil {
			return nil, err
		}
	}
	return &s3.CompleteMultipartUploadOutput{}, nil
}

func (f *fakeS3) AbortMultipartUpload(
	_ context.Context, _ *s3.AbortMultipartUploadInput, _ ...func(*s3.Options),
) (*s3.AbortMultipartUploadOutput, error) {
	f.mu.Lock()
	f.aborted++
	f.mu.Unlock()
	if f.abort != nil {
		if err := f.abort(); err != nil {
			return nil, err
		}
	}
	return &s3.AbortMultipartUploadOutput{}, nil
}

func (f *fakeS3) HeadObject(_ context.Context, in *s3.HeadObjectInput, _ ...func(*s3.Options),
) (*s3.HeadObjectOutput, error) {
	if f.head != nil {
		if err := f.head(*in.Key); err != nil {
			return nil, err
		}
	}
	return &s3.HeadObjectOutput{}, nil
}

// fakeHost records emitted events and gives a fixed context.
type fakeHost struct {
	ctx    context.Context
	mu     sync.Mutex
	events []emitted
}

type emitted struct {
	name string
	data any
}

func (h *fakeHost) Context() context.Context { return h.ctx }

func (h *fakeHost) Emit(name string, data ...any) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.events = append(h.events, emitted{name: name, data: data[0]})
}

func (h *fakeHost) named(name string) []emitted {
	h.mu.Lock()
	defer h.mu.Unlock()
	var out []emitted
	for _, e := range h.events {
		if e.name == name {
			out = append(out, e)
		}
	}
	return out
}

// newTestUploader returns an uploader whose only connection ID is "conn".
func newTestUploader(client s3Uploader) (*submoduleUploaderMng, *fakeHost) {
	host := &fakeHost{ctx: context.Background()}
	return &submoduleUploaderMng{
		logger: slog.New(slog.DiscardHandler),
		host:   host,
		getClient: func(id string) (s3Uploader, func(), bool) {
			return client, func() {}, id == "conn"
		},
	}, host
}

// writeFile creates dir/rel (with parents) holding size zero bytes.
func writeFile(t *testing.T, dir, rel string, size int64) string {
	t.Helper()
	p := filepath.Join(dir, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	f, err := os.Create(p)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.Truncate(size); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	return p
}

// walkDroppedForTest runs walkDropped and returns the skipped count.
func walkDroppedForTest(dir string) int {
	skipped, _ := walkDropped(dir, &dropCollector{index: map[string]int{}})
	return skipped
}

var errBoom = errors.New("boom")

// useLargeFileSize makes files over n bytes "large" for the test.
func useLargeFileSize(t *testing.T, n int64) {
	t.Helper()
	old := largeFileSize
	largeFileSize = n
	t.Cleanup(func() { largeFileSize = old })
}
