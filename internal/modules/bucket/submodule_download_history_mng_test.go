package bucket

// Branch table for submodule_download_history_mng.go.
//
// create/updateDownloadHistory: OK / DB error                 TestDownloadHistory_CreateUpdate / _DBError
//   update: empty dest and zero size stored as NULL           TestDownloadHistory_CreateUpdate
// getDownloadHistory: DB error -> S3E011                      TestGetDownloadHistory_Error
//   one page, more pages (AfterID), empty                     TestGetDownloadHistory_Paging
// openDownloadDest: missing file -> S3E014                    TestOpenDownloadDest_NotExist
//   stat error -> S3E015                                      TestOpenDownloadDest_StatError
//   command can't start -> S3E016 (PATH is empty)             TestOpenDownloadDest_StartError
//   command starts (PATH holds a fake opener)                 TestOpenDownloadDest_Success
//   other runtime.GOOS branches                               not unit tested (one OS per run)

import (
	"S3Browser/models"
	"database/sql"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"testing"
	"time"
)

// fakeOpenerEnv holds the file where the fake opener writes its arguments (see init below).
const fakeOpenerEnv = "S3BROWSER_TEST_INTERNAL_FAKE_OPENER_ARGS_FILE"

// fakeOpenerNames are the executable names (without .exe) the production code starts.
var fakeOpenerNames = []string{"explorer", "open", "xdg-open"}

// init makes the test binary record its arguments and exit at once when it is started as the fake
// explorer/open/xdg-open by TestOpenDownloadDest_Success, so no test runs twice and no real
// application is opened. Both the env var and the executable name must match, so a stray env var
// does not stop the real test binary.
func init() {
	out := os.Getenv(fakeOpenerEnv)
	name := strings.TrimSuffix(filepath.Base(os.Args[0]), ".exe")
	if out == "" || !slices.Contains(fakeOpenerNames, name) {
		return
	}
	// Write then rename, so the polling test never reads a half-written file.
	tmp := out + ".tmp"
	if os.WriteFile(tmp, []byte(strings.Join(os.Args[1:], "\n")), 0o600) == nil {
		_ = os.Rename(tmp, out)
	}
	os.Exit(0)
}

func newHistoryMng(t *testing.T, db *sql.DB) *submoduleDownloadHistoryMng {
	t.Helper()
	return newSubmoduleDownloadHistoryMng(newTestApp(t), slog.New(slog.DiscardHandler), db)
}

func TestDownloadHistory_CreateUpdate(t *testing.T) {
	m := newHistoryMng(t, newTestDB(t))

	saved, err := m.createDownloadHistory(models.DownloadHistoryItem{ID: "id1", FileName: "a.txt", DestPath: "/tmp/a"})
	if err != nil || saved.ID != "id1" || saved.Status != DOWNLOADING || saved.Version != 1 {
		t.Fatalf("%+v err=%v", saved, err)
	}

	updated, err := m.updateDownloadHistory(models.DownloadHistoryItem{
		ID: "id1", DestPath: "/tmp/b", Status: DOWNLOADED, Size: 12, Version: saved.Version,
	})
	if err != nil || updated.Status != DOWNLOADED || updated.DestPath != "/tmp/b" ||
		updated.Size != 12 || updated.Version != 2 {
		t.Fatalf("%+v err=%v", updated, err)
	}

	// Empty dest path and zero size are stored as NULL.
	updated, err = m.updateDownloadHistory(models.DownloadHistoryItem{
		ID: "id1", Status: CANCELED, Version: updated.Version,
	})
	if err != nil || updated.Status != CANCELED || updated.DestPath != "" || updated.Size != 0 {
		t.Fatalf("%+v err=%v", updated, err)
	}
}

func TestDownloadHistory_DBError(t *testing.T) {
	m := newHistoryMng(t, closedDB(t))
	if _, err := m.createDownloadHistory(models.DownloadHistoryItem{ID: "id1"}); err == nil {
		t.Fatal("create: want error")
	}
	if _, err := m.updateDownloadHistory(models.DownloadHistoryItem{ID: "id1", Version: 1}); err == nil {
		t.Fatal("update: want error")
	}
}

func TestGetDownloadHistory_Error(t *testing.T) {
	m := newHistoryMng(t, closedDB(t))
	out := m.getDownloadHistory(models.DownloadHistoryInput{PageSize: 10})
	if out.Result || !slices.Equal(codesOf(out.MessageList), []string{S3E011}) {
		t.Fatalf("%+v", out)
	}
}

func TestGetDownloadHistory_Paging(t *testing.T) {
	m := newHistoryMng(t, newTestDB(t))

	if out := m.getDownloadHistory(models.DownloadHistoryInput{PageSize: 2}); !out.Result ||
		len(out.Body.DownloadHistoryList) != 0 || out.Body.AfterID != "" {
		t.Fatalf("empty: %+v", out)
	}

	for _, id := range []string{"id1", "id2", "id3"} {
		if _, err := m.createDownloadHistory(models.DownloadHistoryItem{ID: id, FileName: id}); err != nil {
			t.Fatal(err)
		}
	}

	// Newest first; a full page that is followed by more rows sets AfterID.
	first := m.getDownloadHistory(models.DownloadHistoryInput{PageSize: 2})
	if !first.Result || len(first.Body.DownloadHistoryList) != 2 || first.Body.AfterID != "id2" ||
		first.Body.DownloadHistoryList[0].ID != "id3" {
		t.Fatalf("first: %+v", first)
	}

	last := m.getDownloadHistory(models.DownloadHistoryInput{AfterID: first.Body.AfterID, PageSize: 2})
	if len(last.Body.DownloadHistoryList) != 1 || last.Body.DownloadHistoryList[0].ID != "id1" ||
		last.Body.AfterID != "" {
		t.Fatalf("last: %+v", last)
	}
}

func TestOpenDownloadDest_NotExist(t *testing.T) {
	m := newHistoryMng(t, newTestDB(t))
	out := m.openDownloadDest("a.txt", filepath.Join(t.TempDir(), "nope"))
	if out.Result || !slices.Equal(codesOf(out.MessageList), []string{S3E014}) ||
		out.MessageList[0].Params["name"] != "a.txt" {
		t.Fatalf("%+v", out)
	}
}

func TestOpenDownloadDest_StatError(t *testing.T) {
	m := newHistoryMng(t, newTestDB(t))
	// A NUL byte makes Stat fail with an error that is not "not exist".
	out := m.openDownloadDest("a.txt", "bad\x00path")
	if out.Result || !slices.Equal(codesOf(out.MessageList), []string{S3E015}) {
		t.Fatalf("%+v", out)
	}
}

func TestOpenDownloadDest_StartError(t *testing.T) {
	m := newHistoryMng(t, newTestDB(t))
	p := writeFile(t, t.TempDir(), "a.txt", 1)
	t.Setenv("PATH", t.TempDir()) // an empty directory: no explorer/open/xdg-open to find

	out := m.openDownloadDest("a.txt", p)
	if out.Result || !slices.Equal(codesOf(out.MessageList), []string{S3E016}) {
		t.Fatalf("%+v", out)
	}
}

func TestOpenDownloadDest_Success(t *testing.T) {
	m := newHistoryMng(t, newTestDB(t))
	p := writeFile(t, t.TempDir(), "a.txt", 1)

	name := map[string]string{"windows": "explorer.exe", "darwin": "open"}[runtime.GOOS]
	if name == "" {
		name = "xdg-open"
	}
	// PATH holds only a copy of this test binary under the opener's name. The copy exits at once
	// (see init), so the real Explorer / Finder / xdg-open is never started.
	dir, err := os.MkdirTemp("", "fake-opener")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		// The child may still be exiting (Windows can't delete a running exe), so retry briefly.
		var err error
		for range 50 {
			if err = os.RemoveAll(dir); err == nil {
				return
			}
			time.Sleep(100 * time.Millisecond)
		}
		t.Logf("cannot remove %s: %v", dir, err)
	})
	copyExecutable(t, filepath.Join(dir, name))
	argsFile := filepath.Join(dir, "args.txt")
	t.Setenv("PATH", dir)
	t.Setenv(fakeOpenerEnv, argsFile)

	if out := m.openDownloadDest("a.txt", p); !out.Result || len(out.MessageList) != 0 {
		t.Fatalf("%+v", out)
	}

	// Production does not Wait for the opener, so poll until the fake has written its arguments.
	var got []byte
	for range 100 {
		if got, err = os.ReadFile(argsFile); err == nil {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if err != nil {
		t.Fatalf("fake opener did not record its arguments: %v", err)
	}
	want := map[string]string{
		"windows": "/select,\n" + p,
		"darwin":  "-R\n" + p,
	}[runtime.GOOS]
	if want == "" {
		want = filepath.Dir(p)
	}
	if string(got) != want {
		t.Fatalf("opener args = %q, want %q", got, want)
	}
}

// copyExecutable copies the running test binary to dst (executable).
func copyExecutable(t *testing.T, dst string) {
	t.Helper()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	src, err := os.Open(exe)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = src.Close() }()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY, 0o755)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := io.Copy(out, src); err != nil {
		t.Fatal(err)
	}
	if err := out.Close(); err != nil {
		t.Fatal(err)
	}
}
