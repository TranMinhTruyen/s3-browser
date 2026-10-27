package bucket

// Branch table for submodule_connection_mng.go.
//
//	testAction: OK (conn not kept) / probe error                       TestTestAction_*
//	connectAction: new profile OK / CreateProfile fails / existing     TestConnectAction_*
//	               profile OK / probe error
//	replaceConn: no old conn / old conn with and without Transport     TestReplaceConn
//	profileConnectAction: no profile / probe error / OK                TestProfileConnectAction_*
//	disconnectAction: connected / not found                            TestDisconnectAction_*

import (
	"S3Browser/internal/modules/global"
	"S3Browser/internal/modules/profile"
	"S3Browser/models"
	"log/slog"
	"net/http"
	"slices"
	"testing"
)

type connEnv struct {
	mng     *submoduleConnMng
	global  *global.Module
	profile *profile.Module
	srvURL  string
}

// newConnEnv wires a connection manager to a fake S3 server that answers every request with status/code
// (an empty code means a valid empty bucket list).
func newConnEnv(t *testing.T, status int, code string) *connEnv {
	t.Helper()
	srv := newS3Server(t, func(w http.ResponseWriter, _ *http.Request) {
		if code != "" {
			writeS3Error(w, status, code)
			return
		}
		writeXML(w, "<ListAllMyBucketsResult><Buckets/></ListAllMyBucketsResult>")
	})
	app := newTestApp(t)
	logger := slog.New(slog.DiscardHandler)
	g := global.NewModule()
	p := profile.NewModule(app, logger, g, newTestDB(t), mustKeyManager(t))
	return &connEnv{
		mng:     newSubmoduleConnMng(app, logger, g, p, newSubmoduleCfgMng(logger)),
		global:  g,
		profile: p,
		srvURL:  srv.URL,
	}
}

func (e *connEnv) input() models.ConnectionProfileInput {
	return models.ConnectionProfileInput{
		Name: "prof", Provider: "aws", Endpoint: e.srvURL, Region: "us-east-1",
		AccessKey: "ak", SecretKey: "sk", PathStyle: true, SavePassword: true,
	}
}

func (e *connEnv) profileCount() int {
	return len(e.profile.GetAllConnectionProfile().Body.ConnectionProfiles)
}

func TestTestAction_OK(t *testing.T) {
	e := newConnEnv(t, 0, "")
	out := e.mng.testAction(e.input())
	if !out.Result || !out.Body.IsConnected || !slices.Equal(codesOf(out.MessageList), []string{S3S001}) {
		t.Fatalf("%+v", out)
	}
	if out.MessageList[0].Params["name"] != "prof" {
		t.Fatalf("params: %+v", out.MessageList[0].Params)
	}
	if n := e.profileCount(); n != 0 {
		t.Fatalf("a test connection must not save a profile, got %d", n)
	}
}

func TestTestAction_ProbeError(t *testing.T) {
	e := newConnEnv(t, http.StatusForbidden, "InvalidAccessKeyId")
	out := e.mng.testAction(e.input())
	// A failed probe returns Result=false with the probe message only once.
	if out.Result || out.Body.IsConnected || !slices.Equal(codesOf(out.MessageList), []string{S3E001}) {
		t.Fatalf("%+v", out)
	}
}

func TestConnectAction_NewProfile(t *testing.T) {
	e := newConnEnv(t, 0, "")
	out := e.mng.connectAction(e.input(), false)
	if !out.Result || !out.Body.IsConnected || out.Body.ConnectionId == "" ||
		!slices.Equal(codesOf(out.MessageList), []string{profile.PFS001, S3S002}) {
		t.Fatalf("%+v", out)
	}
	if !e.global.HasConn(out.Body.ConnectionId) {
		t.Fatal("connection was not stored")
	}
	if n := e.profileCount(); n != 1 {
		t.Fatalf("profile not saved, got %d", n)
	}
}

func TestConnectAction_CreateProfileFails(t *testing.T) {
	e := newConnEnv(t, 0, "")
	// A closed database makes CreateProfile fail.
	e.mng.profile = profile.NewModule(
		newTestApp(t), slog.New(slog.DiscardHandler), e.global, closedDB(t), mustKeyManager(t))
	out := e.mng.connectAction(e.input(), false)
	if out.Result || out.Body.IsConnected || !slices.Equal(codesOf(out.MessageList), []string{profile.PFE001}) {
		t.Fatalf("%+v", out)
	}
	if n := len(e.global.RemoveAllConn()); n != 0 {
		t.Fatalf("connection must not be stored, got %d", n)
	}
}

func TestConnectAction_ExistingProfile(t *testing.T) {
	e := newConnEnv(t, 0, "")
	in := e.input()
	in.Id = "existing"
	out := e.mng.connectAction(in, true)
	if !out.Result || out.Body.ConnectionId != "existing" || !out.Body.IsConnected ||
		!slices.Equal(codesOf(out.MessageList), []string{S3S002}) || !e.global.HasConn("existing") {
		t.Fatalf("%+v", out)
	}
	if n := e.profileCount(); n != 0 {
		t.Fatalf("an existing profile must not be created again, got %d", n)
	}
}

func TestConnectAction_ProbeError(t *testing.T) {
	e := newConnEnv(t, http.StatusForbidden, "SignatureDoesNotMatch")
	out := e.mng.connectAction(e.input(), false)
	// A failed probe returns Result=false with the probe message only once.
	if out.Result || out.Body.IsConnected || !slices.Equal(codesOf(out.MessageList), []string{S3E001}) {
		t.Fatalf("%+v", out)
	}
	if n := e.profileCount(); n != 0 {
		t.Fatalf("no profile must be created when the probe fails, got %d", n)
	}
}

func TestReplaceConn(t *testing.T) {
	e := newConnEnv(t, 0, "")
	first := newTestS3Conn(e.srvURL)
	e.mng.replaceConn("id", first) // no previous connection

	second := newTestS3Conn(e.srvURL)
	e.mng.replaceConn("id", second) // previous connection has a Transport
	if got, _ := e.global.GetConnContainer("id"); got != second {
		t.Fatal("connection was not replaced")
	}

	bare := newTestS3Conn(e.srvURL)
	bare.Transport = nil
	e.global.PutConnContainer("bare", bare)
	e.mng.replaceConn("bare", second) // previous connection has no Transport: must not panic
	if got, _ := e.global.GetConnContainer("bare"); got != second {
		t.Fatal("connection was not replaced")
	}
}

func TestProfileConnectAction_ProfileNotFound(t *testing.T) {
	e := newConnEnv(t, 0, "")
	out := e.mng.profileConnectAction("missing")
	if out.Result || out.Body.IsConnected || !slices.Equal(codesOf(out.MessageList), []string{profile.PFE003}) {
		t.Fatalf("%+v", out)
	}
}

func TestProfileConnectAction_ProbeError(t *testing.T) {
	e := newConnEnv(t, http.StatusForbidden, "InvalidRegion")
	id := e.profile.CreateProfile(e.input()).Body.ID
	out := e.mng.profileConnectAction(id)
	if out.Result || out.Body.IsConnected || !slices.Equal(codesOf(out.MessageList), []string{S3E002}) ||
		e.global.HasConn(id) {
		t.Fatalf("%+v", out)
	}
}

func TestProfileConnectAction_OK(t *testing.T) {
	e := newConnEnv(t, 0, "")
	id := e.profile.CreateProfile(e.input()).Body.ID
	out := e.mng.profileConnectAction(id)
	if !out.Result || !out.Body.IsConnected || out.Body.ConnectionId != id ||
		!slices.Equal(codesOf(out.MessageList), []string{S3S002}) || !e.global.HasConn(id) {
		t.Fatalf("%+v", out)
	}
}

func TestDisconnectAction_Connected(t *testing.T) {
	e := newConnEnv(t, 0, "")
	e.global.PutConnContainer("id", newTestS3Conn(e.srvURL))
	out := e.mng.disconnectAction("id")
	if !out.Body || !slices.Equal(codesOf(out.MessageList), []string{S3S003}) ||
		out.MessageList[0].Params["name"] != "prof" || e.global.HasConn("id") {
		t.Fatalf("%+v", out)
	}
}

func TestDisconnectAction_NotFound(t *testing.T) {
	e := newConnEnv(t, 0, "")
	out := e.mng.disconnectAction("nope")
	if out.Body || !slices.Equal(codesOf(out.MessageList), []string{S3E005}) {
		t.Fatalf("%+v", out)
	}
}
