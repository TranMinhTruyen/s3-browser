package bucket

import (
	"S3Browser/internal/modules/global"
	"S3Browser/internal/pkg/cnst"
	"S3Browser/internal/pkg/utils"
	"S3Browser/models"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"

	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/wailsapp/wails/v3/pkg/application"
	"golang.org/x/sync/errgroup"
)

// submoduleUploaderMng tải file lên. Trạng thái được dùng chung giữa các tab: mỗi lần chỉ chạy một lời gọi uploadObject
// (busy); mỗi file đang truyền là một job có thể hủy (jobs), để người dùng dừng riêng một file hoặc cả lô.
type submoduleUploaderMng struct {
	logger *slog.Logger
	app    *application.App
	global *global.Module
	// progress gom tiến độ của mọi lượt tải lên đang chạy vào một sự kiện.
	progress *utils.BatchReporter[models.UploadProgressOutput]
	// jobs lưu các file đang truyền có thể hủy.
	jobs jobRegistry
	// busy được bật trong khi uploadObject chạy; chỉ một lời gọi được chạy tại một thời điểm trên mọi tab.
	busy atomic.Bool
	// batchCancel hủy lời gọi uploadObject đang chạy, bao gồm cả bước kiểm tra key;
	// có giá trị nil khi không có lời gọi nào chạy.
	batchMu     sync.Mutex
	batchCancel context.CancelFunc
}

// newSubmoduleUploaderMng kết nối uploader với ứng dụng Wails và kho kết nối dùng chung.
func newSubmoduleUploaderMng(
	app *application.App,
	logger *slog.Logger,
	globalModule *global.Module,
) *submoduleUploaderMng {
	return &submoduleUploaderMng{
		logger: logger.With("submodules", "uploader_mng"),
		app:    app,
		global: globalModule,
		progress: utils.NewBatchReporter(app.Context, func(items []models.UploadProgressOutput) {
			app.Event.Emit(EventUploadProgressBatch, models.UploadProgressBatchOutput{Items: items})
		}),
	}
}

// pickPaths mở hộp thoại của hệ điều hành để chọn file; paths rỗng nghĩa là người dùng đã hủy.
func (m *submoduleUploaderMng) pickPaths() ([]string, error) {
	dialog := m.app.Dialog.OpenFile().CanChooseFiles(true).CanChooseDirectories(false)
	// Ứng dụng chỉ có một cửa sổ; gắn hộp thoại vào cửa sổ này để hộp thoại ở chế độ modal (Current có thể là nil).
	if window := m.app.Window.Current(); window != nil {
		dialog.AttachToWindow(window)
	}
	return dialog.PromptForMultipleSelection()
}

const (
	// uploadFileConcurrency là số file tối đa được tải lên đồng thời trên mọi nhóm.
	uploadFileConcurrency = 5
	// maxFilesPerFolder là số file tối đa được tải lên từ một thư mục (nhóm).
	maxFilesPerFolder = 50
	// largeFileMaxCount là số file lớn tối đa được tải lên từ một thư mục (nhóm).
	largeFileMaxCount = 4
	// maxTotalFiles là tổng số file tối đa trong một lần thả hoặc một lời gọi uploadObject.
	maxTotalFiles = 1000
)

// largeFileSize là ngưỡng để một file được xem là "file lớn" (10 GiB).
const largeFileSize int64 = 10 << 30

// uploadResult là kết quả của một file, được chuyển thành thông báo sau khi mọi file xử lý xong.
type uploadResult struct {
	path string
	key  string
	err  error
}

// uploadObject tải từng mục lên bucket, tối đa uploadFileConcurrency file cùng lúc.
// Hàm chờ đến khi mọi lượt tải lên hoàn tất rồi trả một thông báo cho mỗi mục: thành công,
// đã hủy hoặc lỗi. File lỗi hoặc bị hủy không làm dừng các file còn lại.
// Mỗi lần chỉ chạy một lời gọi; lời gọi mới sẽ bị từ chối nếu đang có lời gọi khác.
//
// Các giới hạn được áp dụng tại đây, không chỉ ở frontend. Các mục được nhóm theo thư mục trong RelKey,
// và lời gọi bị từ chối nếu:
//   - RelKey có thể thoát khỏi prefix;
//   - có nhiều hơn maxTotalFiles mục;
//   - một nhóm có nhiều hơn maxFilesPerFolder mục;
//   - một nhóm có nhiều hơn largeFileMaxCount file lớn hơn largeFileSize
//     (kích thước được đọc từ đĩa, không lấy từ bên gọi).
func (m *submoduleUploaderMng) uploadObject(input models.UploadObjInput) models.Output[any] {
	output := models.NewOutput[any]()

	if len(input.ObjList) == 0 {
		return output
	}
	if len(input.ObjList) > maxTotalFiles {
		return output.ThrowError(
			models.NewParamsMessage(cnst.MessageTypeError, cnst.Bucket, S3E023, "", map[string]any{
				"max": maxTotalFiles,
			}),
		)
	}
	items, badPath := cleanUploadItems(input.ObjList)
	if badPath != "" {
		m.logger.Error("invalid upload key", slog.String("path", badPath))
		return output.ThrowError(
			models.NewParamsMessage(cnst.MessageTypeError, cnst.Bucket, S3E019, "", map[string]any{
				"name": filepath.Base(badPath),
			}),
		)
	}
	groups, violation := groupUploadItems(items)
	if violation != nil {
		m.logger.Error("upload breaks a limit", slog.String("code", violation[0].MessageCode))
		return output.ThrowError(violation...)
	}
	if !m.busy.CompareAndSwap(false, true) {
		m.logger.Warn("another upload is running, skip")
		return output.ThrowError(
			models.NewParamsMessage(cnst.MessageTypeWarn, cnst.Bucket, S3W005, "", nil),
		)
	}
	defer m.busy.Store(false)

	// Ghi nhận lời gọi này là một lượt truyền đang chạy để hồ sơ không bị xóa giữa chừng.
	// Mọi lượt tải lên kết thúc bên trong lời gọi này (g.Wait bên dưới), nên giải phóng tại đây.
	conn, releaseConn, ok := m.global.AcquireConn(input.ConnectionId)
	if !ok {
		m.logger.Error("get connection profile failed")
		return output.ThrowError(notConnectedMessage(input.ProfileName))
	}
	defer releaseConn()

	// Thông tin xác thực sắp hết hạn và không thể gia hạn có thể làm gián đoạn lượt truyền: gửi cảnh báo nhưng vẫn tiếp tục.
	output.AddMessage(transferExpiryWarning(conn, input.ProfileName)...)

	// Dùng một context cho toàn bộ lời gọi để cancelAllUploads cũng dừng bước kiểm tra key bên dưới
	// và các file chưa bắt đầu. Đây không phải context của lời gọi Wails: lời gọi này chờ trong lúc người dùng thao tác,
	// nên chỉ kết thúc khi cancelAllUploads được gọi hoặc ứng dụng tắt.
	ctx, cancel := context.WithCancel(m.app.Context())
	m.setBatchCancel(cancel)
	defer func() { m.setBatchCancel(nil); cancel() }()

	prefix := normalizePrefix(input.Prefix)
	// Tìm các key (tính tương đối với prefix) đã được dùng trước khi bắt đầu tải lên,
	// nhờ đó có thể chọn key bên dưới mà không cần khóa.
	used := existingKeys(ctx, conn.Client, input.Bucket, prefix, items)

	// Chọn trước ID và key cho từng mục theo thứ tự để không cần khóa.
	ids := make([]string, len(items))
	for i := range items {
		// Dùng cùng ID cho job, sự kiện tiến độ và key được đổi tên.
		ids[i] = utils.GenerateUUID()
		items[i].Key = prefix + items[i].RelKey
		if _, taken := used[items[i].RelKey]; taken {
			items[i].Key = prefix + renameKey(items[i].RelKey, ids[i])
		}
		used[items[i].RelKey] = struct{}{}
	}

	// Mỗi goroutine chỉ ghi vào vị trí riêng nên không cần khóa. Đọc kết quả sau g.Wait(), hàm này chờ mọi nhóm
	// hoàn tất (và từng nhóm chờ các file của mình).
	results := make([]uploadResult, len(items))
	// Mỗi nhóm có một goroutine phân phối file, nhưng mọi nhóm dùng chung một semaphore nên tối đa
	// uploadFileConcurrency file được tải lên cùng lúc. Dùng errgroup.Group thường (không dùng context chung)
	// để lỗi của một file không hủy các file khác.
	sem := make(chan struct{}, uploadFileConcurrency)
	var g errgroup.Group
	for _, indexes := range groups {
		g.Go(func() error {
			var wg sync.WaitGroup
			defer wg.Wait()
			for _, i := range indexes {
				select {
				case sem <- struct{}{}:
				case <-ctx.Done():
					// Bị hủy trong lúc chờ: uploadOne tự báo lỗi mà không tải file lên.
					results[i] = m.uploadOne(ctx, ids[i], conn.Client, input.Bucket, items[i])
					continue
				}
				wg.Add(1)
				go func() {
					defer func() { <-sem; wg.Done() }()
					results[i] = m.uploadOne(ctx, ids[i], conn.Client, input.Bucket, items[i])
				}()
			}
			return nil
		})
	}
	_ = g.Wait()

	// Chuyển từng kết quả thành thông báo cho frontend.
	for _, r := range results {
		name := filepath.Base(r.path)
		switch {
		case r.err == nil:
			m.logger.Info(fmt.Sprintf("upload file %s success, key %s", r.path, r.key))
			output.AddMessage(
				models.NewParamsMessage(cnst.MessageTypeSuccess, cnst.Bucket, S3S006, "", map[string]any{
					"name": name,
					"key":  r.key,
				}),
			)
		case errors.Is(r.err, context.Canceled):
			m.logger.Warn(fmt.Sprintf("upload file %s is canceled", r.path))
			output.AddMessage(
				models.NewParamsMessage(cnst.MessageTypeWarn, cnst.Bucket, S3W004, "", map[string]any{
					"name": name,
				}),
			)
		case isCredentialsExpired(r.err):
			m.logger.Error(fmt.Sprintf("upload file %s: credentials expired", r.path))
			output.AddMessage(expiredMessage(input.ProfileName, r.err))
		default:
			m.logger.Error(fmt.Sprintf("upload file %s error", r.path), slog.Any("detail", r.err.Error()))
			output.AddMessage(
				models.NewParamsMessage(cnst.MessageTypeError, cnst.Bucket, S3E017, r.err.Error(), map[string]any{
					"name": name,
				}),
			)
		}
	}

	return output
}

// uploadOne tải một file. Hàm đăng ký job có thể hủy (để cancelUploadOne chỉ dừng file này) và gửi sự kiện tiến độ
// trong khi tải. Khi hàm kết thúc, job được gỡ và context được giải phóng để tránh rò rỉ. Nếu job bị hủy,
// lỗi trong kết quả là context.Canceled.
func (m *submoduleUploaderMng) uploadOne(
	parent context.Context,
	id string,
	client *s3.Client,
	bucket string,
	item models.UploadObj,
) uploadResult {
	// Đăng ký job để có thể hủy; gỡ job khi lượt tải lên kết thúc.
	ctx, done := m.jobs.start(parent, id)
	defer done()

	// Đọc lại thông tin file (groupUploadItems cũng đã làm): mỗi file chỉ tốn một lần gọi nhẹ,
	// đồng thời tránh phải truyền kích thước qua nhiều chỗ. Kích thước chỉ dùng cho UI (uploadFile đọc lại từ file đang mở);
	// lỗi stat không làm dừng tại đây vì uploadFile sẽ báo lỗi đó.
	var total int64
	if info, statErr := os.Stat(item.Path); statErr == nil {
		total = info.Size()
	}
	m.app.Event.Emit(EventUploadObjectStarted, models.UploadStartedOutput{
		UploadId: id,
		FileName: filepath.Base(item.Path),
		Key:      item.Key,
		Bucket:   bucket,
		Total:    total,
	})

	// Nếu lô bị hủy trước khi file này bắt đầu (ví dụ trong lúc kiểm tra key), không gửi gì.
	err := ctx.Err()
	if err == nil {
		_, err = uploadFile(ctx, client, bucket, item.Key, item.Path, id, m.progress)
	}

	// Nếu context đã bị hủy, trả context.Canceled thay cho lỗi mà lời gọi S3 trả về.
	if err != nil && ctx.Err() != nil {
		err = context.Canceled
	}

	status := models.UploadStatusSuccess
	switch {
	case errors.Is(err, context.Canceled):
		status = models.UploadStatusCanceled
	case err != nil:
		status = models.UploadStatusError
	}
	m.app.Event.Emit(EventUploadObjectFinished, models.UploadFinishedOutput{UploadId: id, Status: status})

	return uploadResult{path: item.Path, key: item.Key, err: err}
}

// cancelUploadOne hủy lượt tải lên đang chạy có ID đã cho.
// ID không xác định hoặc lượt tải đã hoàn tất sẽ bị bỏ qua.
func (m *submoduleUploaderMng) cancelUploadOne(id string) models.Output[any] {
	if m.jobs.cancel(id) {
		m.logger.Info(fmt.Sprintf("upload %s is canceled", id))
	}
	return models.NewOutput[any]()
}

// setBatchCancel lưu hàm cancel của lời gọi uploadObject đang chạy (nil khi lời gọi kết thúc).
func (m *submoduleUploaderMng) setBatchCancel(cancel context.CancelFunc) {
	m.batchMu.Lock()
	m.batchCancel = cancel
	m.batchMu.Unlock()
}

// cancelAllUploads hủy mọi lượt tải lên đang chạy và lời gọi uploadObject (bước kiểm tra key cùng các file chưa bắt đầu).
func (m *submoduleUploaderMng) cancelAllUploads() models.Output[any] {
	m.batchMu.Lock()
	if m.batchCancel != nil {
		m.batchCancel()
	}
	m.batchMu.Unlock()
	m.jobs.cancelAll(func(id string) { m.logger.Info(fmt.Sprintf("upload %s is canceled", id)) })
	m.logger.Info("all uploads is canceled")
	return models.NewOutput[any]()
}
