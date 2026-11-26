package bucket

import (
	"S3Browser/internal/modules/global"
	"S3Browser/internal/pkg/cnst"
	"S3Browser/models"
	"bytes"
	"context"
	"crypto/md5"
	"encoding/base64"
	"log/slog"
	"net/http"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/minio/madmin-go/v4"
	"github.com/minio/pkg/v3/policy"
	"github.com/wailsapp/wails/v3/pkg/application"
	"golang.org/x/sync/errgroup"
)

const (
	// bucketProbeConcurrency là số phép thử HeadBucket / PutObject tối đa chạy đồng thời khi đánh dấu bucket.
	bucketProbeConcurrency = 16
	// bucketProbeTimeout giới hạn thời gian kiểm tra quyền truy cập cho toàn bộ một lần liệt kê.
	bucketProbeTimeout = 4 * time.Second
	// writeProbeKey là key dùng để thử quyền ghi; Content-MD5 sai khiến object không được lưu.
	writeProbeKey = ".s3b-write-probe"
)

// submoduleBucketMng liệt kê các bucket của một kết nối.
type submoduleBucketMng struct {
	logger *slog.Logger
	app    *application.App
	global *global.Module
}

// newSubmoduleBucketMng tạo submodule bucket trên kho kết nối dùng chung.
func newSubmoduleBucketMng(
	app *application.App,
	logger *slog.Logger,
	global *global.Module,
) *submoduleBucketMng {
	return &submoduleBucketMng{
		logger: logger.With("submodules", "bucket_mng"),
		app:    app,
		global: global,
	}
}

// listBucket trả về một trang bucket của kết nối (ListBuckets, thời gian chờ 10 giây).
// input.NextCursor là token tiếp tục của trang trước.
func (m *submoduleBucketMng) listBucket(
	ctx context.Context,
	input models.ListBucketInput,
) models.Output[models.ListBucketOutput] {
	ctx, cancel := withCallContext(ctx, m.app.Context(), 10*time.Second)
	defer cancel()

	output := models.NewOutput[models.ListBucketOutput]()

	s3Conn, ok := m.global.GetConnContainer(input.ConnectionId)
	if !ok {
		return output.ThrowError(notConnectedMessage(input.ProfileName))
	}

	if s3Conn.AuthType == cnst.AuthAnonymous {
		// Kiểm tra lại để bucket có policy thay đổi từ lúc kết nối được gắn cờ chính xác.
		checkAnonymousBuckets(ctx, s3Conn)
		if isCallCanceled(ctx) {
			// Frontend đã hủy: dừng im lặng vì không còn bên nào chờ kết quả.
			return output.ThrowError()
		}
		output.Body.BucketList = anonymousBuckets(s3Conn, "")
		if !flagBucketAccess(ctx, s3Conn, output.Body.BucketList, input.CheckWrite, input.LazyAccess, false) {
			return output.ThrowError()
		}
		return output
	}

	listBucketInput := &s3.ListBucketsInput{
		MaxBuckets: aws.Int32(input.Limit),
	}
	if input.NextCursor != "" {
		listBucketInput.ContinuationToken = &input.NextCursor
	}

	result, err := s3Conn.Client.ListBuckets(ctx, listBucketInput)

	if err != nil {
		return failCall(ctx, output, input.ProfileName, err,
			models.NewParamsMessage(cnst.MessageTypeError, cnst.Bucket, S3E007, err.Error(), map[string]any{
				"name": input.ProfileName,
			}))
	}

	body := models.ListBucketOutput{
		BucketList: make([]models.Bucket, len(result.Buckets)),
		NextCursor: result.ContinuationToken,
	}

	for i, item := range result.Buckets {
		body.BucketList[i] = models.Bucket{
			Name:         aws.ToString(item.Name),
			CreationDate: aws.ToTime(item.CreationDate),
		}
	}

	if !flagBucketAccess(ctx, s3Conn, body.BucketList, input.CheckWrite, input.LazyAccess, false) {
		return output.ThrowError()
	}

	output.Body = body
	return output
}

// checkBucketAccess trả về các cờ quyền truy cập của input.BucketNames (thời gian chờ 10 giây) và kiểm tra các bucket
// chưa có trong cache. Bucket nào chưa có kết quả kiểm tra chắc chắn sẽ được trả về với AccessPending.
func (m *submoduleBucketMng) checkBucketAccess(
	ctx context.Context,
	input models.CheckBucketAccessInput,
) models.Output[models.CheckBucketAccessOutput] {
	ctx, cancel := withCallContext(ctx, m.app.Context(), 10*time.Second)
	defer cancel()

	output := models.NewOutput[models.CheckBucketAccessOutput]()

	s3Conn, ok := m.global.GetConnContainer(input.ConnectionId)
	if !ok {
		return output.ThrowError(notConnectedMessage(input.ProfileName))
	}

	buckets := make([]models.Bucket, len(input.BucketNames))
	for i, name := range input.BucketNames {
		buckets[i].Name = name
	}

	if s3Conn.AuthType == cnst.AuthAnonymous {
		// Kết nối ẩn danh đã được kiểm tra khi liệt kê; chỉ cần sao chép kết quả.
		inaccessible := map[string]bool{}
		for _, b := range anonymousBuckets(s3Conn, "") {
			inaccessible[b.Name] = b.Inaccessible
		}
		for i := range buckets {
			buckets[i].Inaccessible = inaccessible[buckets[i].Name]
		}
	}

	if !flagBucketAccess(ctx, s3Conn, buckets, input.CheckWrite, false, input.WithPolicy) {
		return output.ThrowError()
	}
	output.Body.BucketList = buckets
	return output
}

// flagBucketAccess đánh dấu Inaccessible, DeleteDenied (MinIO có thông tin xác thực) và, nếu bật checkWrite, ReadOnly
// cho các bucket; sau đó cập nhật PolicyMode (xem flagPolicyModes; readPolicy cho biết có đọc policy còn thiếu hay không).
// Kết nối ẩn danh đã được phép kiểm tra riêng đánh dấu Inaccessible. Khi bật lazy, bucket cần kiểm tra nhưng chưa có
// kết quả cache sẽ không được thăm dò mà được đánh dấu AccessPending. Hàm trả false nếu frontend hủy lời gọi.
func flagBucketAccess(
	ctx context.Context,
	conn *global.S3Conn,
	buckets []models.Bucket,
	checkWrite, lazy, readPolicy bool,
) bool {
	if conn.AuthType != cnst.AuthAnonymous {
		if conn.MinioAdmin != nil {
			// Điền cache quyền đọc để markInaccessibleBuckets có thể bỏ qua HeadBucket.
			loadAccountAccess(ctx, conn)
		}
		markInaccessibleBuckets(ctx, conn, buckets, lazy)
		if conn.MinioAdmin != nil {
			for i := range buckets {
				buckets[i].DeleteDenied = isDenied(conn, global.AccessDelete, buckets[i].Name)
			}
		}
	}
	if checkWrite {
		markReadOnlyBuckets(ctx, conn, buckets, lazy)
	}
	flagPolicyModes(ctx, conn, buckets, !readPolicy)
	return !isCallCanceled(ctx)
}

// flagPolicyModes lấy PolicyMode từ cache và, trừ khi bật lazy, đọc song song các mục còn thiếu trong giới hạn
// bucketProbeTimeout. Bucket không đọc được policy được đánh dấu "unknown"; chỉ lưu cache câu trả lời chắc chắn
// từ máy chủ (xem isSurePolicyError), vì vậy timeout hoặc lỗi mạng sẽ được thử lại lần sau. Bỏ qua kết nối ẩn danh
// và các bucket ở chế độ lazy chưa có dữ liệu cache (PolicyMode vẫn rỗng = chưa xác định).
func flagPolicyModes(ctx context.Context, conn *global.S3Conn, buckets []models.Bucket, lazy bool) {
	if conn.AuthType == cnst.AuthAnonymous {
		return
	}
	var pending []int
	for i := range buckets {
		if buckets[i].Inaccessible {
			buckets[i].PolicyMode = policyModeUnknown
		} else if mode, ok := conn.Access.GetPolicy(buckets[i].Name); ok {
			buckets[i].PolicyMode = mode
		} else if !lazy {
			pending = append(pending, i)
		}
	}
	if len(pending) == 0 {
		return
	}
	gen := conn.Access.Generation()
	ctx, cancel := context.WithTimeout(ctx, bucketProbeTimeout)
	defer cancel()

	var g errgroup.Group
	g.SetLimit(bucketProbeConcurrency)
	for _, i := range pending {
		g.Go(func() error {
			mode, err := readPolicyModeInRegion(ctx, conn, buckets[i].Name)
			if err != nil {
				mode = policyModeUnknown
			}
			buckets[i].PolicyMode = mode
			if err == nil || isSurePolicyError(err) {
				conn.Access.SetPolicy(buckets[i].Name, mode, gen)
			}
			return nil
		})
	}
	_ = g.Wait()
}

// markInaccessibleBuckets đánh dấu Inaccessible cho các bucket mà kết nối không thể đọc. Kết quả được lưu cache theo
// kết nối (global.AccessCache); với MinIO có thông tin xác thực, loadAccountAccess đã lưu sẵn phần lớn kết quả.
// Các bucket còn lại được kiểm tra HeadBucket song song và chỉ mã 403 mới đánh dấu bucket: lỗi khác (301 sai region,
// 404, lỗi mạng) không gắn cờ. Phép thử có timeout riêng để bucket phản hồi chậm không làm hỏng lần liệt kê.
func markInaccessibleBuckets(ctx context.Context, conn *global.S3Conn, buckets []models.Bucket, lazy bool) {
	checkDenied(ctx, conn, global.AccessRead, buckets, lazy, func(ctx context.Context, name string) error {
		_, err := conn.Client.HeadBucket(ctx, &s3.HeadBucketInput{Bucket: aws.String(name)})
		return err
	}, func(b *models.Bucket, denied bool) { b.Inaccessible = denied })
}

// isDenied cho biết kết quả kiểm tra hợp lệ trong cache xác nhận quyền truy cập bucket bị từ chối hay không.
func isDenied(conn *global.S3Conn, kind global.AccessKind, name string) bool {
	denied, ok := conn.Access.Get(kind, name)
	return ok && denied
}

// loadAccountAccess lấy quyền đọc và ghi của mọi bucket từ một phản hồi MinIO AccountInfo rồi lưu cache, trừ khi cache
// đã có dữ liệu. Quyền ghi lấy từ Access.Write. Chỉ cache quyền đọc khi kết quả chắc chắn (xem switch bên dưới); nếu
// không, bucket sẽ được kiểm tra bằng HeadBucket. MinIO bỏ qua các bucket hoàn toàn không có quyền, nên vẫn phải thử
// kiểm tra chúng. Thao tác có timeout riêng. Kết quả AccountInfo thất bại được ghi nhớ (không thử lại trong thời gian
// TTL của cache), trừ khi ctx của bên gọi đã kết thúc (bị hủy hoặc quá hạn). Hàm trả false khi thất bại, nhưng trả true
// khi lỗi đã ghi nhớ vẫn còn hiệu lực.
func loadAccountAccess(ctx context.Context, conn *global.S3Conn) bool {
	if conn.Access.AccountFresh() {
		return true
	}
	gen := conn.Access.Generation()
	callCtx, cancel := context.WithTimeout(ctx, bucketProbeTimeout)
	defer cancel()
	info, err := conn.MinioAdmin.AccountInfo(callCtx, madmin.AccountOpts{})
	if err != nil {
		if ctx.Err() == nil {
			conn.Access.MarkAccount(gen)
		}
		return false
	}
	pol, parseErr := policy.ParseConfig(bytes.NewReader(info.Policy))
	// IsAllowed được đánh giá mà không có điều kiện của yêu cầu, nên chỉ tin kết quả "không được phép" với policy đơn giản.
	simple := isSimplePolicy(info.Policy)
	for _, b := range info.Buckets {
		conn.Access.Set(global.AccessWrite, b.Name, !b.Access.Write, gen)
		// Khác với quyền đọc, chỉ tin kết quả "không được phép" khi xóa nếu policy đơn giản; trường hợp khác vẫn xem là "được phép".
		canDelete := parseErr != nil || !simple || pol.IsAllowed(policy.Args{
			Action:          policy.DeleteBucketAction,
			BucketName:      b.Name,
			ConditionValues: map[string][]string{},
		})
		conn.Access.Set(global.AccessDelete, b.Name, !canDelete, gen)
		canList := parseErr == nil && pol.IsAllowed(policy.Args{
			Action:          policy.ListBucketAction,
			BucketName:      b.Name,
			ConditionValues: map[string][]string{},
		})
		switch {
		case !b.Access.Read: // no ListBucket nor GetBucketLocation
			conn.Access.Set(global.AccessRead, b.Name, true, gen)
		case canList:
			conn.Access.Set(global.AccessRead, b.Name, false, gen)
		case parseErr == nil && simple:
			conn.Access.Set(global.AccessRead, b.Name, true, gen)
		}
	}
	conn.Access.MarkAccount(gen)
	return true
}

// isSimplePolicy cho biết policy không có Condition hoặc biến, nhờ đó có thể tin IsAllowed (được đánh giá mà không có
// điều kiện của yêu cầu) khi hàm trả về "không được phép".
func isSimplePolicy(raw []byte) bool {
	return !bytes.Contains(raw, []byte(`"Condition"`)) && !bytes.Contains(raw, []byte("${"))
}

// checkDenied đặt cờ cho từng bucket dựa trên cache (bỏ qua các bucket Inaccessible) và thăm dò song song các bucket
// còn lại trong giới hạn bucketProbeTimeout. Chỉ lưu câu trả lời từ máy chủ: probe trả nil hoặc mã trạng thái HTTP
// đều được tính, trong đó 403 nghĩa là bị từ chối. Timeout, thao tác hủy và lỗi mạng không được cache, cờ không đổi
// và bucket được đánh dấu AccessPending. Khi bật lazy, bucket chưa có kết quả cache sẽ không được thăm dò và được
// đánh dấu AccessPending.
func checkDenied(
	ctx context.Context,
	conn *global.S3Conn,
	kind global.AccessKind,
	buckets []models.Bucket,
	lazy bool,
	probe func(ctx context.Context, name string) error,
	set func(b *models.Bucket, denied bool),
) {
	var pending []int
	for i := range buckets {
		if buckets[i].Inaccessible {
			continue
		}
		if denied, ok := conn.Access.Get(kind, buckets[i].Name); ok {
			set(&buckets[i], denied)
		} else if lazy {
			buckets[i].AccessPending = true
		} else {
			pending = append(pending, i)
		}
	}
	if len(pending) == 0 {
		return
	}
	gen := conn.Access.Generation()
	ctx, cancel := context.WithTimeout(ctx, bucketProbeTimeout)
	defer cancel()

	var g errgroup.Group
	g.SetLimit(bucketProbeConcurrency)
	for _, i := range pending {
		g.Go(func() error {
			err := probe(ctx, buckets[i].Name)
			status := statusCode(err)
			denied := status == http.StatusForbidden
			sure := err == nil || status != 0
			if sure {
				set(&buckets[i], denied)
				conn.Access.Set(kind, buckets[i].Name, denied, gen)
			}
			buckets[i].AccessPending = buckets[i].AccessPending || !sure
			return nil
		})
	}
	_ = g.Wait()
}

// markReadOnlyBuckets đánh dấu ReadOnly cho các bucket mà kết nối đọc được nhưng không ghi được.
// Hàm phải chạy sau markInaccessibleBuckets / anonymousBuckets. Cách kiểm tra tùy thuộc kết nối:
//   - MinIO có thông tin xác thực: AccountInfo quản trị đã cache (xem loadAccountAccess) trả quyền ghi của mọi bucket
//     trong một lần gọi; nếu lỗi hoặc bucket không có trong kết quả thì không gắn cờ.
//   - MinIO ẩn danh hoặc AWS thật (không dùng endpoint tùy chỉnh): dùng phép thử quyền ghi đã cache cho từng bucket
//     (xem probeWriteDenied).
//   - Máy chủ khác (provider AWS có endpoint tùy chỉnh như Floci hoặc Ceph): không kiểm tra, không gắn cờ.
//     Một số máy chủ bỏ qua Content-MD5 và sẽ thực sự lưu object thử nghiệm.
func markReadOnlyBuckets(ctx context.Context, conn *global.S3Conn, buckets []models.Bucket, lazy bool) {
	switch {
	case conn.AuthType != cnst.AuthAnonymous && conn.MinioAdmin != nil: // MinIO with credentials
		if !loadAccountAccess(ctx, conn) {
			return
		}
		for i := range buckets {
			buckets[i].ReadOnly = !buckets[i].Inaccessible && isDenied(conn, global.AccessWrite, buckets[i].Name)
		}
	case conn.Provider == cnst.ProviderMinio && conn.AuthType == cnst.AuthAnonymous,
		conn.Provider != cnst.ProviderMinio && !conn.CustomEndpoint:
		probeWriteDenied(ctx, conn, buckets, lazy)
	}
}

// probeWriteDenied đánh dấu ReadOnly cho bucket nếu PutObject với Content-MD5 cố tình sai trả về 403.
// Bên gọi có quyền ghi sẽ nhận BadDigest và không lưu object; bên không có quyền sẽ nhận AccessDenied trước.
// Cả hai kết quả đều được cache; bucket không kịp kiểm tra (hết timeout riêng) sẽ không bị gắn cờ.
func probeWriteDenied(ctx context.Context, conn *global.S3Conn, buckets []models.Bucket, lazy bool) {
	wrongMD5 := md5.Sum([]byte("s3b"))
	checkDenied(ctx, conn, global.AccessWrite, buckets, lazy, func(ctx context.Context, name string) error {
		_, err := conn.Client.PutObject(ctx, &s3.PutObjectInput{
			Bucket:        aws.String(name),
			Key:           aws.String(writeProbeKey),
			Body:          bytes.NewReader(nil),
			ContentLength: aws.Int64(0),
			ContentMD5:    aws.String(base64.StdEncoding.EncodeToString(wrongMD5[:])),
		}, func(o *s3.Options) {
			// Nếu thiếu thiết lập này, SDK sẽ thêm header checksum CRC bên cạnh MD5.
			o.RequestChecksumCalculation = aws.RequestChecksumCalculationWhenRequired
		})
		return err
	}, func(b *models.Bucket, denied bool) { b.ReadOnly = denied })
}

// anonymousBuckets trả về các bucket người dùng đã nhập cho kết nối ẩn danh (API không thể liệt kê chúng),
// chỉ giữ bucket có tên chứa lowerKeyword (đã chuyển thành chữ thường; giá trị rỗng giữ lại tất cả). Bucket không
// vượt qua lần kiểm tra gần nhất sẽ được đánh dấu Inaccessible.
func anonymousBuckets(c *global.S3Conn, lowerKeyword string) []models.Bucket {
	all := c.AnonymousBuckets()
	buckets := make([]models.Bucket, 0, len(all))
	for _, b := range all {
		if containsFold(b.Name, lowerKeyword) {
			buckets = append(buckets, models.Bucket{Name: b.Name, Inaccessible: !b.Accessible})
		}
	}
	return buckets
}
