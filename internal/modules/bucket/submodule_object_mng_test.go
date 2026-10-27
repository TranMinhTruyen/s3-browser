package bucket

// Branch table for submodule_object_mng.go.
//
//	newSubmoduleObjMng: getDeleter/getHeader connected + not connected, appContext   TestNewSubmoduleObjMng
//	listObject: not connected -> S3E006                                 TestListObject_NotConnected
//	            folders + files, empty/prefix keys skipped, cursor      TestListObject_Success
//	            nil optional fields                                     TestListObject_NilFields
//	            S3 error -> S3E008                                      TestListObject_Error
//	            ctx canceled -> Result=false, no message                TestListObject_Canceled
//	deleteObject: not connected -> S3E006                               TestDeleteObject_NotConnected
//	              HeadObject fails (S3E013) / DeleteObject fails        TestDeleteObject_Errors
//	              all keys fail -> Result=false                         TestDeleteObject_AllFail
//	              success (S3S005)                                     TestDeleteObject_Success

import (
	"S3Browser/internal/modules/global"
	"S3Browser/models"
	"context"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
)

func newObjEnv(t *testing.T, h http.HandlerFunc) *submoduleObjMng {
	t.Helper()
	srv := newS3Server(t, h)
	g := global.NewModule()
	g.PutConnContainer("conn", newTestS3Conn(srv.URL))
	return newSubmoduleObjMng(newTestApp(t), slog.New(slog.DiscardHandler), g)
}

func TestNewSubmoduleObjMng(t *testing.T) {
	m := newObjEnv(t, func(http.ResponseWriter, *http.Request) {})
	if d, ok := m.getDeleter("conn"); !ok || d == nil {
		t.Fatal("getDeleter(conn) failed")
	}
	if d, ok := m.getDeleter("none"); ok || d != nil {
		t.Fatal("getDeleter(none) must fail")
	}
	if h, ok := m.getHeader("conn"); !ok || h == nil {
		t.Fatal("getHeader(conn) failed")
	}
	if h, ok := m.getHeader("none"); ok || h != nil {
		t.Fatal("getHeader(none) must fail")
	}
	if m.appContext() == nil {
		t.Fatal("appContext is nil")
	}
}

func TestListObject_NotConnected(t *testing.T) {
	m := newObjEnv(t, func(http.ResponseWriter, *http.Request) {})
	out := m.listObject(context.Background(), models.ListObjectInput{ConnectionId: "x", ProfileName: "p"})
	if out.Result || !slices.Equal(codesOf(out.MessageList), []string{S3E006}) {
		t.Fatalf("%+v", out)
	}
}

func TestListObject_Success(t *testing.T) {
	var query string
	m := newObjEnv(t, func(w http.ResponseWriter, r *http.Request) {
		query = r.URL.RawQuery
		writeXML(w, `<ListBucketResult><Name>b</Name><Prefix>dir/</Prefix><IsTruncated>true</IsTruncated>
<NextContinuationToken>next</NextContinuationToken>
<Contents><Key>dir/</Key><Size>0</Size></Contents>
<Contents><Key>dir/a.txt</Key><Size>5</Size><ETag>"e1"</ETag>
<LastModified>2024-01-02T03:04:05.000Z</LastModified></Contents>
<CommonPrefixes><Prefix>dir/sub/</Prefix></CommonPrefixes>
</ListBucketResult>`)
	})
	in := models.ListObjectInput{ConnectionId: "conn", Bucket: "b", Prefix: "dir/", Limit: 10}
	out := m.listObject(context.Background(), in)
	if !out.Result || aws.ToString(out.Body.NextCursor) != "next" || len(out.Body.ObjectList) != 2 {
		t.Fatalf("%+v", out)
	}
	folder, file := out.Body.ObjectList[0], out.Body.ObjectList[1]
	if !folder.IsFolder || folder.Key != "dir/sub/" || folder.Name != "sub" {
		t.Fatalf("folder: %+v", folder)
	}
	if file.IsFolder || file.Key != "dir/a.txt" || file.Name != "a.txt" || file.Size != 5 ||
		file.ETag != `"e1"` || file.LastModified.IsZero() {
		t.Fatalf("file: %+v", file)
	}
	for _, want := range []string{"delimiter=%2F", "max-keys=10", "prefix=dir%2F"} {
		if !strings.Contains(query, want) {
			t.Fatalf("query %q lacks %q", query, want)
		}
	}
	if strings.Contains(query, "continuation-token") {
		t.Fatalf("no cursor expected: %q", query)
	}

	in.NextCursor = "tok"
	m.listObject(context.Background(), in)
	if !strings.Contains(query, "continuation-token=tok") {
		t.Fatalf("cursor not sent: %q", query)
	}
}

func TestListObject_NilFields(t *testing.T) {
	m := newObjEnv(t, func(w http.ResponseWriter, _ *http.Request) {
		writeXML(w, `<ListBucketResult><Contents><Key>a</Key></Contents>
<Contents></Contents><CommonPrefixes></CommonPrefixes></ListBucketResult>`)
	})
	out := m.listObject(context.Background(), models.ListObjectInput{ConnectionId: "conn", Bucket: "b"})
	// The empty key and the empty common prefix are skipped.
	if !out.Result || len(out.Body.ObjectList) != 1 || out.Body.ObjectList[0].Key != "a" ||
		out.Body.ObjectList[0].Size != 0 || out.Body.ObjectList[0].ETag != "" {
		t.Fatalf("%+v", out)
	}
}

func TestListObject_Error(t *testing.T) {
	m := newObjEnv(t, func(w http.ResponseWriter, _ *http.Request) {
		writeS3Error(w, http.StatusNotFound, "NoSuchBucket")
	})
	in := models.ListObjectInput{ConnectionId: "conn", Bucket: "b", ProfileName: "p"}
	out := m.listObject(context.Background(), in)
	if out.Result || !slices.Equal(codesOf(out.MessageList), []string{S3E008}) ||
		out.MessageList[0].ErrorDetail != "NoSuchBucket" || out.MessageList[0].Params["bucket"] != "b" {
		t.Fatalf("%+v", out)
	}
}

func TestListObject_Canceled(t *testing.T) {
	m := newObjEnv(t, func(http.ResponseWriter, *http.Request) {})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	out := m.listObject(ctx, models.ListObjectInput{ConnectionId: "conn", Bucket: "b"})
	if out.Result || len(out.MessageList) != 0 {
		t.Fatalf("%+v", out)
	}
}

func TestDeleteObject_NotConnected(t *testing.T) {
	m := newObjEnv(t, func(http.ResponseWriter, *http.Request) {})
	out := m.deleteObject(context.Background(), models.DeleteObjInput{ConnectionId: "x", Objects: []string{"a"}})
	if out.Result || !slices.Equal(codesOf(out.MessageList), []string{S3E006}) {
		t.Fatalf("%+v", out)
	}
}

func TestDeleteObject_Errors(t *testing.T) {
	var mu sync.Mutex
	var deleted []string
	m := newObjEnv(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodHead && strings.HasSuffix(r.URL.Path, "/gone"):
			w.WriteHeader(http.StatusNotFound)
		case r.Method == http.MethodDelete && strings.HasSuffix(r.URL.Path, "/locked"):
			writeS3Error(w, http.StatusForbidden, "AccessDenied")
		case r.Method == http.MethodDelete:
			mu.Lock()
			deleted = append(deleted, r.URL.Path)
			mu.Unlock()
			w.WriteHeader(http.StatusNoContent)
		}
	})
	out := m.deleteObject(context.Background(), models.DeleteObjInput{
		ConnectionId: "conn", Bucket: "b", Objects: []string{"gone", "locked", "ok"},
	})
	counts := map[string]int{}
	byObject := map[string]string{}
	for _, msg := range out.MessageList {
		counts[msg.MessageCode]++
		byObject[msg.Params["object"].(string)] = msg.MessageCode
	}
	// Partial failure: Result=false, but every key keeps its own S3S005/S3E013 message.
	if out.Result || counts[S3E013] != 2 || counts[S3S005] != 1 ||
		byObject["gone"] != S3E013 || byObject["locked"] != S3E013 || byObject["ok"] != S3S005 {
		t.Fatalf("%+v", out.MessageList)
	}
	if !slices.Equal(deleted, []string{"/b/ok"}) {
		t.Fatalf("deleted: %v", deleted)
	}
}

func TestDeleteObject_AllFail(t *testing.T) {
	m := newObjEnv(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	})
	out := m.deleteObject(context.Background(), models.DeleteObjInput{
		ConnectionId: "conn", Bucket: "b", Objects: []string{"a", "b"},
	})
	if out.Result || !slices.Equal(codesOf(out.MessageList), []string{S3E013, S3E013}) {
		t.Fatalf("%+v", out)
	}
}

func TestDeleteObject_Success(t *testing.T) {
	m := newObjEnv(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodDelete {
			w.WriteHeader(http.StatusNoContent)
		}
	})
	out := m.deleteObject(context.Background(), models.DeleteObjInput{
		ConnectionId: "conn", Bucket: "b", Objects: []string{"a", "b"},
	})
	// Keys are deleted concurrently, so compare by object instead of message order.
	byObject := map[string]string{}
	for _, msg := range out.MessageList {
		byObject[msg.Params["object"].(string)] = msg.MessageCode
	}
	if !out.Result || len(out.MessageList) != 2 || byObject["a"] != S3S005 || byObject["b"] != S3S005 {
		t.Fatalf("%+v", out)
	}
}
