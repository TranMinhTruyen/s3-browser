package bucket

// Branch table for submodule_downloader_mng.go.
//
// downloadObject: not connected -> S3E006                       TestDownloadObject_NotConnected
//   dialog, S3 download and result messages                     not unit tested (the dialog can't be
//                                                               mocked); their parts are tested below:
// downloadOne: OK / create history error / S3 error / canceled   TestDownloadOne_*
// finishHistory: OK / update error replaces r.err                TestFinishHistory_*
// cancelDownloadOne: known id / unknown id                       TestCancelDownload
// cancelAllDownloads                                             TestCancelDownload
// reserveDest: free / taken by a running job / on disk / .part   TestReserveDest
// destKey, destTaken, pathExists                                 TestReserveDest, TestDestKey
// suffixedPath: extension / no extension / dot file              TestSuffixedPath

import (
	"S3Browser/internal/modules/global"
	"S3Browser/models"
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"testing"
)

type downloaderEnv struct {
	mng     *submoduleDownloaderMng
	history *submoduleDownloadHistoryMng
	global  *global.Module
}

func newDownloaderEnv(t *testing.T, db *sql.DB) *downloaderEnv {
	t.Helper()
	app := newTestApp(t)
	logger := slog.New(slog.DiscardHandler)
	g := global.NewModule()
	h := newSubmoduleDownloadHistoryMng(app, logger, db)
	return &downloaderEnv{mng: newSubmoduleDownloaderMng(app, logger, g, h), history: h, global: g}
}

// recordOf returns the stored history record with the given id.
func (e *downloaderEnv) recordOf(t *testing.T, id string) models.DownloadHistoryItem {
	t.Helper()
	list := e.history.getDownloadHistory(models.DownloadHistoryInput{PageSize: 50}).Body.DownloadHistoryList
	for _, item := range list {
		if item.ID == id {
			return item
		}
	}
	t.Fatalf("history %s not found", id)
	return models.DownloadHistoryItem{}
}

func TestDownloadObject_NotConnected(t *testing.T) {
	e := newDownloaderEnv(t, newTestDB(t))
	out := e.mng.downloadObject(models.DownloadObjInput{ConnectionId: "x", ProfileName: "p", Objects: []string{"a"}})
	if out.Result || !slices.Equal(codesOf(out.MessageList), []string{S3E006}) ||
		out.MessageList[0].Params["name"] != "p" {
		t.Fatalf("%+v", out)
	}
}

func TestDownloadOne_Success(t *testing.T) {
	e := newDownloaderEnv(t, newTestDB(t))
	tm, _ := newTestTM(t, serveObject)
	dest := filepath.Join(t.TempDir(), "out.txt")

	r := e.mng.downloadOne(context.Background(), "id1", tm, "b", "dir/out.txt", dest)
	if r.err != nil || r.key != "dir/out.txt" || r.history == nil || r.history.Status != DOWNLOADED ||
		r.history.DestPath != dest || r.history.Size != float64(len(downloadBody)) || r.history.Version != 1 {
		t.Fatalf("%+v history=%+v", r, r.history)
	}
	if got, _ := os.ReadFile(dest); string(got) != downloadBody {
		t.Fatalf("content: %q", got)
	}
	if _, running := e.mng.jobs.Load("id1"); running {
		t.Fatal("job must be removed")
	}
	if got := e.recordOf(t, "id1"); got.Status != DOWNLOADING {
		t.Fatalf("downloadOne must not finish the record: %+v", got)
	}
}

func TestDownloadOne_CreateHistoryError(t *testing.T) {
	e := newDownloaderEnv(t, closedDB(t))
	tm, _ := newTestTM(t, serveObject)
	dest := filepath.Join(t.TempDir(), "out.txt")

	r := e.mng.downloadOne(context.Background(), "id1", tm, "b", "k", dest)
	if r.err == nil || r.history != nil || pathExists(dest) {
		t.Fatalf("%+v", r)
	}
}

func TestDownloadOne_S3Error(t *testing.T) {
	e := newDownloaderEnv(t, newTestDB(t))
	tm, _ := newTestTM(t, func(w http.ResponseWriter, _ *http.Request) {
		writeS3Error(w, http.StatusNotFound, "NoSuchKey")
	})

	r := e.mng.downloadOne(context.Background(), "id1", tm, "b", "k", filepath.Join(t.TempDir(), "out.txt"))
	if r.err == nil || errors.Is(r.err, context.Canceled) || r.history == nil ||
		r.history.Status != DOWNLOAD_ERROR || r.history.DestPath != "" {
		t.Fatalf("%+v history=%+v", r, r.history)
	}
}

func TestDownloadOne_Canceled(t *testing.T) {
	e := newDownloaderEnv(t, newTestDB(t))
	tm, _ := newTestTM(t, serveObject)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	r := e.mng.downloadOne(ctx, "id1", tm, "b", "k", filepath.Join(t.TempDir(), "out.txt"))
	if !errors.Is(r.err, context.Canceled) || r.history == nil || r.history.Status != CANCELED {
		t.Fatalf("%+v history=%+v", r, r.history)
	}
}

func TestFinishHistory_Success(t *testing.T) {
	e := newDownloaderEnv(t, newTestDB(t))
	saved, err := e.history.createDownloadHistory(models.DownloadHistoryItem{ID: "id1", FileName: "a"})
	if err != nil {
		t.Fatal(err)
	}
	r := downloadResult{history: &models.DownloadHistoryItem{
		ID: "id1", DestPath: "/tmp/a", Status: DOWNLOADED, Size: 5, Version: saved.Version,
	}}

	e.mng.finishHistory(&r)
	if r.err != nil {
		t.Fatal(r.err)
	}
	if got := e.recordOf(t, "id1"); got.Status != DOWNLOADED || got.DestPath != "/tmp/a" || got.Size != 5 {
		t.Fatalf("%+v", got)
	}
}

func TestFinishHistory_UpdateError(t *testing.T) {
	e := newDownloaderEnv(t, newTestDB(t))
	// No record "missing" exists, so the update finds no row.
	r := downloadResult{history: &models.DownloadHistoryItem{ID: "missing", Status: DOWNLOADED, Version: 1}}
	e.mng.finishHistory(&r)
	if r.err == nil {
		t.Fatal("update error must replace r.err")
	}
}

func TestCancelDownload(t *testing.T) {
	e := newDownloaderEnv(t, newTestDB(t))
	ctx1, cancel1 := context.WithCancel(context.Background())
	ctx2, cancel2 := context.WithCancel(context.Background())
	defer cancel1()
	defer cancel2()
	e.mng.jobs.Store("a", downloaderJob{cancel: cancel1})
	e.mng.jobs.Store("b", downloaderJob{cancel: cancel2})

	if out := e.mng.cancelDownloadOne("unknown"); !out.Result || ctx1.Err() != nil || ctx2.Err() != nil {
		t.Fatalf("unknown id must be ignored: %+v", out)
	}
	if out := e.mng.cancelDownloadOne("a"); !out.Result || ctx1.Err() == nil || ctx2.Err() != nil {
		t.Fatalf("only job a must be canceled: %+v", out)
	}
	if _, ok := e.mng.jobs.Load("a"); ok {
		t.Fatal("job a must be removed")
	}

	if out := e.mng.cancelAllDownloads(); !out.Result || ctx2.Err() == nil {
		t.Fatalf("job b must be canceled: %+v", out)
	}
}

// reserve reserves dest and registers the release for the end of the test.
func reserve(t *testing.T, m *submoduleDownloaderMng, dest, id string, avoidExisting bool) string {
	t.Helper()
	got, release := m.reserveDest(dest, id, avoidExisting)
	t.Cleanup(release)
	return got
}

func TestReserveDest(t *testing.T) {
	m := newDownloaderEnv(t, newTestDB(t)).mng
	dir := t.TempDir()
	dest := filepath.Join(dir, "a.txt")

	got, release := m.reserveDest(dest, "id1", true)
	if got != dest {
		t.Fatalf("free path must be kept: %s", got)
	}
	// Taken by the running job.
	if got, want := reserve(t, m, dest, "id2", false), filepath.Join(dir, "a(id2).txt"); got != want {
		t.Fatalf("got %s want %s", got, want)
	}
	release()
	if got := reserve(t, m, dest, "id3", false); got != dest {
		t.Fatalf("path must be free after release: %s", got)
	}

	// On disk: checked only when avoidExisting is set.
	b := writeFile(t, dir, "b.txt", 1)
	if got := reserve(t, m, b, "id4", false); got != b {
		t.Fatalf("existing file is ignored without avoidExisting: %s", got)
	}
	if got, want := reserve(t, m, b, "id5", true), filepath.Join(dir, "b(id5).txt"); got != want {
		t.Fatalf("existing file must be avoided: got %s want %s", got, want)
	}

	// A leftover .part file counts too.
	writeFile(t, dir, "c.txt.part", 1)
	c := filepath.Join(dir, "c.txt")
	if got, want := reserve(t, m, c, "id6", true), filepath.Join(dir, "c(id6).txt"); got != want {
		t.Fatalf("existing .part must be avoided: got %s want %s", got, want)
	}
}

func TestDestKey(t *testing.T) {
	want := "Report.PDF"
	if runtime.GOOS == "windows" {
		want = "report.pdf" // Windows file names are case-insensitive
	}
	if got := destKey("Report.PDF"); got != want {
		t.Fatalf("got %s want %s", got, want)
	}
}

func TestSuffixedPath(t *testing.T) {
	dir := filepath.Join("some", "dir")
	cases := map[string]string{
		filepath.Join(dir, "report.pdf"):     filepath.Join(dir, "report(x).pdf"),
		filepath.Join(dir, "archive.tar.gz"): filepath.Join(dir, "archive.tar(x).gz"),
		filepath.Join(dir, "README"):         filepath.Join(dir, "README(x)"),
		filepath.Join(dir, ".env"):           filepath.Join(dir, ".env(x)"),
		"plain.txt":                          "plain(x).txt",
	}
	for in, want := range cases {
		if got := suffixedPath(in, "x"); got != want {
			t.Errorf("suffixedPath(%q) = %q, want %q", in, got, want)
		}
	}
}
