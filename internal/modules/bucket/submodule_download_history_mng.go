package bucket

import (
	"S3Browser/internal/pkg/cnst"
	"S3Browser/internal/pkg/db/sqlc"
	"S3Browser/models"
	"context"
	"database/sql"
	"errors"
	"io/fs"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type submoduleDownloadHistoryMng struct {
	logger *slog.Logger
	app    *application.App
	q      *sqlc.Queries
}

func newSubmoduleDownloadHistoryMng(
	app *application.App,
	logger *slog.Logger,
	db *sql.DB,
) *submoduleDownloadHistoryMng {
	return &submoduleDownloadHistoryMng{
		logger: logger.With("submodules", "download_history_mng"),
		app:    app,
		q:      sqlc.New(db),
	}
}

const (
	DOWNLOADING    = "DOWNLOADING"
	DOWNLOADED     = "DOWNLOADED"
	CANCELED       = "CANCELED"
	DOWNLOAD_ERROR = "DOWNLOAD_ERROR"
)

func (m *submoduleDownloadHistoryMng) createDownloadHistory(
	input models.DownloadHistoryItem,
) (models.DownloadHistoryItem, error) {
	ctx, cancel := context.WithTimeout(m.app.Context(), 30*time.Second)
	defer cancel()

	saved, err := m.q.CreateDownloadHistory(ctx, sqlc.CreateDownloadHistoryParams{
		ID:       input.ID,
		FileName: input.FileName,
		DestPath: sql.NullString{String: input.DestPath, Valid: true},
		Status:   DOWNLOADING,
	})

	if err != nil {
		return models.DownloadHistoryItem{}, err
	}

	return models.DownloadHistoryItem{
		ID:        saved.ID,
		FileName:  saved.FileName,
		DestPath:  saved.DestPath.String,
		Status:    saved.Status,
		UpdatedAt: saved.UpdatedAt.Time,
		Version:   saved.Version,
	}, nil
}

func (m *submoduleDownloadHistoryMng) updateDownloadHistory(
	input models.DownloadHistoryItem,
) (models.DownloadHistoryItem, error) {
	ctx, cancel := context.WithTimeout(m.app.Context(), 30*time.Second)
	defer cancel()

	updated, err := m.q.UpdateStatusDownloadHistoryById(ctx, sqlc.UpdateStatusDownloadHistoryByIdParams{
		ID:       input.ID,
		DestPath: sql.NullString{String: input.DestPath, Valid: input.DestPath != ""},
		Status:   input.Status,
		Size:     sql.NullFloat64{Float64: input.Size, Valid: input.Size > 0},
		Version:  input.Version,
	})

	if err != nil {
		return models.DownloadHistoryItem{}, err
	}

	return models.DownloadHistoryItem{
		ID:        updated.ID,
		FileName:  updated.FileName,
		DestPath:  updated.DestPath.String,
		Status:    updated.Status,
		Size:      updated.Size.Float64,
		UpdatedAt: updated.UpdatedAt.Time,
		Version:   updated.Version,
	}, nil
}

func (m *submoduleDownloadHistoryMng) getDownloadHistory(
	input models.DownloadHistoryInput,
) models.Output[models.DownloadHistoryOutput] {
	ctx, cancel := context.WithTimeout(m.app.Context(), 60*time.Second)
	defer cancel()
	output := models.NewOutput[models.DownloadHistoryOutput]()

	result, err := m.q.SelectAllDownloadHistory(ctx, sqlc.SelectAllDownloadHistoryParams{
		AfterID:  input.AfterID,
		PageSize: input.PageSize + 1,
	})

	if err != nil {
		return output.ThrowError(
			models.NewMessage(cnst.MessageTypeError, cnst.Bucket, S3E011, err.Error()),
		)
	}

	hasMore := int64(len(result)) > input.PageSize
	if hasMore {
		result = result[:input.PageSize]
		output.Body.AfterID = result[len(result)-1].ID
	}

	historyList := make([]models.DownloadHistoryItem, len(result))
	for idx, item := range result {
		historyList[idx] = models.DownloadHistoryItem{
			ID:        item.ID,
			FileName:  item.FileName,
			DestPath:  item.DestPath.String,
			Status:    item.Status,
			Size:      item.Size.Float64,
			UpdatedAt: item.UpdatedAt.Time,
			Version:   item.Version,
		}
	}

	output.Body.DownloadHistoryList = historyList
	return output
}

func (m *submoduleDownloadHistoryMng) openDownloadDest(fileName, path string) models.Output[any] {
	output := models.NewOutput[any]()

	path = filepath.Clean(path)

	if _, err := os.Stat(path); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return output.ThrowError(
				models.NewParamsMessage(
					cnst.MessageTypeError,
					cnst.Bucket,
					S3E014,
					err.Error(),
					map[string]any{"name": fileName},
				),
			)
		}
		return output.ThrowError(
			models.NewParamsMessage(
				cnst.MessageTypeError,
				cnst.Bucket,
				S3E015,
				err.Error(),
				map[string]any{"name": fileName},
			),
		)
	}

	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("explorer", "/select,", path)
	case "darwin":
		cmd = exec.Command("open", "-R", path)
	default:
		cmd = exec.Command("xdg-open", filepath.Dir(path))
	}

	if err := cmd.Start(); err != nil {
		return output.ThrowError(
			models.NewParamsMessage(
				cnst.MessageTypeError,
				cnst.Bucket,
				S3E016,
				err.Error(),
				map[string]any{"name": fileName},
			),
		)
	}

	return output
}
