package bucket

import (
	"S3Browser/internal/pkg/cnst"
	"S3Browser/models"
	"context"
	"os"
	"strings"

	"github.com/aws/aws-sdk-go-v2/service/s3"
	"golang.org/x/sync/errgroup"
)

// cleanUploadItems trả bản sao của items, trong đó mỗi mục có RelKey an toàn. Nếu RelKey không an toàn,
// hàm trả về đường dẫn của mục đó trong badPath.
func cleanUploadItems(items []models.UploadObj) (clean []models.UploadObj, badPath string) {
	clean = make([]models.UploadObj, len(items))
	for i, item := range items {
		rel, ok := cleanRelKey(item.RelKey, item.Path)
		if !ok {
			return nil, item.Path
		}
		item.RelKey = rel
		clean[i] = item
	}
	return clean, ""
}

// groupUploadItems nhóm chỉ mục của items theo thư mục trong RelKey, theo thứ tự xuất hiện đầu tiên, rồi kiểm tra
// giới hạn từng nhóm. Kích thước được đọc từ đĩa; file không đọc được được tính là file nhỏ (lượt tải sẽ báo lỗi).
// Nếu vượt giới hạn, hàm trả thông báo lỗi tương ứng.
func groupUploadItems(items []models.UploadObj) (groups [][]int, violation []models.Message) {
	pos := map[string]int{}
	names := []string{}
	for i, item := range items {
		dir := relKeyDir(item.RelKey)
		p, ok := pos[dir]
		if !ok {
			p = len(groups)
			pos[dir] = p
			names = append(names, dir)
			groups = append(groups, nil)
		}
		groups[p] = append(groups[p], i)
	}

	for p, indexes := range groups {
		if len(indexes) > maxFilesPerFolder {
			return nil, []models.Message{
				models.NewParamsMessage(cnst.MessageTypeError, cnst.Bucket, S3E018, "", map[string]any{
					"folder": names[p],
					"max":    maxFilesPerFolder,
				}),
			}
		}
		large := 0
		for _, i := range indexes {
			// Cố ý xử lý tuần tự: tối đa maxTotalFiles lần stat nhẹ, xử lý song song không đáng để tăng độ phức tạp.
			if info, err := os.Stat(items[i].Path); err == nil && info.Size() > largeFileSize {
				large++
			}
		}
		if large > largeFileMaxCount {
			return nil, []models.Message{
				models.NewParamsMessage(cnst.MessageTypeError, cnst.Bucket, S3E022, "", map[string]any{
					"folder": names[p],
					"max":    largeFileMaxCount,
					"size":   largeFileSize >> 30,
				}),
			}
		}
	}
	return groups, nil
}

// renameKey thêm id trước tên file trong relKey và giữ nguyên thư mục:
// "a/b/c.txt" -> "a/b/<id>_c.txt".
func renameKey(relKey, id string) string {
	dir, name := "", relKey
	if i := strings.LastIndex(relKey, "/"); i >= 0 {
		dir, name = relKey[:i+1], relKey[i+1:]
	}
	return dir + id + "_" + name
}

// normalizePrefix chuẩn hóa p thành định dạng dùng cho key: bỏ dấu "/" đầu, thêm dấu "/" cuối trừ khi rỗng
// (gốc bucket). Dấu phân cách của Windows được đổi thành "/".
func normalizePrefix(p string) string {
	p = strings.TrimLeft(strings.ReplaceAll(p, `\`, "/"), "/")
	if p != "" && !strings.HasSuffix(p, "/") {
		p += "/"
	}
	return p
}

// existingKeys kiểm tra từng mục, tối đa uploadFileConcurrency mục cùng lúc, xem object có key prefix + RelKey đã tồn tại
// trong bucket hay chưa. Mỗi RelKey riêng biệt chỉ được kiểm tra một lần. Hàm trả về các RelKey (không gồm prefix),
// trừ những key nhận phản hồi 404 từ bucket. Key không kiểm tra được sẽ được xem như đã tồn tại, để file được đổi tên
// thay vì ghi đè dữ liệu.
func existingKeys(
	ctx context.Context,
	client *s3.Client,
	bucket, prefix string,
	items []models.UploadObj,
) map[string]struct{} {
	var names []string
	seen := make(map[string]struct{}, len(items))
	for _, item := range items {
		if _, ok := seen[item.RelKey]; !ok {
			seen[item.RelKey] = struct{}{}
			names = append(names, item.RelKey)
		}
	}

	// Mỗi goroutine chỉ ghi vào vị trí riêng nên không cần khóa.
	errs := make([]error, len(names))
	var g errgroup.Group
	g.SetLimit(uploadFileConcurrency)
	for i, name := range names {
		g.Go(func() error {
			key := prefix + name
			_, errs[i] = client.HeadObject(ctx, &s3.HeadObjectInput{Bucket: &bucket, Key: &key})
			return nil
		})
	}
	_ = g.Wait()

	existing := make(map[string]struct{}, len(items))
	for i, name := range names {
		if errs[i] != nil && UnwrapAwsError(errs[i]) == "NotFound" {
			continue
		}
		existing[name] = struct{}{}
	}
	return existing
}
