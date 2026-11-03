package bucket

import (
	"S3Browser/models"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Event names emitted to the frontend, in the form domain:kebab-name.
const (
	// Emitted after a new connection profile is saved; payload is the created profile
	EventConnectSaveProfile = "bucket:connect-save-profile"
	// Emitted shortly before credentials that can't be renewed automatically expire; payload is
	// CredentialExpiringOutput
	EventCredentialExpiring = "bucket:credential-expiring"
	// Emitted every 200 ms while downloads run, and once more when one ends; payload is
	// DownloadProgressBatchOutput (the progress of every running download)
	EventDownloadProgressBatch = "downloader:download-progress-batch"
	// Emitted when a history record is created or updated; payload is DownloadHistoryItem
	EventLoadDownloadHistory = "downloader:load-download-history"
	// Emitted every 200 ms while uploads run, and once more when one ends; payload is
	// UploadProgressBatchOutput (the progress of every running upload)
	EventUploadProgressBatch = "uploader:upload-progress-batch"
	// Emitted when files are dropped on a tab's object list; payload is FilesDroppedOutput
	EventFilesDropped = "uploader:files-dropped"
	// Emitted when files are dropped on the upload picker modal; payload is FilesDroppedOutput
	EventPickerFilesDropped = "uploader:picker-files-dropped"
	// Emitted before a file starts uploading; payload is UploadStartedOutput
	EventUploadObjectStarted = "uploader:upload-started"
	// Emitted when a file's upload ends; payload is UploadFinishedOutput
	EventUploadObjectFinished = "uploader:upload-finished"
)

// RegisterEvent must be called directly from init so the binding generator can
// emit the TypeScript payload type for Events.On / Events.Emit on the frontend.
func init() {
	application.RegisterEvent[models.ConnectionProfileOutput](EventConnectSaveProfile)
	application.RegisterEvent[models.CredentialExpiringOutput](EventCredentialExpiring)
	application.RegisterEvent[models.DownloadProgressBatchOutput](EventDownloadProgressBatch)
	application.RegisterEvent[models.DownloadHistoryItem](EventLoadDownloadHistory)
	application.RegisterEvent[models.UploadProgressBatchOutput](EventUploadProgressBatch)
	application.RegisterEvent[models.FilesDroppedOutput](EventFilesDropped)
	application.RegisterEvent[models.FilesDroppedOutput](EventPickerFilesDropped)
	application.RegisterEvent[models.UploadStartedOutput](EventUploadObjectStarted)
	application.RegisterEvent[models.UploadFinishedOutput](EventUploadObjectFinished)
}
