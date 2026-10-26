package bucket

import (
	"S3Browser/models"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	// Emitted after a new connection profile is saved; payload is the created profile
	EventConnectSaveProfile     = "bucket:connect-save-profile"
	EventDownloadObjectProgress = "downloader:download-progress"
	EventLoadDownloadHistory    = "downloader:load-download-history"
	EventUploadObjectProgress   = "uploader:upload-progress"
	// Emitted when files are dropped on a tab's object list; payload is FilesDroppedOutput
	EventFilesDropped = "uploader:files-dropped"
	// Emitted before a file starts uploading; payload is UploadStartedOutput
	EventUploadObjectStarted = "uploader:upload-started"
	// Emitted when a file's upload ends; payload is UploadFinishedOutput
	EventUploadObjectFinished = "uploader:upload-finished"
)

// RegisterEvent must be called directly from init so the binding generator can
// emit the TypeScript payload type for Events.On / Events.Emit on the frontend.
func init() {
	application.RegisterEvent[models.ConnectionProfileOutput](EventConnectSaveProfile)
	application.RegisterEvent[models.DownloadProgressOutput](EventDownloadObjectProgress)
	application.RegisterEvent[models.DownloadHistoryItem](EventLoadDownloadHistory)
	application.RegisterEvent[models.UploadProgressOutput](EventUploadObjectProgress)
	application.RegisterEvent[models.FilesDroppedOutput](EventFilesDropped)
	application.RegisterEvent[models.UploadStartedOutput](EventUploadObjectStarted)
	application.RegisterEvent[models.UploadFinishedOutput](EventUploadObjectFinished)
}
