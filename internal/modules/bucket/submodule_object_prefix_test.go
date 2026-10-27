package bucket

// Branch table for submodule_object_prefix.go.
//
// validDeletePrefix: "", "/", "//", "a", "a/", "a/b/"      TestValidDeletePrefix
// isDeleteObjectsUnsupported: non API error / codes         TestIsDeleteObjectsUnsupported
// deletePrefix
//   invalid prefix -> S3E020, no S3 call                    TestDeletePrefix_Invalid
//   not connected -> S3E006                                 TestDeletePrefix_NotConnected
//   pagination + batch <= 1000, Quiet, only the prefix      TestDeletePrefix_PagesAndBatches
//   DeleteObjects per key Errors -> S3E021                  TestDeletePrefix_KeyErrors
//   DeleteObjects request error -> S3E021                   TestDeletePrefix_RequestError
//   DeleteObjects unsupported -> DeleteObject per key       TestDeletePrefix_Fallback
//   fallback per key error                                  TestDeletePrefix_FallbackError
//   list error                                              TestDeletePrefix_ListError
//   ctx canceled -> Result=false, no message                TestDeletePrefix_Canceled
//   ctx canceled during DeleteObjects                       TestDeletePrefix_CanceledInBatch
//   ctx canceled during the DeleteObject fallback           TestDeletePrefix_CanceledInFallback
//   nothing under the prefix -> success with 0              TestDeletePrefix_Empty

import (
	"S3Browser/models"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/smithy-go"
)

// fakeDeleter is an in-memory s3Deleter holding a set of keys.
type fakeDeleter struct {
	mu   sync.Mutex
	keys map[string]bool

	listErr    error
	batchErr   error
	perKeyErrs map[string]string // DeleteObjects Errors, by key
	singleErr  map[string]error  // DeleteObject errors, by key
	onList     func()
	onBatch    func() // runs before DeleteObjects checks its context
	onSingle   func() // runs inside DeleteObject

	listCalls   int
	batchSizes  []int
	quietAll    bool
	singleCalls int
}

func newFakeDeleter(keys ...string) *fakeDeleter {
	f := &fakeDeleter{keys: map[string]bool{}, quietAll: true}
	for _, k := range keys {
		f.keys[k] = true
	}
	return f
}

func (f *fakeDeleter) remaining(prefix string) []string {
	var out []string
	for k := range f.keys {
		if strings.HasPrefix(k, prefix) {
			out = append(out, k)
		}
	}
	sort.Strings(out)
	return out
}

func (f *fakeDeleter) ListObjectsV2(
	ctx context.Context, in *s3.ListObjectsV2Input, _ ...func(*s3.Options),
) (*s3.ListObjectsV2Output, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.listCalls++
	if f.onList != nil {
		f.onList()
	}
	if err := ctx.Err(); err != nil {
		return nil, err // like the SDK, fail once the context is done
	}
	if f.listErr != nil {
		return nil, f.listErr
	}
	if in.Delimiter != nil {
		return nil, errors.New("delimiter must not be set")
	}

	all := f.remaining(aws.ToString(in.Prefix))
	// Like S3, the continuation token is the last key of the previous page.
	if tok := aws.ToString(in.ContinuationToken); tok != "" {
		i := sort.SearchStrings(all, tok)
		if i < len(all) && all[i] == tok {
			i++
		}
		all = all[i:]
	}
	end := min(int(aws.ToInt32(in.MaxKeys)), len(all))
	out := &s3.ListObjectsV2Output{IsTruncated: aws.Bool(end < len(all))}
	for _, k := range all[:end] {
		out.Contents = append(out.Contents, types.Object{Key: aws.String(k)})
	}
	if end < len(all) {
		out.NextContinuationToken = aws.String(all[end-1])
	}
	return out, nil
}

func (f *fakeDeleter) DeleteObjects(
	ctx context.Context, in *s3.DeleteObjectsInput, _ ...func(*s3.Options),
) (*s3.DeleteObjectsOutput, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.onBatch != nil {
		f.onBatch()
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if f.batchErr != nil {
		return nil, f.batchErr
	}
	f.batchSizes = append(f.batchSizes, len(in.Delete.Objects))
	if !aws.ToBool(in.Delete.Quiet) {
		f.quietAll = false
	}
	out := &s3.DeleteObjectsOutput{}
	for _, o := range in.Delete.Objects {
		k := aws.ToString(o.Key)
		if code, bad := f.perKeyErrs[k]; bad {
			out.Errors = append(out.Errors, types.Error{
				Key: aws.String(k), Code: aws.String(code), Message: aws.String("denied"),
			})
			continue
		}
		delete(f.keys, k)
	}
	return out, nil
}

func (f *fakeDeleter) DeleteObject(
	_ context.Context, in *s3.DeleteObjectInput, _ ...func(*s3.Options),
) (*s3.DeleteObjectOutput, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.singleCalls++
	if f.onSingle != nil {
		f.onSingle()
	}
	k := aws.ToString(in.Key)
	if err := f.singleErr[k]; err != nil {
		return nil, err
	}
	delete(f.keys, k)
	return &s3.DeleteObjectOutput{}, nil
}

type fakeAPIErr struct{ code string }

func (e *fakeAPIErr) Error() string                 { return e.code }
func (e *fakeAPIErr) ErrorCode() string             { return e.code }
func (e *fakeAPIErr) ErrorMessage() string          { return e.code }
func (e *fakeAPIErr) ErrorFault() smithy.ErrorFault { return smithy.FaultClient }

func newTestObjMng(client s3Deleter) *submoduleObjMng {
	return &submoduleObjMng{
		logger:     slog.New(slog.DiscardHandler),
		getDeleter: func(id string) (s3Deleter, bool) { return client, id == "conn" },
		appContext: context.Background,
	}
}

func prefixInput(prefix string) models.DeletePrefixInput {
	return models.DeletePrefixInput{ConnectionId: "conn", Bucket: "b", Prefix: prefix}
}

func manyKeys(prefix string, n int) []string {
	keys := make([]string, n)
	for i := range keys {
		keys[i] = fmt.Sprintf("%sk%05d", prefix, i)
	}
	return keys
}

func prefixCodes(out models.Output[models.DeletePrefixOutput]) []string {
	var c []string
	for _, m := range out.MessageList {
		c = append(c, m.MessageCode)
	}
	return c
}

func TestValidDeletePrefix(t *testing.T) {
	for p, want := range map[string]bool{
		"": false, "/": false, "//": false, "a": false, "a/": true, "a/b/": true,
	} {
		if got := validDeletePrefix(p); got != want {
			t.Errorf("validDeletePrefix(%q)=%v want %v", p, got, want)
		}
	}
}

func TestIsDeleteObjectsUnsupported(t *testing.T) {
	if isDeleteObjectsUnsupported(errBoom) {
		t.Error("plain error")
	}
	for _, c := range []string{"NotImplemented", "MissingContentMD5", "XNotImplemented"} {
		if !isDeleteObjectsUnsupported(&fakeAPIErr{c}) {
			t.Errorf("%s should be unsupported", c)
		}
	}
	if isDeleteObjectsUnsupported(&fakeAPIErr{"AccessDenied"}) {
		t.Error("AccessDenied")
	}
}

func TestDeletePrefix_Invalid(t *testing.T) {
	f := newFakeDeleter("a/x")
	m := newTestObjMng(f)
	for _, p := range []string{"", "/", "a"} {
		out := m.deletePrefix(context.Background(), prefixInput(p))
		if out.Result || len(out.MessageList) != 1 || out.MessageList[0].MessageCode != S3E020 {
			t.Fatalf("prefix %q: %+v", p, out)
		}
	}
	if f.listCalls != 0 || len(f.keys) != 1 {
		t.Fatalf("S3 touched: list=%d keys=%v", f.listCalls, f.keys)
	}
}

func TestDeletePrefix_NotConnected(t *testing.T) {
	in := prefixInput("a/")
	in.ConnectionId = "other"
	out := newTestObjMng(newFakeDeleter()).deletePrefix(context.Background(), in)
	if out.Result || prefixCodes(out)[0] != S3E006 {
		t.Fatalf("%+v", out)
	}
}

func TestDeletePrefix_PagesAndBatches(t *testing.T) {
	keys := append(manyKeys("a/", 2500), "a/", "a/sub/deep", "ab/other", "b/x")
	f := newFakeDeleter(keys...)
	out := newTestObjMng(f).deletePrefix(context.Background(), prefixInput("a/"))

	if !out.Result || len(out.MessageList) != 1 || out.MessageList[0].MessageCode != S3S007 {
		t.Fatalf("%+v", out)
	}
	if out.Body.Deleted != 2502 || out.Body.Failed != 0 {
		t.Fatalf("body=%+v", out.Body)
	}
	if out.MessageList[0].Params["count"] != 2502 {
		t.Fatalf("params=%v", out.MessageList[0].Params)
	}
	for _, n := range f.batchSizes {
		if n > 1000 {
			t.Fatalf("batch of %d", n)
		}
	}
	if len(f.batchSizes) != 3 || !f.quietAll {
		t.Fatalf("batches=%v quiet=%v", f.batchSizes, f.quietAll)
	}
	if got := f.remaining(""); len(got) != 2 || got[0] != "ab/other" || got[1] != "b/x" {
		t.Fatalf("remaining=%v", got)
	}
}

func TestDeletePrefix_Empty(t *testing.T) {
	out := newTestObjMng(newFakeDeleter("b/x")).deletePrefix(context.Background(), prefixInput("a/"))
	if !out.Result || out.Body.Deleted != 0 || prefixCodes(out)[0] != S3S007 {
		t.Fatalf("%+v", out)
	}
}

func TestDeletePrefix_KeyErrors(t *testing.T) {
	f := newFakeDeleter("a/1", "a/2", "a/3")
	f.perKeyErrs = map[string]string{"a/2": "AccessDenied", "a/3": "AccessDenied"}
	out := newTestObjMng(f).deletePrefix(context.Background(), prefixInput("a/"))

	if out.Result || len(out.MessageList) != 1 || out.MessageList[0].MessageCode != S3E021 {
		t.Fatalf("%+v", out)
	}
	p := out.MessageList[0].Params
	if p["failed"] != 2 || p["deleted"] != 1 || !strings.Contains(out.MessageList[0].ErrorDetail, "AccessDenied") {
		t.Fatalf("params=%v detail=%q", p, out.MessageList[0].ErrorDetail)
	}
}

func TestDeletePrefix_RequestError(t *testing.T) {
	f := newFakeDeleter("a/1", "a/2")
	f.batchErr = &fakeAPIErr{"AccessDenied"}
	out := newTestObjMng(f).deletePrefix(context.Background(), prefixInput("a/"))
	if out.Result || prefixCodes(out)[0] != S3E021 || out.Body.Failed != 2 || f.singleCalls != 0 {
		t.Fatalf("%+v calls=%d", out, f.singleCalls)
	}
}

func TestDeletePrefix_Fallback(t *testing.T) {
	f := newFakeDeleter(manyKeys("a/", 1500)...)
	f.batchErr = &fakeAPIErr{"NotImplemented"}
	out := newTestObjMng(f).deletePrefix(context.Background(), prefixInput("a/"))
	if !out.Result || out.Body.Deleted != 1500 || f.singleCalls != 1500 || len(f.keys) != 0 {
		t.Fatalf("%+v calls=%d keys=%d", out, f.singleCalls, len(f.keys))
	}
}

func TestDeletePrefix_FallbackError(t *testing.T) {
	f := newFakeDeleter("a/1", "a/2")
	f.batchErr = &fakeAPIErr{"MissingContentMD5"}
	f.singleErr = map[string]error{"a/2": &fakeAPIErr{"AccessDenied"}}
	out := newTestObjMng(f).deletePrefix(context.Background(), prefixInput("a/"))
	if out.Result || prefixCodes(out)[0] != S3E021 || out.Body.Deleted != 1 || out.Body.Failed != 1 {
		t.Fatalf("%+v", out)
	}
}

func TestDeletePrefix_ListError(t *testing.T) {
	f := newFakeDeleter("a/1")
	f.listErr = &fakeAPIErr{"AccessDenied"}
	out := newTestObjMng(f).deletePrefix(context.Background(), prefixInput("a/"))
	if out.Result || prefixCodes(out)[0] != S3E021 || out.MessageList[0].ErrorDetail != "AccessDenied" {
		t.Fatalf("%+v", out)
	}
}

func TestDeletePrefix_Canceled(t *testing.T) {
	f := newFakeDeleter(manyKeys("a/", 3000)...)
	ctx, cancel := context.WithCancel(context.Background())
	f.onList = func() {
		if f.listCalls == 2 {
			cancel()
		}
	}
	out := newTestObjMng(f).deletePrefix(ctx, prefixInput("a/"))
	if out.Result || len(out.MessageList) != 0 {
		t.Fatalf("%+v", out)
	}
	if len(f.keys) == 0 {
		t.Fatal("should have stopped before deleting everything")
	}
}

func TestDeletePrefix_CanceledInBatch(t *testing.T) {
	f := newFakeDeleter("a/1", "a/2")
	ctx, cancel := context.WithCancel(context.Background())
	f.onBatch = cancel
	out := newTestObjMng(f).deletePrefix(ctx, prefixInput("a/"))
	if out.Result || len(out.MessageList) != 0 || len(f.keys) != 2 {
		t.Fatalf("%+v keys=%d", out, len(f.keys))
	}
}

func TestDeletePrefix_CanceledInFallback(t *testing.T) {
	f := newFakeDeleter("a/1", "a/2")
	f.batchErr = &fakeAPIErr{"NotImplemented"}
	ctx, cancel := context.WithCancel(context.Background())
	f.onSingle = cancel
	out := newTestObjMng(f).deletePrefix(ctx, prefixInput("a/"))
	if out.Result || len(out.MessageList) != 0 {
		t.Fatalf("%+v", out)
	}
}
