package bucket

// Branch table (C1) for uploader_expand.go. Each branch is covered by the named test.
//
// expandDropped
//   Lstat error                                  TestExpandDropped_Missing
//   symlink / special file (skipped)             TestExpandDropped_Symlink
//   directory (walk)                             TestExpandDropped_Folder
//   regular file                                 TestExpandDropped_Files
//   len(files) > limit: break / no break         TestExpandDropped_Truncated / _Files
//   truncate after loop / no truncate            TestExpandDropped_Truncated / _Files
// walkDropped
//   walk error                                   TestWalkDropped_Missing
//   directory entry                              TestExpandDropped_Folder
//   not regular (symlink)                        TestExpandDropped_Symlink
//   entryInfo error                              TestWalkDropped_InfoError
//   reached max (SkipAll) / below max            TestExpandDropped_Truncated / _Folder
//   entries cap reached / not reached            TestExpandDropped_EntriesCap / _Folder
// isVolumeRoot
//   root / normal folder                         TestExpandDropped_VolumeRoot / _Folder
// cleanRelKey
//   empty relKey -> file name                    TestCleanRelKey
//   contains \ or :                              TestCleanRelKey
//   empty, "." or ".." segment                   TestCleanRelKey
//   valid                                        TestCleanRelKey

import (
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"S3Browser/models"
)

func TestExpandDropped_Files(t *testing.T) {
	dir := t.TempDir()
	a := writeFile(t, dir, "a.txt", 3)
	b := writeFile(t, dir, "b.txt", 5)

	files, truncated, skipped := expandDropped([]string{a, b}, 5)
	if truncated || skipped != 0 || len(files) != 2 {
		t.Fatalf("got %v truncated=%v skipped=%d", files, truncated, skipped)
	}
	if files[0].RelKey != "a.txt" || files[0].Size != 3 || files[1].RelKey != "b.txt" || files[1].Size != 5 {
		t.Fatalf("unexpected files %+v", files)
	}
}

func TestExpandDropped_Missing(t *testing.T) {
	files, truncated, skipped := expandDropped([]string{filepath.Join(t.TempDir(), "nope")}, 5)
	if len(files) != 0 || truncated || skipped != 1 {
		t.Fatalf("got %v %v %d", files, truncated, skipped)
	}
}

func TestExpandDropped_Folder(t *testing.T) {
	dir := t.TempDir()
	root := filepath.Join(dir, "photos")
	writeFile(t, dir, "photos/a.jpg", 1)
	writeFile(t, dir, "photos/2026/b.jpg", 2)
	if err := os.MkdirAll(filepath.Join(root, "empty"), 0o755); err != nil {
		t.Fatal(err)
	}

	files, truncated, skipped := expandDropped([]string{root}, 5)
	var keys []string
	for _, f := range files {
		keys = append(keys, f.RelKey)
	}
	want := []string{"photos/2026/b.jpg", "photos/a.jpg"}
	if !reflect.DeepEqual(keys, want) || truncated || skipped != 0 {
		t.Fatalf("keys=%v truncated=%v skipped=%d", keys, truncated, skipped)
	}
}

func TestExpandDropped_Truncated(t *testing.T) {
	dir := t.TempDir()
	for _, n := range []string{"1", "2", "3", "4"} {
		writeFile(t, dir, "f/"+n, 1)
	}
	extra := writeFile(t, dir, "extra", 1)
	root := filepath.Join(dir, "f")

	// The folder holds 4 files; with limit 3 the walk stops at the 4th.
	files, truncated, _ := expandDropped([]string{root, extra}, 3)
	if !truncated || len(files) != 3 {
		t.Fatalf("got %d files truncated=%v", len(files), truncated)
	}

	// A file first, then a folder that goes over the limit.
	files, truncated, _ = expandDropped([]string{extra, root}, 3)
	if !truncated || len(files) != 3 || files[0].RelKey != "extra" {
		t.Fatalf("got %+v truncated=%v", files, truncated)
	}

	// Exactly limit files is not truncated.
	files, truncated, _ = expandDropped([]string{root}, 4)
	if truncated || len(files) != 4 {
		t.Fatalf("got %d files truncated=%v", len(files), truncated)
	}
}

func TestExpandDropped_Symlink(t *testing.T) {
	dir := t.TempDir()
	target := writeFile(t, dir, "real/a.txt", 1)
	link := filepath.Join(dir, "link.txt")
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("symlink not allowed here: %v", err)
	}
	if err := os.Symlink(target, filepath.Join(dir, "real", "inner.txt")); err != nil {
		t.Skipf("symlink not allowed here: %v", err)
	}

	// A symlink dropped directly and one inside a folder are both skipped.
	files, _, skipped := expandDropped([]string{link, filepath.Join(dir, "real")}, 5)
	if skipped != 2 || len(files) != 1 || files[0].RelKey != "real/a.txt" {
		t.Fatalf("got %+v skipped=%d", files, skipped)
	}
}

func TestExpandDropped_EntriesCap(t *testing.T) {
	dir := t.TempDir()
	for _, n := range []string{"1", "2", "3", "4", "5"} {
		writeFile(t, dir, "f/"+n, 1)
	}
	extra := writeFile(t, dir, "extra", 1)
	old := maxWalkEntries
	maxWalkEntries = 3 // the folder itself + 2 files
	t.Cleanup(func() { maxWalkEntries = old })

	// The walk stops at the cap: truncated, only the files found so far, later paths ignored.
	files, truncated, _ := expandDropped([]string{filepath.Join(dir, "f"), extra}, 100)
	if !truncated || len(files) != 2 {
		t.Fatalf("got %d files truncated=%v", len(files), truncated)
	}
}

func TestExpandDropped_VolumeRoot(t *testing.T) {
	root := filepath.VolumeName(t.TempDir()) + string(os.PathSeparator)
	files, truncated, skipped := expandDropped([]string{root}, 5)
	if len(files) != 0 || truncated || skipped != 1 {
		t.Fatalf("got %v %v %d", files, truncated, skipped)
	}
}

func TestWalkDropped_Missing(t *testing.T) {
	if skipped := walkDroppedForTest(filepath.Join(t.TempDir(), "nope")); skipped != 1 {
		t.Fatalf("skipped=%d", skipped)
	}
}

func TestWalkDropped_InfoError(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "f/a.txt", 1)
	old := entryInfo
	entryInfo = func(fs.DirEntry) (fs.FileInfo, error) { return nil, errBoom }
	t.Cleanup(func() { entryInfo = old })

	if skipped := walkDroppedForTest(filepath.Join(dir, "f")); skipped != 1 {
		t.Fatalf("skipped=%d", skipped)
	}
}

func TestCleanRelKey(t *testing.T) {
	tests := []struct {
		name, rel, path, want string
		ok                    bool
	}{
		{"empty falls back to base", "", filepath.Join("x", "a.txt"), "a.txt", true},
		{"nested", "dir/sub/a.txt", "", "dir/sub/a.txt", true},
		{"backslash", `dir\a.txt`, "", "", false},
		{"colon", "C:/a.txt", "", "", false},
		{"dot dot", "dir/../a.txt", "", "", false},
		{"dot", "./a.txt", "", "", false},
		{"absolute", "/a.txt", "", "", false},
		{"double slash", "dir//a.txt", "", "", false},
		{"empty path and key", "", "", "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := cleanRelKey(tt.rel, tt.path)
			if got != tt.want || ok != tt.ok {
				t.Fatalf("got %q %v", got, ok)
			}
		})
	}
}

// fakeEntry is a fs.DirEntry of a given type (e.g. a symlink, which can't be created
// without privileges on Windows).
type fakeEntry struct {
	fs.DirEntry
	mode fs.FileMode
}

func (e fakeEntry) IsDir() bool       { return e.mode.IsDir() }
func (e fakeEntry) Type() fs.FileMode { return e.mode.Type() }

func TestDropWalker_Visit(t *testing.T) {
	var files []models.DroppedFile
	w := &dropWalker{dir: "root", name: "root", files: &files, maxFiles: 5}

	if err := w.visit("root/link", fakeEntry{mode: fs.ModeSymlink}, nil); err != nil || w.skipped != 1 {
		t.Fatalf("symlink: err=%v skipped=%d", err, w.skipped)
	}
	if err := w.visit("root/dir", fakeEntry{mode: fs.ModeDir}, nil); err != nil || w.skipped != 1 || len(files) != 0 {
		t.Fatalf("dir: err=%v skipped=%d", err, w.skipped)
	}
}
