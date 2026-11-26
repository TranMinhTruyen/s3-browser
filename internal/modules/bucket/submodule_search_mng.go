package bucket

import (
	"S3Browser/internal/modules/global"
	"S3Browser/internal/pkg/cnst"
	"S3Browser/models"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	// searchMaxResults là số kết quả khớp tối đa trả về trong một lần gọi.
	searchMaxResults = 100
	// searchPageSize là số key được yêu cầu trong mỗi trang ListObjectsV2.
	searchPageSize = 1000
	// searchMaxPages là số trang tối đa được quét trong một lần gọi.
	searchMaxPages = 20
	// searchBucketCallTimeout giới hạn thời gian của mỗi lần gọi ListBuckets.
	searchBucketCallTimeout = 10 * time.Second
)

// submoduleSearchMng tìm object và bucket theo từ khóa, lần lượt qua từng trang.
type submoduleSearchMng struct {
	logger *slog.Logger
	app    *application.App
	global *global.Module
}

// newSubmoduleSearchMng tạo submodule tìm kiếm trên kho kết nối dùng chung.
func newSubmoduleSearchMng(
	app *application.App,
	logger *slog.Logger,
	global *global.Module,
) *submoduleSearchMng {
	return &submoduleSearchMng{
		logger: logger.With("submodules", "search_mng"),
		app:    app,
		global: global,
	}
}

// searchObject quét thư mục input.Prefix (không đệ quy) để tìm key chứa input.Keyword,
// không phân biệt chữ hoa/thường và trả về tối đa searchMaxResults kết quả.
// input.NextCursor là key StartAfter để tiếp tục (để trống nếu bắt đầu lại). NextCursor trả về là vị trí
// lần gọi tiếp theo cần tiếp tục; chỉ rỗng khi không còn gì để quét.
// ctx là context của lời gọi; frontend sẽ hủy context khi người dùng hủy lời gọi.
func (m *submoduleSearchMng) searchObject(
	ctx context.Context,
	input models.SearchObjectInput,
) models.Output[models.SearchObjectOutput] {
	ctx, cancel := withCallContext(ctx, m.app.Context(), 5*time.Minute)
	defer cancel()

	output := models.NewOutput[models.SearchObjectOutput]()

	keyword := strings.ToLower(strings.TrimSpace(input.Keyword))
	if keyword == "" {
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Bucket, S3E028, ""))
	}

	s3Conn, ok := m.global.GetConnContainer(input.ConnectionId)
	if !ok {
		return output.ThrowError(notConnectedMessage(input.ProfileName))
	}

	body := models.SearchObjectOutput{ObjectList: make([]models.ObjectItem, 0, searchMaxResults)}
	cursor := input.NextCursor
	done := false

	for range searchMaxPages {
		listInput := &s3.ListObjectsV2Input{
			Bucket:    &input.Bucket,
			Prefix:    &input.Prefix,
			Delimiter: aws.String("/"),
			MaxKeys:   aws.Int32(searchPageSize),
		}
		if cursor != "" {
			listInput.StartAfter = &cursor
		}

		page, err := s3Conn.Client.ListObjectsV2(ctx, listInput)
		if err != nil {
			if isCallCanceled(ctx) {
				// Frontend đã hủy: dừng im lặng vì không còn bên nào chờ kết quả.
				return output.ThrowError()
			}

			return output.ThrowError(
				models.NewParamsMessage(
					cnst.MessageTypeError,
					cnst.Bucket,
					S3E026,
					UnwrapAwsError(err),
					map[string]any{
						"name":   input.ProfileName,
						"bucket": input.Bucket,
					},
				),
			)
		}

		truncated := aws.ToBool(page.IsTruncated)
		before := cursor
		forEachKey(page, input.Prefix, func(key string, isFolder, isLast bool, item func() models.ObjectItem) bool {
			// Cursor luôn chuyển qua key gốc, kể cả khi key bị bộ lọc loại bỏ.
			cursor = key
			if isFolder {
				cursor = strings.TrimSuffix(key, "/") + "0"
			}
			if containsFold(key, keyword) {
				body.ObjectList = append(body.ObjectList, item())
			}
			if len(body.ObjectList) < searchMaxResults {
				return true
			}
			// Dừng ngay tại mục này, kể cả khi đang ở giữa trang.
			// Chỉ không còn kết quả nếu đây là mục cuối cùng của trang cuối.
			if isLast && !truncated {
				cursor = ""
			}
			done = true
			return false
		})
		if done {
			body.NextCursor = cursor
			output.Body = body
			return output
		}

		if !truncated || cursor == before {
			// Đã hết dữ liệu (hoặc trang không có key để tiếp tục, nếu không sẽ lặp vô hạn).
			cursor = ""
			break
		}
	}

	// Đã hết dữ liệu (cursor rỗng) hoặc chạm giới hạn trang: tiếp tục từ key cuối cùng đã kiểm tra.
	body.NextCursor = cursor
	output.Body = body
	return output
}

// forEachKey duyệt thư mục (CommonPrefixes) và file (Contents) trong trang theo thứ tự key mà S3 liệt kê,
// bằng cách trộn hai danh sách đã sắp xếp. Bỏ qua key rỗng và dấu thư mục (key == prefix).
// item tạo ObjectItem theo nhu cầu để chỉ các kết quả khớp mới phải xử lý. visit trả false để dừng.
func forEachKey(
	page *s3.ListObjectsV2Output,
	prefix string,
	visit func(key string, isFolder, isLast bool, item func() models.ObjectItem) bool,
) {
	folders, files := page.CommonPrefixes, page.Contents
	i, j := 0, 0
	for i < len(folders) || j < len(files) {
		var key string
		// Provider tương thích S3 có thể bỏ qua trường tùy chọn, vì vậy hãy đọc chúng qua aws.ToX.
		isFolder := j >= len(files) ||
			(i < len(folders) && aws.ToString(folders[i].Prefix) < aws.ToString(files[j].Key))
		var item func() models.ObjectItem
		if isFolder {
			key = aws.ToString(folders[i].Prefix)
			item = func() models.ObjectItem {
				return models.ObjectItem{
					Key:      key,
					Name:     strings.TrimSuffix(strings.TrimPrefix(key, prefix), "/"),
					IsFolder: true,
				}
			}
			i++
		} else {
			o := files[j]
			key = aws.ToString(o.Key)
			item = func() models.ObjectItem {
				return models.ObjectItem{
					Key:          key,
					Name:         strings.TrimPrefix(key, prefix),
					Size:         aws.ToInt64(o.Size),
					LastModified: aws.ToTime(o.LastModified),
					ETag:         aws.ToString(o.ETag),
				}
			}
			j++
		}
		if key == "" || (!isFolder && key == prefix) {
			continue
		}
		if !visit(key, isFolder, i >= len(folders) && j >= len(files), item) {
			return
		}
	}
}

// containsFold cho biết s có chứa lowerSub (đã chuyển thành chữ thường) hay không, không phân biệt hoa/thường.
// Nếu chuỗi chỉ có ASCII thì so sánh không cần cấp phát bộ nhớ; trường hợp khác dùng strings.ToLower.
func containsFold(s, lowerSub string) bool {
	for k := 0; k < len(s); k++ {
		if s[k] >= utf8.RuneSelf {
			return strings.Contains(strings.ToLower(s), lowerSub)
		}
	}

	n := len(lowerSub)
	for k := 0; k+n <= len(s); k++ {
		m := 0
		for ; m < n; m++ {
			c := s[k+m]
			if 'A' <= c && c <= 'Z' {
				c += 'a' - 'A'
			}
			if c != lowerSub[m] {
				break
			}
		}
		if m == n {
			return true
		}
	}
	return false
}

// bucketCursor là SearchBucketInput.NextCursor sau khi giải mã: trang ListBuckets cần gọi lại
// (Token, rỗng ở trang đầu) và số bucket đã kiểm tra trong trang đó (Skip).
type bucketCursor struct {
	Token string `json:"token"`
	Skip  int    `json:"skip"`
}

// encodeBucketCursor chuyển c thành chuỗi opaque để frontend gửi lại trong NextCursor.
func encodeBucketCursor(c bucketCursor) string {
	data, _ := json.Marshal(c)
	return base64.RawURLEncoding.EncodeToString(data)
}

// decodeBucketCursor phân tích cursor do encodeBucketCursor tạo; chuỗi rỗng nghĩa là trang đầu tiên.
func decodeBucketCursor(s string) (bucketCursor, error) {
	var c bucketCursor
	if s == "" {
		return c, nil
	}
	data, err := base64.RawURLEncoding.DecodeString(s)
	if err == nil {
		err = json.Unmarshal(data, &c)
	}
	if err == nil && c.Skip < 0 {
		err = fmt.Errorf("negative skip %d", c.Skip)
	}
	return c, err
}

// searchBucket quét bucket để tìm tên chứa input.Keyword, không phân biệt chữ hoa/thường, và trả về tối đa
// searchMaxResults kết quả. ListBuckets không có StartAfter nên NextCursor là cặp opaque {token, skip}:
// liệt kê lại trang có token rồi bỏ qua số bucket đã kiểm tra.
// NextCursor trả về chỉ rỗng khi không còn gì để quét và luôn tiến về phía trước.
// input.NextCursor không hợp lệ sẽ bị từ chối bằng S3E027 (không âm thầm bắt đầu lại để tránh vòng lặp vô hạn).
func (m *submoduleSearchMng) searchBucket(
	ctx context.Context,
	input models.SearchBucketInput,
) models.Output[models.SearchBucketOutput] {
	// Không đặt timeout tổng thể: mỗi lần gọi ListBuckets đã có timeout riêng (searchBucketCallTimeout).
	ctx, cancel := withCallContext(ctx, m.app.Context(), 0)
	defer cancel()

	output := models.NewOutput[models.SearchBucketOutput]()
	failure := func(detail string) models.Output[models.SearchBucketOutput] {
		return output.ThrowError(
			models.NewParamsMessage(cnst.MessageTypeError, cnst.Bucket, S3E027, detail, map[string]any{
				"name": input.ProfileName,
			}),
		)
	}

	keyword := strings.ToLower(strings.TrimSpace(input.Keyword))
	if keyword == "" {
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Bucket, S3E028, ""))
	}

	cur, err := decodeBucketCursor(input.NextCursor)
	if err != nil {
		return failure("invalid cursor: " + err.Error())
	}

	s3Conn, ok := m.global.GetConnContainer(input.ConnectionId)
	if !ok {
		return output.ThrowError(notConnectedMessage(input.ProfileName))
	}

	if s3Conn.AuthType == cnst.AuthAnonymous {
		buckets := anonymousBuckets(s3Conn, keyword)
		output.Body.BucketList = buckets[:min(len(buckets), searchMaxResults)]
		if !flagBucketAccess(ctx, s3Conn, output.Body.BucketList, input.CheckWrite, input.LazyAccess, false) {
			return output.ThrowError()
		}
		return output
	}

	body := models.SearchBucketOutput{BucketList: make([]models.Bucket, 0, searchMaxResults)}
	// finish đánh dấu các bucket không truy cập được trong những kết quả sẽ trả về (không phải mọi bucket đã quét).
	finish := func() models.Output[models.SearchBucketOutput] {
		if !flagBucketAccess(ctx, s3Conn, body.BucketList, input.CheckWrite, input.LazyAccess, false) {
			return output.ThrowError()
		}
		output.Body = body
		return output
	}

	for range searchMaxPages {
		listInput := &s3.ListBucketsInput{MaxBuckets: aws.Int32(searchPageSize)}
		if cur.Token != "" {
			listInput.ContinuationToken = &cur.Token
		}

		callCtx, cancelCall := context.WithTimeout(ctx, searchBucketCallTimeout)
		page, err := s3Conn.Client.ListBuckets(callCtx, listInput)
		cancelCall()
		if err != nil {
			if isCallCanceled(ctx) {
				// Frontend đã hủy: dừng im lặng vì không còn bên nào chờ kết quả.
				return output.ThrowError()
			}
			return failure(UnwrapAwsError(err))
		}

		// Provider có thể bỏ token và trả về tất cả kết quả cùng lúc; khi đó đây là trang cuối.
		next := aws.ToString(page.ContinuationToken)
		if next == cur.Token {
			next = ""
		}

		for i := min(cur.Skip, len(page.Buckets)); i < len(page.Buckets); i++ {
			name := aws.ToString(page.Buckets[i].Name)
			if !containsFold(name, keyword) {
				continue
			}
			body.BucketList = append(body.BucketList, models.Bucket{
				Name:         name,
				CreationDate: aws.ToTime(page.Buckets[i].CreationDate),
			})
			if len(body.BucketList) < searchMaxResults {
				continue
			}
			// Dừng ngay tại bucket này, kể cả khi đang ở giữa trang.
			switch {
			case i+1 < len(page.Buckets):
				body.NextCursor = encodeBucketCursor(bucketCursor{Token: cur.Token, Skip: i + 1})
			case next != "":
				body.NextCursor = encodeBucketCursor(bucketCursor{Token: next})
			}
			return finish()
		}

		if next == "" {
			return finish()
		}
		cur = bucketCursor{Token: next}
	}

	// Đã chạm giới hạn trang: tiếp tục từ trang kế tiếp.
	body.NextCursor = encodeBucketCursor(cur)
	return finish()
}
