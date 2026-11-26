package bucket

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"S3Browser/models"
)

// expandResult chứa kết quả expandDropped tìm được.
type expandResult struct {
	groups  []models.DroppedGroup
	skipped int
	// total là tổng số file trong các nhóm.
	total int
	// overTotal là true nếu có nhiều hơn maxTotalFiles file; các file vượt quá bị bỏ qua.
	overTotal bool
	// capped là true nếu thư mục có nhiều hơn maxWalkEntries mục.
	capped bool
}

// expandDropped chuyển các đường dẫn được thả thành nhóm file. Một file tạo thành một mục có RelKey là tên file;
// thư mục được duyệt đệ quy và tạo một mục cho mỗi file thông thường, với RelKey = <tên thư mục>/<đường dẫn bên trong>
// (dùng dấu phân cách "/").
//
// Các file được nhóm theo thư mục chứa trực tiếp chúng (RelKey bỏ phần cuối; "" với file được thả trực tiếp):
// thư mục không có file trực tiếp nào sẽ không tạo thành nhóm. Bỏ qua và đếm symbolic link, file đặc biệt
// và các mục không đọc được.
//
// Duyệt toàn bộ cây thư mục nhưng dừng khi có nhiều hơn maxTotalFiles file (overTotal) hoặc khi một thư mục có
// nhiều hơn maxWalkEntries mục (capped); giữ lại các file đã tìm thấy. Bỏ qua khi người dùng thả thư mục gốc của ổ đĩa
// (ví dụ "C:\") vì không có tên thư mục để tạo RelKey.
func expandDropped(paths []string) expandResult {
	c := &dropCollector{index: map[string]int{}}

	for _, p := range paths {
		info, err := os.Lstat(p)
		switch {
		case err != nil || !info.Mode().IsRegular() && !info.IsDir():
			// Không đọc được, là symbolic link hoặc file đặc biệt (thiết bị, pipe, ...).
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

// dropCollector gom các file được thả thành từng nhóm.
type dropCollector struct {
	groups    []models.DroppedGroup
	index     map[string]int // group name -> position in groups
	skipped   int
	total     int
	overTotal bool
	capped    bool
}

// add thêm f vào nhóm tương ứng. Hàm trả false và không giữ thêm file nếu đã có maxTotalFiles file.
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

// relKeyDir trả về phần thư mục của relKey ("a/b/c.txt" -> "a/b") hoặc "" nếu không có.
func relKeyDir(relKey string) string {
	if i := strings.LastIndex(relKey, "/"); i >= 0 {
		return relKey[:i]
	}
	return ""
}

// maxWalkEntries là số mục tối đa (file, thư mục, symbolic link, lỗi) được duyệt trong một thư mục được thả.
const maxWalkEntries = 100_000

// isVolumeRoot cho biết p có phải thư mục gốc của hệ thống file như "C:\" hoặc "/" hay không: tên cơ sở của nó
// là dấu phân cách hoặc rỗng nên không thể lấy tên thư mục tạo RelKey.
func isVolumeRoot(p string) bool {
	base := filepath.Base(filepath.Clean(p))
	return base == "" || base == "." || os.IsPathSeparator(base[0])
}

// dropWalker gom các file thông thường bên trong một thư mục được thả.
type dropWalker struct {
	dir     string // cleaned folder path; every walked path starts with it
	name    string // folder name, the first segment of every RelKey
	c       *dropCollector
	skipped int
	visited int
	capped  bool // stopped because maxWalkEntries was reached
}

// walkDropped thêm các file thông thường bên trong dir vào c đến khi duyệt đủ maxWalkEntries mục hoặc c đã đầy.
// Hàm trả về số mục bị bỏ qua và cho biết có dừng vì chạm giới hạn số mục hay không.
func walkDropped(dir string, c *dropCollector) (skipped int, capped bool) {
	// WalkDir nối đường dẫn và chuẩn hóa chúng, vì vậy cần chuẩn hóa dir trước để bảo đảm mọi đường dẫn đều bắt đầu bằng dir.
	dir = filepath.Clean(dir)
	w := &dropWalker{dir: dir, name: filepath.Base(dir), c: c}
	_ = filepath.WalkDir(dir, w.visit)
	return w.skipped, w.capped
}

// visit là callback của WalkDir. Hàm không làm lượt duyệt thất bại, chỉ dừng khi đã đủ file.
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

// cleanRelKey trả về key của mục tải lên dưới prefix và false nếu key không an toàn: đoạn rỗng, đoạn "." / "..",
// đường dẫn tuyệt đối hoặc dấu gạch chéo ngược có thể thoát khỏi prefix hoặc tạo key sai. Nếu relKey rỗng,
// dùng tên file trong path.
func cleanRelKey(relKey, path string) (string, bool) {
	if relKey == "" {
		relKey = filepath.Base(path)
	}
	// Cấm '\' và ':' vì hiện chỉ hỗ trợ Windows (Q11); cần xem lại giới hạn này khi hỗ trợ macOS/Linux,
	// nơi các ký tự đó hợp lệ trong tên file.
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
