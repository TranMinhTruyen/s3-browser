package bucket

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"S3Browser/models"
)

// expandResult is what expandDropped found.
type expandResult struct {
	groups  []models.DroppedGroup
	skipped int
	// total is the number of files in groups.
	total int
	// overTotal is true when there were more than maxTotalFiles files; the extra are left out.
	overTotal bool
	// capped is true when a folder had more than maxWalkEntries entries.
	capped bool
}

// expandDropped turns the dropped paths into groups of files. A file gives one entry whose
// RelKey is its name; a folder is walked recursively and gives one entry per regular file,
// with RelKey = <folder name>/<path inside the folder> ("/" separators).
//
// The files are grouped by the folder that directly holds them (the RelKey without its
// last segment; "" for dropped files): a folder with no file of its own is no group.
// Symlinks, special files and entries that can't be read are skipped and counted.
//
// The whole tree is walked, but it stops once there are more than maxTotalFiles files
// (overTotal), or when a folder has more than maxWalkEntries entries (capped); the files
// found so far are kept. A drop of a volume root (e.g. "C:\") is skipped, as it has no
// folder name to build a RelKey from.
func expandDropped(paths []string) expandResult {
	c := &dropCollector{index: map[string]int{}}

	for _, p := range paths {
		info, err := os.Lstat(p)
		switch {
		case err != nil || !info.Mode().IsRegular() && !info.IsDir():
			// Unreadable, symlink or special file (device, pipe, ...).
			c.skipped++
		case info.IsDir():
			if isVolumeRoot(p) {
				c.skipped++
				break
			}
			n, capped := walkDropped(p, c)
			c.skipped += n
			if capped {
				c.capped = true
			}
		default:
			c.add(models.DroppedFile{Path: p, RelKey: filepath.Base(p), Size: info.Size()})
		}
		if c.overTotal || c.capped {
			break
		}
	}

	for i := range c.groups {
		g := &c.groups[i]
		g.TotalFiles = len(g.Files)
		g.OverMaxFiles = g.TotalFiles > maxFilesPerFolder
		g.OverLargeCount = g.LargeCount > largeFileMaxCount
	}
	return expandResult{
		groups: c.groups, skipped: c.skipped, total: c.total, overTotal: c.overTotal, capped: c.capped,
	}
}

// dropCollector gathers the dropped files into groups.
type dropCollector struct {
	groups    []models.DroppedGroup
	index     map[string]int // group name -> position in groups
	skipped   int
	total     int
	overTotal bool
	capped    bool
}

// add puts f in its group. It returns false, and keeps nothing, once maxTotalFiles files
// are already held.
func (c *dropCollector) add(f models.DroppedFile) bool {
	if c.total >= maxTotalFiles {
		c.overTotal = true
		return false
	}
	f.IsLarge = f.Size > largeFileSize
	name := relKeyDir(f.RelKey)
	i, ok := c.index[name]
	if !ok {
		i = len(c.groups)
		c.index[name] = i
		c.groups = append(c.groups, models.DroppedGroup{Name: name})
	}
	g := &c.groups[i]
	g.Files = append(g.Files, f)
	if f.IsLarge {
		g.LargeCount++
	}
	c.total++
	return true
}

// relKeyDir returns the folder part of relKey ("a/b/c.txt" -> "a/b"), or "" if it has none.
func relKeyDir(relKey string) string {
	if i := strings.LastIndex(relKey, "/"); i >= 0 {
		return relKey[:i]
	}
	return ""
}

// maxWalkEntries is the most entries (files, folders, symlinks, errors) visited in one
// dropped folder.
const maxWalkEntries = 100_000

// isVolumeRoot reports whether p is a filesystem root such as "C:\" or "/": its base name
// is a separator or empty, so there is no folder name for the RelKey.
func isVolumeRoot(p string) bool {
	base := filepath.Base(filepath.Clean(p))
	return base == "" || base == "." || os.IsPathSeparator(base[0])
}

// dropWalker collects the regular files under one dropped folder.
type dropWalker struct {
	dir     string // cleaned folder path; every walked path starts with it
	name    string // folder name, the first segment of every RelKey
	c       *dropCollector
	skipped int
	visited int
	capped  bool // stopped because maxWalkEntries was reached
}

// walkDropped adds the regular files under dir to c until maxWalkEntries entries were
// visited or c is full. It returns how many entries were skipped, and whether the walk
// stopped because of the entries cap.
func walkDropped(dir string, c *dropCollector) (skipped int, capped bool) {
	// WalkDir joins (and so cleans) paths, so clean dir first to be sure every path starts with it.
	dir = filepath.Clean(dir)
	w := &dropWalker{dir: dir, name: filepath.Base(dir), c: c}
	_ = filepath.WalkDir(dir, w.visit)
	return w.skipped, w.capped
}

// visit is the WalkDir callback. It never fails the walk, except to stop it once full.
func (w *dropWalker) visit(path string, d fs.DirEntry, err error) error {
	w.visited++
	if w.visited > maxWalkEntries {
		w.capped = true
		return filepath.SkipAll
	}
	switch {
	case err != nil:
		w.skipped++
		return nil
	case d.IsDir():
		return nil
	case !d.Type().IsRegular():
		w.skipped++
		return nil
	}

	info, err := d.Info()
	if err != nil {
		w.skipped++
		return nil
	}
	if !w.c.add(models.DroppedFile{
		Path:   path,
		RelKey: w.name + filepath.ToSlash(strings.TrimPrefix(path, w.dir)),
		Size:   info.Size(),
	}) {
		return filepath.SkipAll
	}
	return nil
}

// cleanRelKey returns the key an upload item gets under the prefix, and false if it is
// not safe: empty segments, "." / ".." segments, absolute paths or backslashes could
// escape the prefix or make a bad key. An empty relKey falls back to the file name of path.
func cleanRelKey(relKey, path string) (string, bool) {
	if relKey == "" {
		relKey = filepath.Base(path)
	}
	// '\' and ':' are banned because only Windows is supported (Q11); review this when
	// macOS/Linux are supported, where they are valid file name characters.
	if strings.ContainsAny(relKey, `\:`) {
		return "", false
	}
	for seg := range strings.SplitSeq(relKey, "/") {
		if seg == "" || seg == "." || seg == ".." {
			return "", false
		}
	}
	return relKey, true
}
