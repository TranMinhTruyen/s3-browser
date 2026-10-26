package bucket

// Branch table (C1) for submodule_uploader_mng.go.
//
// newSubmoduleUploaderMng.getClient: found / not found   TestNewSubmoduleUploaderMng
// uploadObject
//   empty list                                           TestUploadObject_Empty
//   more than maxUploadFiles                             TestUploadObject_TooMany
//   invalid RelKey                                       TestUploadObject_BadKey
//   busy                                                 TestUploadObject_Busy
//   large file rule applied / not applied                TestUploadObject_LargeFile / _Success
//   connection missing                                   TestUploadObject_NoConn
//   key free / taken / taken inside the batch            TestUploadObject_Success
//   result success / canceled / error                    TestUploadObject_Success / _Canceled / _Error
// cleanUploadItems: ok / bad key                         TestUploadObject_Success / _BadKey
// limitToLargest: stat error, larger, not larger,
//   over limit / not over                                TestLimitToLargest
// renameKey: with folder / without                       TestRenameKey
// handleFilesDropped: nil context                        TestHandleFilesDropped_NilContext
// handleDrop: nil target / target                        TestHandleDrop
// dropFiles: no tab / with tab                           TestDropFiles
// uploadOne: ok / canceled / error                       TestUploadObject_*
//   stat ok / stat error (total 0)                       TestUploadObject_EventsSuccess / _EventsMissingFile
//   started -> progress -> finished order, status
//   success / error / canceled                           TestUploadObject_Events{Success,Error,Canceled}
//   started carries the renamed key                      TestUploadObject_EventsSuccess
// cancelUploadOne: known / unknown id                    TestCancelUploads
// cancelAllUploads                                       TestCancelUploads
// normalizePrefix: empty, no slash, with slash, "\"      TestNormalizePrefix
// existingKeys: 404 / other error / duplicate key        TestUploadObject_Success
//
// Not unit tested: appHost (thin wrapper over the Wails application).

import (
	"S3Browser/internal/modules/global"
	"S3Browser/models"
	"context"
	"log/slog"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/smithy-go"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func codes(out models.Output[any]) []string {
	var c []string
	for _, m := range out.MessageList {
		c = append(c, m.MessageCode)
	}
	return c
}

func hasCode(out models.Output[any], code string) bool {
	for _, c := range codes(out) {
		if c == code {
			return true
		}
	}
	return false
}

func notFound() error { return &smithy.GenericAPIError{Code: "NotFound"} }

func TestNewSubmoduleUploaderMng(t *testing.T) {
	g := global.NewModule()
	g.PutConnContainer("c1", &global.S3Conn{Client: &s3.Client{}})
	m := newSubmoduleUploaderMng(nil, slog.New(slog.DiscardHandler), g)

	if c, ok := m.getClient("c1"); !ok || c == nil {
		t.Fatal("c1 should be found")
	}
	if _, ok := m.getClient("other"); ok {
		t.Fatal("other should not be found")
	}
}

func TestUploadObject_Empty(t *testing.T) {
	m, _ := newTestUploader(&fakeS3{})
	out := m.uploadObject(models.UploadObjInput{ConnectionId: "conn"})
	if !out.Result || len(out.MessageList) != 0 {
		t.Fatalf("%+v", out)
	}
}

func TestUploadObject_TooMany(t *testing.T) {
	m, _ := newTestUploader(&fakeS3{})
	items := make([]models.UploadObj, maxUploadFiles+1)
	out := m.uploadObject(models.UploadObjInput{ConnectionId: "conn", ObjList: items})
	if out.Result || !hasCode(out, S3E018) {
		t.Fatalf("%+v", out)
	}
}

func TestUploadObject_BadKey(t *testing.T) {
	m, _ := newTestUploader(&fakeS3{})
	out := m.uploadObject(models.UploadObjInput{
		ConnectionId: "conn",
		ObjList:      []models.UploadObj{{Path: "a.txt", RelKey: "../a.txt"}},
	})
	if out.Result || !hasCode(out, S3E019) {
		t.Fatalf("%+v", out)
	}
}

func TestUploadObject_Busy(t *testing.T) {
	m, _ := newTestUploader(&fakeS3{})
	m.busy.Store(true)
	out := m.uploadObject(models.UploadObjInput{
		ConnectionId: "conn",
		ObjList:      []models.UploadObj{{Path: "a.txt"}},
	})
	if out.Result || !hasCode(out, S3W005) {
		t.Fatalf("%+v", out)
	}
}

func TestUploadObject_NoConn(t *testing.T) {
	m, _ := newTestUploader(&fakeS3{})
	out := m.uploadObject(models.UploadObjInput{
		ConnectionId: "missing",
		ObjList:      []models.UploadObj{{Path: "a.txt"}},
	})
	if out.Result || !hasCode(out, S3E006) {
		t.Fatalf("%+v", out)
	}
	if m.busy.Load() {
		t.Fatal("busy must be released")
	}
}

func TestUploadObject_Success(t *testing.T) {
	dir := t.TempDir()
	free := writeFile(t, dir, "free.txt", 4)
	taken := writeFile(t, dir, "taken.txt", 4)
	other := writeFile(t, dir, "other/other.txt", 4)
	dup := writeFile(t, dir, "dup/free.txt", 4)

	fake := &fakeS3{head: func(key string) error {
		switch key {
		case "up/taken.txt":
			return nil // exists
		case "up/folder/other.txt":
			return errBoom // can't tell: treated as existing
		}
		return notFound()
	}}
	m, _ := newTestUploader(fake)

	out := m.uploadObject(models.UploadObjInput{
		ConnectionId: "conn",
		Prefix:       `up`,
		ObjList: []models.UploadObj{
			{Path: free},
			{Path: taken},
			{Path: other, RelKey: "folder/other.txt"},
			{Path: dup, RelKey: "free.txt"}, // same key as the first item
		},
	})
	if !out.Result || len(out.MessageList) != 4 {
		t.Fatalf("%+v", out)
	}
	for _, c := range codes(out) {
		if c != S3S006 {
			t.Fatalf("codes=%v", codes(out))
		}
	}

	keys := map[string]bool{}
	for _, k := range fake.putKeys {
		keys[k] = true
	}
	if !keys["up/free.txt"] {
		t.Fatalf("free key missing: %v", fake.putKeys)
	}
	renamed := 0
	for k := range keys {
		switch {
		case strings.HasPrefix(k, "up/") && strings.HasSuffix(k, "_taken.txt"):
			renamed++
		case strings.HasPrefix(k, "up/folder/") && strings.HasSuffix(k, "_other.txt"):
			renamed++
		case strings.HasPrefix(k, "up/") && strings.HasSuffix(k, "_free.txt"):
			renamed++
		}
	}
	if renamed != 3 || len(keys) != 4 {
		t.Fatalf("keys=%v", fake.putKeys)
	}
	if m.busy.Load() {
		t.Fatal("busy must be released")
	}
}

func TestUploadObject_Error(t *testing.T) {
	p := writeFile(t, t.TempDir(), "a.txt", 4)
	fake := &fakeS3{
		head: func(string) error { return notFound() },
		put:  func(context.Context, *s3.PutObjectInput) error { return errBoom },
	}
	m, _ := newTestUploader(fake)
	out := m.uploadObject(models.UploadObjInput{ConnectionId: "conn", ObjList: []models.UploadObj{{Path: p}}})
	if !out.Result || !hasCode(out, S3E017) || out.MessageList[0].ErrorDetail != "boom" {
		t.Fatalf("%+v", out)
	}
}

func TestUploadObject_Canceled(t *testing.T) {
	p := writeFile(t, t.TempDir(), "a.txt", 4)
	started := make(chan struct{})
	fake := &fakeS3{
		head: func(string) error { return notFound() },
		put: func(ctx context.Context, _ *s3.PutObjectInput) error {
			close(started)
			<-ctx.Done()
			return ctx.Err()
		},
	}
	m, _ := newTestUploader(fake)

	done := make(chan models.Output[any])
	go func() {
		done <- m.uploadObject(models.UploadObjInput{ConnectionId: "conn", ObjList: []models.UploadObj{{Path: p}}})
	}()

	<-started
	m.cancelAllUploads()
	select {
	case out := <-done:
		if !hasCode(out, S3W004) {
			t.Fatalf("%+v", out)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("upload was not canceled")
	}
}

// lifecycle returns the started/progress/finished event names of one upload, in emit order.
func lifecycle(host *fakeHost, id string) []string {
	host.mu.Lock()
	defer host.mu.Unlock()
	var seq []string
	for _, e := range host.events {
		switch d := e.data.(type) {
		case models.UploadStartedOutput:
			if d.UploadId == id {
				seq = append(seq, e.name)
			}
		case models.UploadProgressOutput:
			if d.UploadId == id {
				seq = append(seq, e.name)
			}
		case models.UploadFinishedOutput:
			if d.UploadId == id {
				seq = append(seq, e.name)
			}
		}
	}
	return seq
}

// checkLifecycle asserts one upload emitted started, then progress (once or more), then
// finished with the wanted status, and returns the started payload. A file that fails to
// open emits no progress, so progress is optional here (the success test requires it).
func checkLifecycle(t *testing.T, host *fakeHost, want models.UploadStatus) models.UploadStartedOutput {
	t.Helper()
	started := host.named(EventUploadObjectStarted)
	finished := host.named(EventUploadObjectFinished)
	if len(started) != 1 || len(finished) != 1 {
		t.Fatalf("started=%d finished=%d", len(started), len(finished))
	}
	s := started[0].data.(models.UploadStartedOutput)
	f := finished[0].data.(models.UploadFinishedOutput)
	if f.UploadId != s.UploadId || f.Status != want {
		t.Fatalf("started=%+v finished=%+v want status %s", s, f, want)
	}
	seq := lifecycle(host, s.UploadId)
	if len(seq) < 2 || seq[0] != EventUploadObjectStarted || seq[len(seq)-1] != EventUploadObjectFinished {
		t.Fatalf("order=%v", seq)
	}
	for _, name := range seq[1 : len(seq)-1] {
		if name != EventUploadObjectProgress {
			t.Fatalf("order=%v", seq)
		}
	}
	return s
}

func TestUploadObject_EventsSuccess(t *testing.T) {
	p := writeFile(t, t.TempDir(), "a.txt", 7)
	fake := &fakeS3{head: func(key string) error {
		if key == "up/a.txt" {
			return nil // taken: the started event must carry the renamed key
		}
		return notFound()
	}}
	m, host := newTestUploader(fake)
	m.uploadObject(models.UploadObjInput{
		ConnectionId: "conn", Bucket: "bkt", Prefix: "up",
		ObjList: []models.UploadObj{{Path: p}},
	})

	s := checkLifecycle(t, host, models.UploadStatusSuccess)
	if len(lifecycle(host, s.UploadId)) < 3 {
		t.Fatal("progress event expected between started and finished")
	}
	if s.FileName != "a.txt" || s.Bucket != "bkt" || s.Total != 7 ||
		s.Key != fake.putKeys[0] || s.Key == "up/a.txt" || !strings.HasSuffix(s.Key, "_a.txt") {
		t.Fatalf("%+v putKeys=%v", s, fake.putKeys)
	}
}

func TestUploadObject_EventsError(t *testing.T) {
	p := writeFile(t, t.TempDir(), "a.txt", 4)
	fake := &fakeS3{
		head: func(string) error { return notFound() },
		put:  func(context.Context, *s3.PutObjectInput) error { return errBoom },
	}
	m, host := newTestUploader(fake)
	m.uploadObject(models.UploadObjInput{ConnectionId: "conn", ObjList: []models.UploadObj{{Path: p}}})
	checkLifecycle(t, host, models.UploadStatusError)
}

func TestUploadObject_EventsMissingFile(t *testing.T) {
	// A file that can't be stat'ed: started has total 0, and the upload ends with an error.
	m, host := newTestUploader(&fakeS3{head: func(string) error { return notFound() }})
	m.uploadObject(models.UploadObjInput{
		ConnectionId: "conn",
		ObjList:      []models.UploadObj{{Path: t.TempDir() + "/missing.txt"}},
	})
	if s := checkLifecycle(t, host, models.UploadStatusError); s.Total != 0 || s.FileName != "missing.txt" {
		t.Fatalf("%+v", s)
	}
}

func TestUploadObject_EventsCanceled(t *testing.T) {
	p := writeFile(t, t.TempDir(), "a.txt", 4)
	started := make(chan struct{})
	fake := &fakeS3{
		head: func(string) error { return notFound() },
		put: func(ctx context.Context, _ *s3.PutObjectInput) error {
			close(started)
			<-ctx.Done()
			return errBoom // not context.Canceled: the status must still be canceled
		},
	}
	m, host := newTestUploader(fake)

	done := make(chan struct{})
	go func() {
		m.uploadObject(models.UploadObjInput{ConnectionId: "conn", ObjList: []models.UploadObj{{Path: p}}})
		close(done)
	}()
	<-started
	m.cancelAllUploads()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("upload was not canceled")
	}
	checkLifecycle(t, host, models.UploadStatusCanceled)
}

func TestUploadObject_LargeFile(t *testing.T) {
	dir := t.TempDir()
	small := writeFile(t, dir, "small.txt", 4)
	large := writeFile(t, dir, "large.bin", largeFileSize+1)
	// The large file fails fast, so no 5 GiB is read.
	fake := &fakeS3{
		head:   func(string) error { return notFound() },
		create: func() error { return errBoom },
	}
	m, _ := newTestUploader(fake)

	out := m.uploadObject(models.UploadObjInput{
		ConnectionId: "conn",
		ObjList:      []models.UploadObj{{Path: small}, {Path: large}},
	})
	got := codes(out)
	if !out.Result || len(got) != 2 || got[0] != S3W007 || got[1] != S3E017 {
		t.Fatalf("codes=%v", got)
	}
	if len(fake.putKeys) != 0 {
		t.Fatalf("the small file must not be uploaded: %v", fake.putKeys)
	}
}

func TestUploadObject_LargeFileAlone(t *testing.T) {
	large := writeFile(t, t.TempDir(), "large.bin", largeFileSize+1)
	fake := &fakeS3{
		head:   func(string) error { return notFound() },
		create: func() error { return errBoom },
	}
	m, _ := newTestUploader(fake)

	out := m.uploadObject(models.UploadObjInput{
		ConnectionId: "conn",
		ObjList:      []models.UploadObj{{Path: large}},
	})
	if got := codes(out); hasCode(out, S3W007) || len(got) != 1 || got[0] != S3E017 {
		t.Fatalf("codes=%v", got)
	}
}

func TestLimitToLargest(t *testing.T) {
	dir := t.TempDir()
	small := models.UploadObj{Path: writeFile(t, dir, "small", 1)}
	bigger := models.UploadObj{Path: writeFile(t, dir, "bigger", 9)}
	missing := models.UploadObj{Path: dir + "/missing"}
	large := models.UploadObj{Path: writeFile(t, dir, "large", largeFileSize+1)}

	// Nothing over the limit: not limited (also covers a stat error and a smaller later item).
	if _, limited := limitToLargest([]models.UploadObj{missing, bigger, small}); limited {
		t.Fatal("should not be limited")
	}
	// A large file among smaller ones: it is the one kept.
	got, limited := limitToLargest([]models.UploadObj{small, large, bigger})
	if !limited || got.Path != large.Path {
		t.Fatalf("got %+v limited=%v", got, limited)
	}
}

func TestRenameKey(t *testing.T) {
	if got := renameKey("a/b/c.txt", "id"); got != "a/b/id_c.txt" {
		t.Fatal(got)
	}
	if got := renameKey("c.txt", "id"); got != "id_c.txt" {
		t.Fatal(got)
	}
}

func TestNormalizePrefix(t *testing.T) {
	tests := map[string]string{
		"":        "",
		"/":       "",
		"a":       "a/",
		"a/":      "a/",
		`\a\b`:    "a/b/",
		"/a/b/c/": "a/b/c/",
	}
	for in, want := range tests {
		if got := normalizePrefix(in); got != want {
			t.Errorf("normalizePrefix(%q)=%q want %q", in, got, want)
		}
	}
}

type fakeDrop struct {
	target *application.DropTargetDetails
	files  []string
}

func (d fakeDrop) DropTargetDetails() *application.DropTargetDetails { return d.target }
func (d fakeDrop) DroppedFiles() []string                            { return d.files }

func TestHandleFilesDropped_NilContext(t *testing.T) {
	m, host := newTestUploader(&fakeS3{})
	m.handleFilesDropped(application.NewWindowEvent())
	if len(host.events) != 0 {
		t.Fatal("no event expected")
	}
}

func TestHandleDrop(t *testing.T) {
	m, host := newTestUploader(&fakeS3{})
	p := writeFile(t, t.TempDir(), "a.txt", 2)

	m.handleDrop(fakeDrop{files: []string{p}}) // dropped outside any target
	if len(host.events) != 0 {
		t.Fatal("no event expected")
	}

	target := &application.DropTargetDetails{Attributes: map[string]string{"data-tab-id": "tab1"}}
	m.handleDrop(fakeDrop{target: target, files: []string{p}})
	if len(host.named(EventFilesDropped)) != 1 {
		t.Fatal("one event expected")
	}
}

func TestDropFiles(t *testing.T) {
	m, host := newTestUploader(&fakeS3{})
	dir := t.TempDir()

	for _, n := range []string{"1", "2", "3", "4", "5", "6"} {
		writeFile(t, dir, "d/"+n, 1)
	}

	m.dropFiles("", []string{dir}) // dropped outside a tab
	if len(host.events) != 0 {
		t.Fatal("no event expected")
	}

	m.dropFiles("tab1", []string{dir + "/d"})
	evs := host.named(EventFilesDropped)
	if len(evs) != 1 {
		t.Fatalf("events=%d", len(evs))
	}
	out := evs[0].data.(models.FilesDroppedOutput)
	if out.TabId != "tab1" || len(out.Files) != maxUploadFiles || !out.Truncated ||
		out.MaxFiles != maxUploadFiles || out.LargeFileSize != largeFileSize {
		t.Fatalf("%+v", out)
	}
	if !strings.HasPrefix(out.Files[0].RelKey, "d/") {
		t.Fatalf("relKey=%s", out.Files[0].RelKey)
	}
}

func TestCancelUploads(t *testing.T) {
	m, _ := newTestUploader(&fakeS3{})
	var canceled atomic.Int32
	m.jobs.Store("a", uploaderJob{cancel: func() { canceled.Add(1) }})
	m.jobs.Store("b", uploaderJob{cancel: func() { canceled.Add(1) }})

	m.cancelUploadOne("unknown")
	if canceled.Load() != 0 {
		t.Fatal("unknown id must be ignored")
	}
	m.cancelUploadOne("a")
	if canceled.Load() != 1 {
		t.Fatal("a should be canceled")
	}
	m.cancelAllUploads()
	if canceled.Load() != 2 {
		t.Fatalf("canceled=%d", canceled.Load())
	}
}
