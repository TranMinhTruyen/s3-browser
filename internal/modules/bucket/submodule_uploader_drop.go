package bucket

import (
	"S3Browser/internal/pkg/cnst"
	"S3Browser/models"
	"context"
	"log/slog"
	"path/filepath"
	"slices"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// dropKindPicker is the data-drop-kind of the drop zone inside the upload picker modal.
const dropKindPicker = "picker"

// dropContext is the part of the Wails window event context used for a drop.
type dropContext interface {
	DropTargetDetails() *application.DropTargetDetails
	DroppedFiles() []string
}

// handleFilesDropped forwards files dropped on an object list to the frontend.
// The drop target carries the tab ID in data-tab-id; drops elsewhere are ignored.
func (m *submoduleUploaderMng) handleFilesDropped(event *application.WindowEvent) {
	// The context is nil for an event that didn't come from a real drop.
	if ctx := event.Context(); ctx != nil {
		m.handleDrop(ctx)
	}
}

// handleDrop reads the drop target and the dropped paths from ctx and forwards them.
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

// dropFiles expands the dropped paths and emits the result as event. An empty tabID
// (a drop outside a tab) is ignored.
func (m *submoduleUploaderMng) dropFiles(event, tabID string, dropped []string) {
	if tabID == "" {
		return
	}
	m.host.Emit(event, buildFilesDropped(tabID, dropped))
}

// buildFilesDropped expands paths (folders included) into groups of files, with the
// limits the frontend must apply.
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

// pickFiles opens the native file dialog (multiple files) and returns the chosen files
// as groups with their limits, sorted by file name. If the user cancels, Body is empty
// (no groups) and Result stays true. The dialog blocks until closed, so it has no timeout.
func (m *submoduleUploaderMng) pickFiles(ctx context.Context) models.Output[models.FilesDroppedOutput] {
	output := models.NewOutput[models.FilesDroppedOutput]()
	if ctx.Err() != nil {
		output.Result = false
		return output
	}
	paths, err := m.pickPaths()
	if err != nil {
		m.logger.Error("pick files error", slog.Any("detail", err.Error()))
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Bucket, S3E029, err.Error()))
	}
	if len(paths) == 0 {
		return output
	}
	// The dialog doesn't guarantee an order, so sort for a stable list.
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
