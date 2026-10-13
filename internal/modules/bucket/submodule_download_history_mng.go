package bucket

import (
	"S3Browser/internal/pkg/cnst"
	"S3Browser/internal/pkg/db/sqlc"
	"S3Browser/models"
	"context"
	"database/sql"
	"log/slog"
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
		DestPath: input.DestPath,
		Status:   DOWNLOADING,
	})

	if err != nil {
		return models.DownloadHistoryItem{}, err
	}

	return models.DownloadHistoryItem{
		ID:        saved.ID,
		FileName:  saved.FileName,
		DestPath:  saved.DestPath,
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
		ID:      input.ID,
		Status:  input.Status,
		Version: input.Version,
	})

	if err != nil {
		return models.DownloadHistoryItem{}, err
	}

	return models.DownloadHistoryItem{
		ID:        updated.ID,
		FileName:  updated.FileName,
		DestPath:  updated.DestPath,
		Status:    updated.Status,
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
		PageSize: input.PageSize,
	})

	if err != nil {
		return output.ThrowError(
			models.NewMessage(cnst.MessageTypeError, cnst.Bucket, S3E011, err.Error()),
		)
	}

	historyList := make([]models.DownloadHistoryItem, len(result))
	for idx, item := range result {
		historyList[idx] = models.DownloadHistoryItem{
			ID:        item.ID,
			FileName:  item.FileName,
			DestPath:  item.DestPath,
			Status:    item.Status,
			UpdatedAt: item.UpdatedAt.Time,
			Version:   item.Version,
		}
	}

	output.Body.DownloadHistoryList = historyList
	return output
}
