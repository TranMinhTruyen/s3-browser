package bucket

// Branch table (C1) for submodule_uploader_mng.go.
//
// newSubmoduleUploaderMng.getClient: found / not found   TestNewSubmoduleUploaderMng
// uploadObject
//   empty list                                           TestUploadObject_Empty
//   more than maxTotalFiles                              TestUploadObject_TooMany
//   group over maxFilesPerFolder (and exactly 50 ok)     TestUploadObject_GroupTooBig
//   group over largeFileMaxCount (and exactly 4 ok)      TestUploadObject_TooManyLarge
//   invalid RelKey                                       TestUploadObject_BadKey
//   busy                                                 TestUploadObject_Busy
//   groups share one concurrency limit                   TestUploadObject_SharedLimit
//   canceled while waiting for a slot                    TestUploadObject_CanceledWaiting
//   connection missing                                   TestUploadObject_NoConn
//   key free / taken / taken inside the batch            TestUploadObject_Success
//   result success / canceled / error                    TestUploadObject_Success / _Canceled / _Error
// cleanUploadItems: ok / bad key                         TestUploadObject_Success / _BadKey
// groupUploadItems: root group, nested groups, order       TestGroupUploadItems
// renameKey: with folder / without                       TestRenameKey
// handleFilesDropped: nil context                        TestHandleFilesDropped_NilContext
// handleDrop: nil target / target                        TestHandleDrop
// dropFiles: no tab / with tab                           TestDropFiles
// uploadOne: ok / canceled / error                       TestUploadObject_*
//   canceled before start (no upload)                    TestUploadObject_CanceledDuringKeyCheck
//   stat ok / stat error (total 0)                       TestUploadObject_EventsSuccess / _EventsMissingFile
//   started -> progress -> finished order, status
//   success / error / canceled                           TestUploadObject_Events{Success,Error,Canceled}
//   started carries the renamed key                      TestUploadObject_EventsSuccess
// cancelUploadOne: known / unknown id                    TestCancelUploads
// cancelAllUploads: jobs / running batch (key check)      TestCancelUploads / TestUploadObject_CanceledDuringKeyCheck
// normalizePrefix: empty, no slash, with slash, "\"      TestNormalizePrefix
// existingKeys: 404 / other error / duplicate key        TestUploadObject_Success
//
// Not unit tested: appHost (thin wrapper over the Wails application).

import (
	"S3Browser/internal/modules/global"
	"S3Browser/models"
	"context"
	"fmt"
	"log/slog"
	"reflect"
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

	c, release, ok := m.getClient("c1")
	if !ok || c == nil {
		t.Fatal("c1 should be found")
	}
	if _, _, busy := g.RemoveConnIfIdle("c1"); !busy {
		t.Fatal("c1 should be busy while acquired")
	}
	release()
	if _, removed, busy := g.RemoveConnIfIdle("c1"); busy || !removed {
		t.Fatal("c1 should be removable after release")
	}
	if _, _, ok := m.getClient("other"); ok {
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
	// 21 groups of 50 files: no group is over its limit, only the total is.
	items := make([]models.UploadObj, maxTotalFiles+1)
	for i := range items {
		items[i] = models.UploadObj{Path: "x", RelKey: fmt.Sprintf("d%d/%d", i/maxFilesPerFolder, i)}
	}
	out := m.uploadObject(models.UploadObjInput{ConnectionId: "conn", ObjList: items})
	if out.Result || !hasCode(out, S3E023) {
		t.Fatalf("%+v", out)
	}
}

func TestUploadObject_GroupTooBig(t *testing.T) {
	m, _ := newTestUploader(&fakeS3{head: func(string) error { return notFound() }})
	make50 := func(n int) []models.UploadObj {
		items := make([]models.UploadObj, n)
		for i := range items {
			items[i] = models.UploadObj{Path: "missing", RelKey: fmt.Sprintf("d/%d", i)}
		}
		return items
	}

	out := m.uploadObject(models.UploadObjInput{ConnectionId: "conn", ObjList: make50(maxFilesPerFolder + 1)})
	if out.Result || !hasCode(out, S3E018) || out.MessageList[0].Params["folder"] != "d" {
		t.Fatalf("%+v", out)
	}
	if m.busy.Load() {
		t.Fatal("busy must not be taken")
	}

	// Exactly maxFilesPerFolder is accepted (the files are missing, so each reports an error).
	out = m.uploadObject(models.UploadObjInput{ConnectionId: "conn", ObjList: make50(maxFilesPerFolder)})
	if !out.Result || hasCode(out, S3E018) || len(out.MessageList) != maxFilesPerFolder {
		t.Fatalf("%+v", out)
	}
}

func TestUploadObject_TooManyLarge(t *testing.T) {
	useLargeFileSize(t, 100)
	dir := t.TempDir()
	fake := &fakeS3{
		head:   func(string) error { return notFound() },
		create: func() error { return errBoom }, // the large files fail fast
	}
	m, _ := newTestUploader(fake)
	items := func(n int) []models.UploadObj {
		list := make([]models.UploadObj, n)
		for i := range list {
			list[i] = models.UploadObj{
				Path:   writeFile(t, dir, fmt.Sprintf("f%d.bin", i), largeFileSize+1),
				RelKey: fmt.Sprintf("d/f%d.bin", i),
			}
		}
		return list
	}

	out := m.uploadObject(models.UploadObjInput{ConnectionId: "conn", ObjList: items(largeFileMaxCount + 1)})
	if out.Result || !hasCode(out, S3E022) {
		t.Fatalf("%+v", out)
	}

	// Exactly largeFileMaxCount large files in a group is accepted.
	out = m.uploadObject(models.UploadObjInput{ConnectionId: "conn", ObjList: items(largeFileMaxCount)})
	if !out.Result || hasCode(out, S3E022) || len(out.MessageList) != largeFileMaxCount {
		t.Fatalf("%+v", out)
	}

	// The same number of large files split over two groups is accepted too.
	list := items(largeFileMaxCount + 1)
	list[0].RelKey = "other/f0.bin"
	out = m.uploadObject(models.UploadObjInput{ConnectionId: "conn", ObjList: list})
	if !out.Result || hasCode(out, S3E022) {
		t.Fatalf("%+v", out)
	}
}

func TestGroupUploadItems(t *testing.T) {
	items := []models.UploadObj{
		{RelKey: "a.txt"}, {RelKey: "d/x"}, {RelKey: "d/e/y"}, {RelKey: "b.txt"}, {RelKey: "d/z"},
	}
	groups, violation := groupUploadItems(items)
	want := [][]int{{0, 3}, {1, 4}, {2}}
	if violation != nil || !reflect.DeepEqual(groups, want) {
		t.Fatalf("groups=%v violation=%v", groups, violation)
	}
}

// trackPut returns a put hook that records the most concurrent calls and holds each call
// until release is closed (or the context ends).
func trackPut(running, peak *atomic.Int32, release <-chan struct{}) func(context.Context, *s3.PutObjectInput) error {
	return func(ctx context.Context, _ *s3.PutObjectInput) error {
		n := running.Add(1)
		defer running.Add(-1)
		for {
			p := peak.Load()
			if n <= p || peak.CompareAndSwap(p, n) {
				break
			}
		}
		select {
		case <-release:
		case <-ctx.Done():
			return ctx.Err()
		}
		return nil
	}
}

func TestUploadObject_SharedLimit(t *testing.T) {
	dir := t.TempDir()
	var running, peak atomic.Int32
	release := make(chan struct{})
	fake := &fakeS3{head: func(string) error { return notFound() }, put: trackPut(&running, &peak, release)}
	m, _ := newTestUploader(fake)

	// 4 groups of 5 files: 20 files, but only uploadFileConcurrency may run at once.
	var list []models.UploadObj
	for g := range 4 {
		for i := range 5 {
			rel := fmt.Sprintf("g%d/f%d.txt", g, i)
			list = append(list, models.UploadObj{Path: writeFile(t, dir, rel, 2), RelKey: rel})
		}
	}

	done := make(chan models.Output[any])
	go func() { done <- m.uploadObject(models.UploadObjInput{ConnectionId: "conn", ObjList: list}) }()

	// Wait until the limit is reached, give extra goroutines a chance to wrongly start.
	deadline := time.After(5 * time.Second)
	for running.Load() < uploadFileConcurrency {
		select {
		case <-deadline:
			t.Fatalf("running=%d", running.Load())
		case <-time.After(time.Millisecond):
		}
	}
	time.Sleep(50 * time.Millisecond)
	close(release)

	select {
	case out := <-done:
		if !out.Result || len(out.MessageList) != 20 || hasCode(out, S3E017) {
			t.Fatalf("%+v", codes(out))
		}
	case <-time.After(5 * time.Second):
		t.Fatal("upload did not finish")
	}
	if peak.Load() != uploadFileConcurrency || len(fake.putKeys) != 20 {
		t.Fatalf("peak=%d puts=%d", peak.Load(), len(fake.putKeys))
	}
	if m.busy.Load() {
		t.Fatal("busy must be released")
	}
}

func TestUploadObject_CanceledWaiting(t *testing.T) {
	dir := t.TempDir()
	var running, peak atomic.Int32
	fake := &fakeS3{head: func(string) error { return notFound() }, put: trackPut(&running, &peak, nil)}
	m, _ := newTestUploader(fake)

	var list []models.UploadObj
	for i := range uploadFileConcurrency + 3 {
		rel := fmt.Sprintf("g%d/f.txt", i%2)
		rel = fmt.Sprintf("%s%d", rel, i)
		list = append(list, models.UploadObj{Path: writeFile(t, dir, rel, 2), RelKey: rel})
	}

	done := make(chan models.Output[any])
	go func() { done <- m.uploadObject(models.UploadObjInput{ConnectionId: "conn", ObjList: list}) }()

	deadline := time.After(5 * time.Second)
	for running.Load() < uploadFileConcurrency {
		select {
		case <-deadline:
			t.Fatalf("running=%d", running.Load())
		case <-time.After(time.Millisecond):
		}
	}
	// The remaining 3 files wait for a slot; canceling must release them without a leak.
	m.cancelAllUploads()
	select {
	case out := <-done:
		if len(out.MessageList) != len(list) {
			t.Fatalf("messages=%d", len(out.MessageList))
		}
		for _, c := range codes(out) {
			if c != S3W004 {
				t.Fatalf("codes=%v", codes(out))
			}
		}
	case <-time.After(5 * time.Second):
		t.Fatal("upload was not canceled")
	}
	if len(fake.putKeys) != uploadFileConcurrency {
		t.Fatalf("puts=%d", len(fake.putKeys))
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

func TestUploadObject_CanceledDuringKeyCheck(t *testing.T) {
	p := writeFile(t, t.TempDir(), "a.txt", 4)
	checking := make(chan struct{})
	release := make(chan struct{})
	fake := &fakeS3{
		head: func(string) error {
			close(checking)
			<-release
			return notFound()
		},
	}
	m, _ := newTestUploader(fake)

	done := make(chan models.Output[any])
	go func() {
		done <- m.uploadObject(models.UploadObjInput{ConnectionId: "conn", ObjList: []models.UploadObj{{Path: p}}})
	}()

	<-checking
	m.cancelAllUploads()
	close(release)
	select {
	case out := <-done:
		if !hasCode(out, S3W004) || len(fake.putKeys) != 0 {
			t.Fatalf("out=%+v put=%v", out, fake.putKeys)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("upload was not canceled")
	}
	if m.batchCancel != nil {
		t.Fatal("batchCancel must be cleared after the call")
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
	useLargeFileSize(t, 100)
	m, host := newTestUploader(&fakeS3{})
	dir := t.TempDir()

	for i := range maxFilesPerFolder + 1 {
		writeFile(t, dir, fmt.Sprintf("d/%03d", i), 1)
	}
	writeFile(t, dir, "d/sub/x", largeFileSize+1)

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
	if out.TabId != "tab1" || out.MaxFilesPerFolder != maxFilesPerFolder || out.LargeFileSize != largeFileSize ||
		out.LargeFileMaxCount != largeFileMaxCount || out.MaxTotalFiles != maxTotalFiles ||
		out.TotalFiles != maxFilesPerFolder+2 || out.OverMaxTotal || out.Capped || len(out.Groups) != 2 {
		t.Fatalf("%+v", out)
	}
	if g := out.Groups[0]; g.Name != "d" || !g.OverMaxFiles || !strings.HasPrefix(g.Files[0].RelKey, "d/") {
		t.Fatalf("%+v", g)
	}
	if g := out.Groups[1]; g.Name != "d/sub" || g.LargeCount != 1 || !g.Files[0].IsLarge {
		t.Fatalf("%+v", g)
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

func TestAppHost(t *testing.T) {
	app := newTestApp(t)
	h := appHost{app: app}
	if h.Context() == nil {
		t.Fatal("Context is nil")
	}
	h.Emit("test:app-host", "payload") // must not panic
}
