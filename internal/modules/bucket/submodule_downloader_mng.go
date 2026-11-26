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
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"github.com/aws/aws-sdk-go-v2/feature/s3/transfermanager"
	"github.com/wailsapp/wails/v3/pkg/application"
	"golang.org/x/sync/errgroup"
)

// submoduleDownloaderMng tải object xuống. Mỗi object đang truyền là một job có thể hủy (jobs); dests lưu các đường dẫn
// mà lượt tải đang chạy ghi vào, được bảo vệ bởi destsMu, để hai object trùng tên cơ sở không ghi cùng một file.
type submoduleDownloaderMng struct {
	logger                      *slog.Logger
	app                         *application.App
	global                      *global.Module
	submoduleDownloadHistoryMng *submoduleDownloadHistoryMng
	progress                    *utils.BatchReporter[models.DownloadProgressOutput]
	jobs                        jobRegistry
	destsMu                     sync.Mutex
	dests                       map[string]struct{}
}

// newSubmoduleDownloaderMng kết nối downloader với ứng dụng, kho kết nối và lịch sử tải xuống.
func newSubmoduleDownloaderMng(
	app *application.App,
	logger *slog.Logger,
	global *global.Module,
	submoduleDownloadHistoryMng *submoduleDownloadHistoryMng,
) *submoduleDownloaderMng {
	return &submoduleDownloaderMng{
		logger:                      logger.With("submodules", "downloader_mng"),
		app:                         app,
		global:                      global,
		submoduleDownloadHistoryMng: submoduleDownloadHistoryMng,
		progress: utils.NewBatchReporter(app.Context, func(items []models.DownloadProgressOutput) {
			app.Event.Emit(EventDownloadProgressBatch, models.DownloadProgressBatchOutput{Items: items})
		}),
		dests: make(map[string]struct{}),
	}
}

// downloadResult là kết quả của một object, được chuyển thành thông báo sau khi mọi lượt tải hoàn tất.
type downloadResult struct {
	key  string
	dest string
	err  error
	// history là bản ghi lịch sử cuối cùng cần lưu; nil nếu không tạo được bản ghi.
	history *models.DownloadHistoryItem
}

// downloadConcurrency giới hạn cả số object tải xuống đồng thời lẫn số part được lấy cùng lúc cho mỗi object.
// Vì vậy có thể mở tối đa downloadConcurrency^2 (36) kết nối. Không giảm giới hạn này vì chưa có số liệu cho thấy
// hiệu năng được cải thiện, còn ít kết nối hơn sẽ làm chậm một số object lớn.
const downloadConcurrency = 6

// downloadObject hỏi người dùng vị trí lưu rồi tải từng object trong input.Objects.
//   - Một object: mở hộp thoại "Lưu file" và ghi object vào đường dẫn được chọn.
//   - Nhiều object: mở hộp thoại chọn thư mục và lưu từng object trong thư mục đó
//     với tên cơ sở của object.
//
// Hàm chờ đến khi mọi lượt tải xuống hoàn tất rồi trả một thông báo cho mỗi object
// (thành công, đã hủy hoặc lỗi). Nếu người dùng đóng hộp thoại, hàm trả về kết quả rỗng.
func (m *submoduleDownloaderMng) downloadObject(input models.DownloadObjInput) models.Output[any] {
	output := models.NewOutput[any]()

	// Ghi nhận lời gọi này là một lượt truyền đang chạy để hồ sơ không bị xóa giữa chừng.
	// Mọi lượt tải xuống kết thúc bên trong lời gọi này (g.Wait bên dưới), nên giải phóng tại đây.
	s3Conn, releaseConn, ok := m.global.AcquireConn(input.ConnectionId)

	if !ok {
		m.logger.Error("get connection profile failed")
		return output.ThrowError(notConnectedMessage(input.ProfileName))
	}
	defer releaseConn()

	// Thông tin xác thực sắp hết hạn và không thể gia hạn có thể làm gián đoạn lượt truyền: gửi cảnh báo nhưng vẫn tiếp tục.
	output.AddMessage(transferExpiryWarning(s3Conn, input.ProfileName)...)

	if len(input.Objects) == 0 {
		return output
	}

	var (
		destDir string
		err     error
	)

	// Nhiều object thì chọn thư mục; một object thì chọn đường dẫn file.
	if len(input.Objects) > 1 {
		destDir, err = m.app.Dialog.OpenFile().
			CanChooseDirectories(true).
			CanChooseFiles(false).
			CanCreateDirectories(true).
			PromptForSingleSelection()
	} else {
		destDir, err = m.app.Dialog.SaveFile().SetFilename(path.Base(input.Objects[0])).PromptForSingleSelection()
	}

	if utils.IsDialogCancelled(err) {
		m.logger.Debug("download destination dialog cancelled")
		return output
	}
	if err != nil {
		m.logger.Error("get destination path error", slog.Any("detail", err.Error()))
		return output.ThrowError(models.NewParamsMessage(cnst.MessageTypeError, cnst.Bucket, S3E009, err.Error(),
			map[string]any{"path": destDir}))
	}

	// Đường dẫn rỗng nghĩa là người dùng đã hủy hộp thoại.
	if destDir == "" {
		m.logger.Warn("no destination path select")
		return output
	}

	tm := transfermanager.New(s3Conn.Client, func(o *transfermanager.Options) {
		o.Concurrency = downloadConcurrency
	})

	// Dùng bộ đệm để goroutine không bị chặn khi gửi; chỉ đọc kết quả sau g.Wait().
	// Lượt tải dùng context của ứng dụng, không dùng context của lời gọi: hàm chờ ở hộp thoại hệ điều hành,
	// còn từng file được hủy qua job riêng hoặc cancelAllDownloads.
	results := make(chan downloadResult, len(input.Objects))
	// Dùng errgroup.Group thường (không dùng context chung) để lỗi của một object không hủy các object khác.
	var g errgroup.Group
	g.SetLimit(downloadConcurrency)
	// Một object được lưu đúng đường dẫn người dùng chọn (hộp thoại đã hỏi về việc ghi đè);
	// object lưu trong thư mục không được thay thế các file đã có.
	multi := len(input.Objects) > 1
	for _, key := range input.Objects {
		dest := destDir
		if multi {
			dest = filepath.Join(destDir, path.Base(key))
		}
		// Dùng cùng ID cho job, bản ghi lịch sử, sự kiện tiến độ và tên file khi bị trùng.
		id := utils.GenerateUUID()
		// Đặt trước tên file theo thứ tự ngay tại đây để các object trùng tên cơ sở không bị xung đột.
		dest, release := m.reserveDest(dest, id, multi)

		// Luôn trả nil: lỗi được báo riêng cho từng object qua results.
		g.Go(func() error {
			defer release()
			r := m.downloadOne(m.app.Context(), id, tm, input.Bucket, key, dest)
			r.dest = dest
			if r.history != nil {
				m.finishHistory(&r)
			}
			results <- r
			return nil
		})
	}
	_ = g.Wait()
	close(results)

	// Chuyển từng kết quả thành thông báo cho frontend.
	for r := range results {
		switch {
		case r.err == nil:
			m.logger.Info(fmt.Sprintf("Download file %s success, destination %s", r.key, r.dest))
			output.AddMessage(
				models.NewParamsMessage(cnst.MessageTypeSuccess, cnst.Bucket, S3S004, "", map[string]any{
					"object": r.key,
					"dest":   r.dest,
				}),
			)
		case errors.Is(r.err, context.Canceled):
			m.logger.Warn(fmt.Sprintf("Download object: %s is canceled", r.key))
			output.AddMessage(
				models.NewParamsMessage(cnst.MessageTypeWarn, cnst.Bucket, S3W002, "", map[string]any{
					"object": r.key,
				}),
			)
		case isCredentialsExpired(r.err):
			m.logger.Error(fmt.Sprintf("Download object: %s: credentials expired", r.key))
			output.AddMessage(expiredMessage(input.ProfileName, r.err))
		default:
			m.logger.Error(fmt.Sprintf("Download object: %s error", r.key))
			output.AddMessage(
				models.NewParamsMessage(cnst.MessageTypeError, cnst.Bucket, S3E012, r.err.Error(), map[string]any{
					"object": r.key,
				}),
			)
		}
	}
	return output
}

// cancelDownloadOne hủy lượt tải xuống đang chạy có ID đã cho.
// ID không xác định hoặc lượt tải đã hoàn tất sẽ bị bỏ qua.
func (m *submoduleDownloaderMng) cancelDownloadOne(id string) models.Output[any] {
	if m.jobs.cancel(id) {
		m.logger.Info(fmt.Sprintf("download %s is canceled", id))
	}
	return models.NewOutput[any]()
}

// cancelAllDownloads hủy mọi lượt tải xuống đang chạy.
func (m *submoduleDownloaderMng) cancelAllDownloads() models.Output[any] {
	m.jobs.cancelAll(func(id string) { m.logger.Info(fmt.Sprintf("download %s is canceled", id)) })
	m.logger.Info("all downloads is canceled")
	return models.NewOutput[any]()
}

// reserveDest trả về đường dẫn mới dựa trên dest và đánh dấu đường dẫn đang được dùng cho đến khi gọi release.
// Nếu dest đã được dùng, tên file đổi thành "name(<id>).ext"; id là duy nhất cho từng job nên đường dẫn đó chưa thể bị dùng.
// Đường dẫn được xem là đang dùng khi một lượt tải đang ghi vào đó hoặc, nếu bật avoidExisting, khi file (hoặc file .part)
// đã tồn tại trên đĩa.
func (m *submoduleDownloaderMng) reserveDest(dest, id string, avoidExisting bool) (string, func()) {
	m.destsMu.Lock()
	defer m.destsMu.Unlock()

	candidate := dest
	if m.destTaken(candidate, avoidExisting) {
		candidate = suffixedPath(dest, id)
	}
	k := destKey(candidate)
	m.dests[k] = struct{}{}

	return candidate, func() {
		m.destsMu.Lock()
		delete(m.dests, k)
		m.destsMu.Unlock()
	}
}

// destKey tạo khóa cho p trong dests. Tên file trên Windows không phân biệt chữ hoa/thường,
// vì vậy "Report.pdf" và "report.pdf" phải được xem là cùng một file.
func destKey(p string) string {
	if runtime.GOOS == "windows" {
		return strings.ToLower(p)
	}
	return p
}

// destTaken cho biết có thể dùng p hay không. Bên gọi phải giữ destsMu.
// Kiểm tra dests và đặt chỗ phải diễn ra liền mạch dưới khóa. Để đơn giản, kiểm tra đĩa (Lstat, chi phí thấp,
// chỉ dùng khi tải nhiều file) cũng thực hiện tại đây; khóa chỉ tranh chấp với thao tác release.
func (m *submoduleDownloaderMng) destTaken(p string, checkDisk bool) bool {
	if _, ok := m.dests[destKey(p)]; ok {
		return true
	}
	if !checkDisk {
		return false
	}
	return pathExists(p) || pathExists(p+".part")
}

// pathExists cho biết p có tồn tại hay không mà không đi theo symbolic link.
func pathExists(p string) bool {
	_, err := os.Lstat(p)
	return err == nil
}

// suffixedPath đổi "dir/report.pdf" thành "dir/report(<suffix>).pdf".
// File ẩn như ".env" không có phần mở rộng nên sẽ thành ".env(<suffix>)".
func suffixedPath(p, suffix string) string {
	dir, file := filepath.Split(p)
	ext := filepath.Ext(file)
	stem := strings.TrimSuffix(file, ext)
	if stem == "" {
		stem, ext = file, ""
	}
	return filepath.Join(dir, stem+"("+suffix+")"+ext)
}

// downloadOne tải một object xuống dest.
// Hàm đăng ký job có thể hủy, tạo bản ghi lịch sử, gửi sự kiện tiến độ trong khi tải và trả trạng thái cuối cùng.
// Hàm không tự cập nhật bản ghi lịch sử; bên gọi thực hiện việc đó bằng finishHistory.
func (m *submoduleDownloaderMng) downloadOne(
	parent context.Context,
	id string,
	tm *transfermanager.Client,
	bucket, key, dest string,
) downloadResult {
	// Đăng ký job để có thể hủy; gỡ job khi lượt tải xuống kết thúc.
	ctx, done := m.jobs.start(parent, id)
	defer done()

	saved, err := m.submoduleDownloadHistoryMng.createDownloadHistory(models.DownloadHistoryItem{
		ID:       id,
		FileName: key,
		DestPath: dest,
	})

	if err != nil {
		m.logger.Error("create history error", slog.Any("detail", err.Error()))
		return downloadResult{key: key, err: fmt.Errorf("create history: %w", err)}
	}

	// Báo cho frontend biết lượt tải xuống mới đã bắt đầu.
	m.app.Event.Emit(EventLoadDownloadHistory, saved)

	size, err := download(ctx, tm, bucket, key, dest, id, m.progress)

	// Ánh xạ lỗi thành trạng thái lịch sử. Nếu context đã bị hủy, trả context.Canceled
	// thay cho lỗi mà lời gọi S3 trả về.
	status := DOWNLOADED
	if err != nil {
		status = DOWNLOAD_ERROR
		if ctx.Err() != nil {
			status = CANCELED
			err = context.Canceled
		}
	}

	// Chỉ ghi nhận đường dẫn đích cho lượt tải xuống đã hoàn tất.
	destPath := ""
	if err == nil {
		destPath = saved.DestPath
	}

	return downloadResult{
		key: key,
		err: err,
		history: &models.DownloadHistoryItem{
			ID:       id,
			DestPath: destPath,
			Status:   status,
			Size:     float64(size),
			Version:  saved.Version,
		},
	}
}

// finishHistory ghi trạng thái cuối cùng từ r.history vào bản ghi lịch sử rồi thông báo cho frontend.
// Nếu cập nhật thất bại, lỗi đó thay thế r.err.
func (m *submoduleDownloaderMng) finishHistory(r *downloadResult) {
	updated, err := m.submoduleDownloadHistoryMng.updateDownloadHistory(*r.history)

	if err != nil {
		r.err = err
		return
	}

	m.app.Event.Emit(EventLoadDownloadHistory, updated)
}
