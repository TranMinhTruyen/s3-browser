package bucket

// Branch table (C1) for uploader_expand.go. Each branch is covered by the named test.
//
// expandDropped
//   Lstat error                                  TestExpandDropped_Missing
//   symlink / special file (skipped)             TestExpandDropped_Symlink
//   directory (walk)                             TestExpandDropped_Folder
//   regular file                                 TestExpandDropped_Files
//   overTotal / capped: break; neither: go on    TestExpandDropped_TotalCap / _EntriesCap / _Files
//   group flags over / not over                  TestExpandDropped_GroupFlags
// dropCollector.add: total full / room, new / known group, large / small
//                                                TestExpandDropped_TotalCap / _Nested / _GroupFlags
// relKeyDir: with / without folder               TestExpandDropped_Nested
// walkDropped
//   walk error                                   TestWalkDropped_Missing
//   directory entry                              TestExpandDropped_Folder
//   not regular (symlink)                        TestExpandDropped_Symlink
//   entryInfo error                              TestWalkDropped_InfoError
//   collector full (SkipAll) / room              TestExpandDropped_TotalCap / _Folder
//   entries cap reached / not reached            TestExpandDropped_EntriesCap / _Folder
// isVolumeRoot
//   root / normal folder                         TestExpandDropped_VolumeRoot / _Folder
// cleanRelKey
//   empty relKey -> file name                    TestCleanRelKey
//   contains \ or :                              TestCleanRelKey
//   empty, "." or ".." segment                   TestCleanRelKey
//   valid                                        TestCleanRelKey

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"S3Browser/models"
)

// groupNames returns the names of the groups, in order.
func groupNames(groups []models.DroppedGroup) []string {
	names := []string{}
	for _, g := range groups {
		names = append(names, g.Name)
	}
	return names
}

func TestExpandDropped_Files(t *testing.T) {
	dir := t.TempDir()
	a := writeFile(t, dir, "a.txt", 3)
	b := writeFile(t, dir, "b.txt", 5)

	res := expandDropped([]string{a, b})
	if res.overTotal || res.capped || res.skipped != 0 || len(res.groups) != 1 || res.total != 2 {
		t.Fatalf("got %+v", res)
	}
	g := res.groups[0]
	if g.Name != "" || g.TotalFiles != 2 || g.Files[0].RelKey != "a.txt" || g.Files[0].Size != 3 ||
		g.Files[1].RelKey != "b.txt" || g.Files[1].Size != 5 {
		t.Fatalf("unexpected group %+v", g)
	}
}

func TestExpandDropped_Missing(t *testing.T) {
	res := expandDropped([]string{filepath.Join(t.TempDir(), "nope")})
	if len(res.groups) != 0 || res.overTotal || res.skipped != 1 {
		t.Fatalf("got %+v", res)
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

	res := expandDropped([]string{root})
	// WalkDir is lexical: "2026" comes before "a.jpg".
	if want := []string{"photos/2026", "photos"}; !reflect.DeepEqual(groupNames(res.groups), want) ||
		res.overTotal || res.skipped != 0 || res.total != 2 {
		t.Fatalf("groups=%v res=%+v", groupNames(res.groups), res)
	}
	if res.groups[0].Files[0].RelKey != "photos/2026/b.jpg" || res.groups[1].Files[0].RelKey != "photos/a.jpg" {
		t.Fatalf("%+v", res.groups)
	}
}

func TestExpandDropped_Nested(t *testing.T) {
	dir := t.TempDir()
	root := filepath.Join(dir, "top")
	// "top" and "top/a" hold only folders and "top/empty" holds nothing: they are no group.
	// Only the folders that directly hold files are groups, however deep.
	writeFile(t, dir, "top/a/b/c/1.txt", 1)
	writeFile(t, dir, "top/a/b/c/2.txt", 1)
	writeFile(t, dir, "top/d/3.txt", 1)
	writeFile(t, dir, "top/a/b/4.txt", 1)
	if err := os.MkdirAll(filepath.Join(root, "empty"), 0o755); err != nil {
		t.Fatal(err)
	}
	loose := writeFile(t, dir, "loose.txt", 1)

	res := expandDropped([]string{root, loose})
	want := []string{"top/a/b", "top/a/b/c", "top/d", ""}
	if got := groupNames(res.groups); !reflect.DeepEqual(got, want) || res.total != 5 {
		t.Fatalf("groups=%v total=%d", got, res.total)
	}
	if res.groups[1].TotalFiles != 2 || res.groups[3].Files[0].RelKey != "loose.txt" {
		t.Fatalf("%+v", res.groups)
	}
}

func TestExpandDropped_GroupFlags(t *testing.T) {
	useLargeFileSize(t, 100)
	dir := t.TempDir()
	// Group "many": 51 small files. Group "big": 5 large files (sparse, so cheap).
	// Group "ok": exactly 50 files, 4 of them large.
	for i := range maxFilesPerFolder + 1 {
		writeFile(t, dir, fmt.Sprintf("r/many/%03d", i), 1)
	}
	for i := range largeFileMaxCount + 1 {
		writeFile(t, dir, fmt.Sprintf("r/big/%d", i), largeFileSize+1)
	}
	for i := range maxFilesPerFolder {
		size := int64(1)
		if i < largeFileMaxCount {
			size = largeFileSize + 1
		}
		writeFile(t, dir, fmt.Sprintf("r/ok/%03d", i), size)
	}

	res := expandDropped([]string{filepath.Join(dir, "r")})
	byName := map[string]models.DroppedGroup{}
	for _, g := range res.groups {
		byName[g.Name] = g
	}
	many, big, ok := byName["r/many"], byName["r/big"], byName["r/ok"]
	if many.TotalFiles != 51 || !many.OverMaxFiles || many.OverLargeCount || many.LargeCount != 0 {
		t.Fatalf("many=%d", many.TotalFiles)
	}
	if big.TotalFiles != 5 || big.LargeCount != 5 || big.OverMaxFiles || !big.OverLargeCount || !big.Files[0].IsLarge {
		t.Fatalf("big=%d large=%d", big.TotalFiles, big.LargeCount)
	}
	if ok.TotalFiles != 50 || ok.LargeCount != 4 || ok.OverMaxFiles || ok.OverLargeCount {
		t.Fatalf("ok=%d large=%d", ok.TotalFiles, ok.LargeCount)
	}
}

func TestExpandDropped_TotalCap(t *testing.T) {
	dir := t.TempDir()
	// 21 folders of 50 files = 1050 files; a later path must be ignored once the cap is hit.
	for f := range 21 {
		for i := range maxFilesPerFolder {
			writeFile(t, dir, fmt.Sprintf("r/d%02d/%02d", f, i), 1)
		}
	}
	extra := writeFile(t, dir, "extra", 1)

	res := expandDropped([]string{filepath.Join(dir, "r"), extra})
	if !res.overTotal || res.total != maxTotalFiles {
		t.Fatalf("total=%d over=%v", res.total, res.overTotal)
	}
	count := 0
	for _, g := range res.groups {
		count += len(g.Files)
		if g.Name == "" {
			t.Fatal("extra must be ignored")
		}
	}
	if count != maxTotalFiles {
		t.Fatalf("count=%d", count)
	}

	// A folder of 50 files is under the cap.
	res = expandDropped([]string{filepath.Join(dir, "r", "d00")})
	if res.overTotal || res.total != maxFilesPerFolder {
		t.Fatalf("total=%d over=%v", res.total, res.overTotal)
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
	res := expandDropped([]string{link, filepath.Join(dir, "real")})
	if res.skipped != 2 || res.total != 1 || res.groups[0].Files[0].RelKey != "real/a.txt" {
		t.Fatalf("got %+v", res)
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

	// The walk stops at the cap: only the files found so far, later paths ignored.
	res := expandDropped([]string{filepath.Join(dir, "f"), extra})
	if !res.capped || res.total != 2 || len(res.groups) != 1 {
		t.Fatalf("got %+v", res)
	}
}

func TestExpandDropped_VolumeRoot(t *testing.T) {
	root := filepath.VolumeName(t.TempDir()) + string(os.PathSeparator)
	res := expandDropped([]string{root})
	if len(res.groups) != 0 || res.overTotal || res.skipped != 1 {
		t.Fatalf("got %+v", res)
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
	c := &dropCollector{index: map[string]int{}}
	w := &dropWalker{dir: "root", name: "root", c: c}

	if err := w.visit("root/link", fakeEntry{mode: fs.ModeSymlink}, nil); err != nil || w.skipped != 1 {
		t.Fatalf("symlink: err=%v skipped=%d", err, w.skipped)
	}
	if err := w.visit("root/dir", fakeEntry{mode: fs.ModeDir}, nil); err != nil || w.skipped != 1 || c.total != 0 {
		t.Fatalf("dir: err=%v skipped=%d", err, w.skipped)
	}
}
