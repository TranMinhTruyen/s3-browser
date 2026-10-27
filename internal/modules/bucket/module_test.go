package bucket

// Branch table for module.go: NewModule wires the submodules and every public method
// forwards to its submodule. The tests use calls that fail fast (unknown connection,
// empty input) and check the message code that proves the right submodule answered.

import (
	"S3Browser/internal/modules/global"
	"S3Browser/internal/modules/profile"
	"S3Browser/models"
	"context"
	"log/slog"
	"net/http"
	"slices"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func newTestModule(t *testing.T) (*Module, *global.Module) {
	t.Helper()
	app := newTestApp(t)
	logger := slog.New(slog.DiscardHandler)
	g := global.NewModule()
	db := newTestDB(t)
	p := profile.NewModule(app, logger, g, db, mustKeyManager(t))
	return NewModule(app, logger, g, db, p), g
}

func TestModule_Connection(t *testing.T) {
	srv := newS3Server(t, func(w http.ResponseWriter, _ *http.Request) {
		writeXML(w, "<ListAllMyBucketsResult><Buckets/></ListAllMyBucketsResult>")
	})
	m, g := newTestModule(t)
	in := models.ConnectionProfileInput{
		Name: "prof", Provider: "aws", Endpoint: srv.URL, Region: "us-east-1",
		AccessKey: "ak", SecretKey: "sk", PathStyle: true, SavePassword: true,
	}

	if out := m.TestConnection(in); !out.Body.IsConnected || codesOf(out.MessageList)[0] != S3S001 {
		t.Fatalf("TestConnection: %+v", out)
	}
	connected := m.Connect(in, false)
	if !connected.Body.IsConnected || !g.HasConn(connected.Body.ConnectionId) {
		t.Fatalf("Connect: %+v", connected)
	}
	if out := m.ConnectByProfile(connected.Body.ConnectionId); !out.Body.IsConnected {
		t.Fatalf("ConnectByProfile: %+v", out)
	}
	if out := m.Disconnect(connected.Body.ConnectionId); !out.Body || g.HasConn(connected.Body.ConnectionId) {
		t.Fatalf("Disconnect: %+v", out)
	}

	g.PutConnContainer("x", newTestS3Conn(srv.URL))
	m.DisconnectAll()
	if g.HasConn("x") {
		t.Fatal("DisconnectAll must remove every connection")
	}
}

func TestModule_NotConnected(t *testing.T) {
	m, _ := newTestModule(t)
	ctx := context.Background()
	notConnected := []string{S3E006}

	checks := map[string][]string{
		"GetListBucket": codesOf(m.GetListBucket(ctx, models.ListBucketInput{ConnectionId: "x"}).MessageList),
		"GetListObject": codesOf(m.GetListObject(ctx, models.ListObjectInput{ConnectionId: "x"}).MessageList),
		"DeleteObject": codesOf(m.DeleteObject(ctx, models.DeleteObjInput{ConnectionId: "x", Objects: []string{"a"}}).
			MessageList),
		"DeletePrefix": codesOf(m.DeletePrefix(ctx, models.DeletePrefixInput{ConnectionId: "x", Prefix: "a/"}).
			MessageList),
		"DownloadObject": codesOf(m.DownloadObject(models.DownloadObjInput{ConnectionId: "x", Objects: []string{"a"}}).
			MessageList),
	}
	for name, codes := range checks {
		if !slices.Equal(codes, notConnected) {
			t.Errorf("%s: codes=%v", name, codes)
		}
	}

	if out := m.GetObjectDetail(ctx, models.ObjectDetailInput{ConnectionId: "x", Key: "a"}); out.Result {
		t.Errorf("GetObjectDetail: %+v", out)
	}
}

func TestModule_Transfers(t *testing.T) {
	m, _ := newTestModule(t)

	if out := m.CancelDownloadOne("unknown"); !out.Result {
		t.Errorf("CancelDownloadOne: %+v", out)
	}
	if out := m.CancelAllDownloads(); !out.Result {
		t.Errorf("CancelAllDownloads: %+v", out)
	}
	if out := m.CancelUploadOne("unknown"); !out.Result {
		t.Errorf("CancelUploadOne: %+v", out)
	}
	if out := m.CancelAllUploads(); !out.Result {
		t.Errorf("CancelAllUploads: %+v", out)
	}
	if out := m.UploadObject(models.UploadObjInput{ConnectionId: "x"}); len(out.MessageList) != 0 {
		t.Errorf("UploadObject with nothing to upload: %+v", out)
	}
	m.HandleFilesDropped(application.NewWindowEvent()) // no drop context: ignored
}

func TestModule_DownloadHistory(t *testing.T) {
	m, _ := newTestModule(t)

	if out := m.GetDownloadHistory(models.DownloadHistoryInput{PageSize: 10}); !out.Result {
		t.Errorf("GetDownloadHistory: %+v", out)
	}
	out := m.OpenDownloadDest("a.txt", t.TempDir()+"/nope")
	if out.Result || !slices.Equal(codesOf(out.MessageList), []string{S3E014}) {
		t.Errorf("OpenDownloadDest: %+v", out)
	}
}
