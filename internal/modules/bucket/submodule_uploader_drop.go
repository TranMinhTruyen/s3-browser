package bucket

import (
	"S3Browser/internal/pkg/cnst"
	"S3Browser/internal/pkg/utils"
	"S3Browser/models"
	"context"
	"log/slog"
	"path/filepath"
	"slices"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// dropKindPicker là data-drop-kind của vùng thả trong hộp thoại chọn file tải lên.
const dropKindPicker = "picker"

// dropContext là phần context sự kiện cửa sổ Wails được dùng cho thao tác thả file.
type dropContext interface {
	DropTargetDetails() *application.DropTargetDetails
	DroppedFiles() []string
}

// handleFilesDropped chuyển tiếp file được thả vào danh sách object đến frontend.
// Vùng nhận file chứa tab ID trong data-tab-id; bỏ qua thao tác thả ở vị trí khác.
func (m *submoduleUploaderMng) handleFilesDropped(event *application.WindowEvent) {
	// Context là nil nếu sự kiện không xuất phát từ thao tác thả file thật.
	if ctx := event.Context(); ctx != nil {
		m.handleDrop(ctx)
	}
}

// handleDrop đọc vùng nhận và các đường dẫn file được thả từ ctx rồi chuyển tiếp chúng.
func (m *submoduleUploaderMng) handleDrop(ctx dropContext) {
	target := ctx.DropTargetDetails()
	if target == nil {
		return
	}
	attrs := target.Attributes
	event := EventFilesDropped
	if attrs["data-drop-kind"] == dropKindPicker {
		event = EventPickerFilesDropped
	}
	m.dropFiles(event, attrs["data-tab-id"], ctx.DroppedFiles())
}

// dropFiles mở rộng các đường dẫn được thả rồi phát kết quả thành sự kiện. Bỏ qua tabID rỗng
// (thao tác thả bên ngoài tab).
func (m *submoduleUploaderMng) dropFiles(event, tabID string, dropped []string) {
	if tabID == "" {
		return
	}
	m.app.Event.Emit(event, buildFilesDropped(tabID, dropped))
}

// buildFilesDropped mở rộng đường dẫn (bao gồm thư mục) thành các nhóm file cùng giới hạn frontend cần áp dụng.
func buildFilesDropped(tabID string, paths []string) models.FilesDroppedOutput {
	res := expandDropped(paths)
	return models.FilesDroppedOutput{
		TabId:             tabID,
		Groups:            res.groups,
		Skipped:           res.skipped,
		TotalFiles:        res.total,
		OverMaxTotal:      res.overTotal,
		Capped:            res.capped,
		MaxFilesPerFolder: maxFilesPerFolder,
		LargeFileSize:     largeFileSize,
		LargeFileMaxCount: largeFileMaxCount,
		MaxTotalFiles:     maxTotalFiles,
	}
}

// pickFiles mở hộp thoại của hệ điều hành để chọn nhiều file rồi trả các file đã chọn theo nhóm, kèm giới hạn,
// sắp xếp theo tên file. Nếu người dùng hủy, Body rỗng (không có nhóm) và Result vẫn là true. Hộp thoại chặn
// cho đến khi đóng nên không đặt timeout.
func (m *submoduleUploaderMng) pickFiles(ctx context.Context) models.Output[models.FilesDroppedOutput] {
	output := models.NewOutput[models.FilesDroppedOutput]()
	if ctx.Err() != nil {
		// Frontend đã hủy: dừng im lặng vì không còn bên nào chờ kết quả.
		return output.ThrowError()
	}
	paths, err := m.pickPaths()
	if utils.IsDialogCancelled(err) {
		m.logger.Debug("pick files cancelled")
		return output
	}
	if err != nil {
		m.logger.Error("pick files error", slog.Any("detail", err.Error()))
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Bucket, S3E029, err.Error()))
	}
	if len(paths) == 0 {
		return output
	}
	// Hộp thoại không bảo đảm thứ tự nên cần sắp xếp để danh sách luôn ổn định.
	slices.SortFunc(paths, func(a, b string) int {
		byName := strings.Compare(strings.ToLower(filepath.Base(a)), strings.ToLower(filepath.Base(b)))
		if byName != 0 {
			return byName
		}
		return strings.Compare(a, b)
	})
	output.Body = buildFilesDropped("", paths)
	return output
}
