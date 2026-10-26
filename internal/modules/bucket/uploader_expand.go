package bucket

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"S3Browser/models"
)

// expandDropped turns the dropped paths into the files to upload. A file gives one entry
// whose RelKey is its name; a folder is walked recursively and gives one entry per regular
// file, with RelKey = <folder name>/<path inside the folder> ("/" separators).
// Empty folders add nothing. Symlinks, special files and entries that can't be read are
// skipped and counted in skipped.
//
// It stops as soon as limit+1 files are found: that is enough to know the drop is larger
// than limit, so big folders aren't walked to the end. Then truncated is true and files
// holds the first limit files, in drop order (folders in lexical order).
//
// A folder with more than maxWalkEntries entries is not walked to the end either: the walk
// stops and the result is truncated too, keeping only the files found so far. A drop of a
// volume root (e.g. "C:\") is skipped, as it has no folder name to build a RelKey from.
func expandDropped(paths []string, limit int) (files []models.DroppedFile, truncated bool, skipped int) {
	files = make([]models.DroppedFile, 0, limit+1)

	for _, p := range paths {
		info, err := os.Lstat(p)
		switch {
		case err != nil || !info.Mode().IsRegular() && !info.IsDir():
			// Unreadable, symlink or special file (device, pipe, ...).
			skipped++
		case info.IsDir():
			if isVolumeRoot(p) {
				skipped++
				break
			}
			n, capped := walkDropped(p, &files, limit+1)
			skipped += n
			if capped {
				truncated = true
			}
		default:
			files = append(files, models.DroppedFile{Path: p, RelKey: filepath.Base(p), Size: info.Size()})
		}
		if len(files) > limit || truncated {
			break
		}
	}

	if len(files) > limit {
		files = files[:limit]
		truncated = true
	}
	return files, truncated, skipped
}

// maxWalkEntries is the most entries (files, folders, symlinks, errors) visited in one
// dropped folder. It is a variable so tests can lower it.
var maxWalkEntries = 100_000

// isVolumeRoot reports whether p is a filesystem root such as "C:\" or "/": its base name
// is a separator or empty, so there is no folder name for the RelKey.
func isVolumeRoot(p string) bool {
	base := filepath.Base(filepath.Clean(p))
	return base == "" || base == "." || os.IsPathSeparator(base[0])
}

// entryInfo reads the file info of a directory entry. It is a variable so tests can
// make it fail, which only happens in real life when a file vanishes during the walk.
var entryInfo = func(d fs.DirEntry) (fs.FileInfo, error) { return d.Info() }

// dropWalker collects the regular files under one dropped folder.
type dropWalker struct {
	dir      string // cleaned folder path; every walked path starts with it
	name     string // folder name, the first segment of every RelKey
	files    *[]models.DroppedFile
	maxFiles int
	skipped  int
	visited  int
	capped   bool // stopped because maxWalkEntries was reached
}

// walkDropped appends the regular files under dir to files until files holds maxFiles
// entries or maxWalkEntries entries were visited. It returns how many entries were skipped,
// and whether the walk stopped because of the entries cap.
func walkDropped(dir string, files *[]models.DroppedFile, maxFiles int) (skipped int, capped bool) {
	// WalkDir joins (and so cleans) paths, so clean dir first to be sure every path starts with it.
	dir = filepath.Clean(dir)
	w := &dropWalker{dir: dir, name: filepath.Base(dir), files: files, maxFiles: maxFiles}
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

	info, err := entryInfo(d)
	if err != nil {
		w.skipped++
		return nil
	}
	*w.files = append(*w.files, models.DroppedFile{
		Path:   path,
		RelKey: w.name + filepath.ToSlash(strings.TrimPrefix(path, w.dir)),
		Size:   info.Size(),
	})
	if len(*w.files) >= w.maxFiles {
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
	// '' and ':' are banned because only Windows is supported (Q11); review this when
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
