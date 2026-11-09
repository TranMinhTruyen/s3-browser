// Package models re-exports the input/output models of every domain under one import path,
// so modules and handlers only import "S3Browser/models".
package models

import (
	"S3Browser/models/bucket"
	"S3Browser/models/common"
	"S3Browser/models/master"
	"S3Browser/models/profile"
	"S3Browser/models/setting"
	"S3Browser/models/update"
)

type (
	// Message re-exports common.Message.
	Message = common.Message
	// Output re-exports common.Output.
	Output[T any] = common.Output[T]
)

type (
	// Bucket re-exports bucket.Bucket.
	Bucket = bucket.Bucket
	// ObjectItem re-exports bucket.ObjectItem.
	ObjectItem = bucket.ObjectItem
	// UploadObj re-exports bucket.UploadObj.
	UploadObj = bucket.UploadObj
	// DroppedFile re-exports bucket.DroppedFile.
	DroppedFile = bucket.DroppedFile
	// DroppedGroup re-exports bucket.DroppedGroup.
	DroppedGroup = bucket.DroppedGroup
	// CredentialExpiringOutput re-exports bucket.CredentialExpiringOutput.
	CredentialExpiringOutput = bucket.CredentialExpiringOutput
	// OidcLoginOutput re-exports bucket.OidcLoginOutput.
	OidcLoginOutput = bucket.OidcLoginOutput
	// ConnectOutput re-exports bucket.ConnectOutput.
	ConnectOutput = bucket.ConnectOutput
	// ListBucketInput re-exports bucket.ListBucketInput.
	ListBucketInput = bucket.ListBucketInput
	// ListBucketOutput re-exports bucket.ListBucketOutput.
	ListBucketOutput = bucket.ListBucketOutput
	// CheckBucketAccessInput re-exports bucket.CheckBucketAccessInput.
	CheckBucketAccessInput = bucket.CheckBucketAccessInput
	// CheckBucketAccessOutput re-exports bucket.CheckBucketAccessOutput.
	CheckBucketAccessOutput = bucket.CheckBucketAccessOutput
	// ListObjectInput re-exports bucket.ListObjectInput.
	ListObjectInput = bucket.ListObjectInput
	// ListObjectOutput re-exports bucket.ListObjectOutput.
	ListObjectOutput = bucket.ListObjectOutput
	// SearchObjectInput re-exports bucket.SearchObjectInput.
	SearchObjectInput = bucket.SearchObjectInput
	// SearchObjectOutput re-exports bucket.SearchObjectOutput.
	SearchObjectOutput = bucket.SearchObjectOutput
	// SearchBucketInput re-exports bucket.SearchBucketInput.
	SearchBucketInput = bucket.SearchBucketInput
	// SearchBucketOutput re-exports bucket.SearchBucketOutput.
	SearchBucketOutput = bucket.SearchBucketOutput
	// ObjectDetailInput re-exports bucket.ObjectDetailInput.
	ObjectDetailInput = bucket.ObjectDetailInput
	// ObjectDetailOutput re-exports bucket.ObjectDetailOutput.
	ObjectDetailOutput = bucket.ObjectDetailOutput
	// DownloadProgressBatchOutput re-exports bucket.DownloadProgressBatchOutput.
	DownloadProgressBatchOutput = bucket.DownloadProgressBatchOutput
	// DownloadProgressOutput re-exports bucket.DownloadProgressOutput.
	DownloadProgressOutput = bucket.DownloadProgressOutput
	// DownloadObjInput re-exports bucket.DownloadObjInput.
	DownloadObjInput = bucket.DownloadObjInput
	// UploadObjInput re-exports bucket.UploadObjInput.
	UploadObjInput = bucket.UploadObjInput
	// DownloadHistoryItem re-exports bucket.DownloadHistoryItem.
	DownloadHistoryItem = bucket.DownloadHistoryItem
	// DownloadHistoryInput re-exports bucket.DownloadHistoryInput.
	DownloadHistoryInput = bucket.DownloadHistoryInput
	// DownloadHistoryOutput re-exports bucket.DownloadHistoryOutput.
	DownloadHistoryOutput = bucket.DownloadHistoryOutput
	// DeleteFailure re-exports bucket.DeleteFailure.
	DeleteFailure = bucket.DeleteFailure
	// DeleteObjOutput re-exports bucket.DeleteObjOutput.
	DeleteObjOutput = bucket.DeleteObjOutput
	// DeleteObjInput re-exports bucket.DeleteObjInput.
	DeleteObjInput = bucket.DeleteObjInput
	// DeletePrefixInput re-exports bucket.DeletePrefixInput.
	DeletePrefixInput = bucket.DeletePrefixInput
	// DeletePrefixOutput re-exports bucket.DeletePrefixOutput.
	DeletePrefixOutput = bucket.DeletePrefixOutput
	// UploadProgressBatchOutput re-exports bucket.UploadProgressBatchOutput.
	UploadProgressBatchOutput = bucket.UploadProgressBatchOutput
	// UploadProgressOutput re-exports bucket.UploadProgressOutput.
	UploadProgressOutput = bucket.UploadProgressOutput
	// FilesDroppedOutput re-exports bucket.FilesDroppedOutput.
	FilesDroppedOutput = bucket.FilesDroppedOutput
	// UploadStartedOutput re-exports bucket.UploadStartedOutput.
	UploadStartedOutput = bucket.UploadStartedOutput
	// UploadFinishedOutput re-exports bucket.UploadFinishedOutput.
	UploadFinishedOutput = bucket.UploadFinishedOutput
	// UploadStatus re-exports bucket.UploadStatus.
	UploadStatus = bucket.UploadStatus
	// CreateBucketInput re-exports bucket.CreateBucketInput.
	CreateBucketInput = bucket.CreateBucketInput
	// BucketPolicyInput re-exports bucket.BucketPolicyInput.
	BucketPolicyInput = bucket.BucketPolicyInput
	// BucketPolicyOutput re-exports bucket.BucketPolicyOutput.
	BucketPolicyOutput = bucket.BucketPolicyOutput
	// PutBucketPolicyInput re-exports bucket.PutBucketPolicyInput.
	PutBucketPolicyInput = bucket.PutBucketPolicyInput
	// BucketDetailInput re-exports bucket.BucketDetailInput.
	BucketDetailInput = bucket.BucketDetailInput
	// BucketDetailOutput re-exports bucket.BucketDetailOutput.
	BucketDetailOutput = bucket.BucketDetailOutput
	// DeleteBucketInput re-exports bucket.DeleteBucketInput.
	DeleteBucketInput = bucket.DeleteBucketInput
	// DeleteBucketInfoOutput re-exports bucket.DeleteBucketInfoOutput.
	DeleteBucketInfoOutput = bucket.DeleteBucketInfoOutput
	// DeleteBucketOutput re-exports bucket.DeleteBucketOutput.
	DeleteBucketOutput = bucket.DeleteBucketOutput
)

const (
	// UploadStatusSuccess re-exports bucket.UploadStatusSuccess.
	// UploadStatusSuccess re-exports bucket.UploadStatusSuccess.
	UploadStatusSuccess = bucket.UploadStatusSuccess
	// UploadStatusError re-exports bucket.UploadStatusError.
	// UploadStatusError re-exports bucket.UploadStatusError.
	UploadStatusError = bucket.UploadStatusError
	// UploadStatusCanceled re-exports bucket.UploadStatusCanceled.
	// UploadStatusCanceled re-exports bucket.UploadStatusCanceled.
	UploadStatusCanceled = bucket.UploadStatusCanceled
)

type (
	// MasterOutput re-exports master.MasterOutput.
	MasterOutput = master.MasterOutput
	// GetMasterDataOutput re-exports master.GetMasterDataOutput.
	GetMasterDataOutput = master.GetMasterDataOutput
	// RegionOutput re-exports master.RegionOutput.
	RegionOutput = master.RegionOutput
)

type (
	// ConnectionProfileInput re-exports profile.ConnectionProfileInput.
	ConnectionProfileInput = profile.ConnectionProfileInput
	// ConnectionProfileOutput re-exports profile.ConnectionProfileOutput.
	ConnectionProfileOutput = profile.ConnectionProfileOutput
	// GetAllConnectionProfileOutput re-exports profile.GetAllConnectionProfileOutput.
	GetAllConnectionProfileOutput = profile.GetAllConnectionProfileOutput
	// ExportProfileInput re-exports profile.ExportProfileInput.
	ExportProfileInput = profile.ExportProfileInput
	// ImportProfileInput re-exports profile.ImportProfileInput.
	ImportProfileInput = profile.ImportProfileInput
	// ImportFileOutput re-exports profile.ImportFileOutput.
	ImportFileOutput = profile.ImportFileOutput
	// AuthConfig re-exports profile.AuthConfig.
	AuthConfig = profile.AuthConfig
	// AuthSecret re-exports profile.AuthSecret.
	AuthSecret = profile.AuthSecret
	// AwsProfileOutput re-exports profile.AwsProfileOutput.
	AwsProfileOutput = profile.AwsProfileOutput
)

// common functions
var (
	// NewMessage re-exports common.NewMessage.
	NewMessage = common.NewMessage
	// NewParamsMessage re-exports common.NewParamsMessage.
	NewParamsMessage = common.NewParamsMessage
)

// NewOutput wraps common.NewOutput because a generic function cannot be aliased with a var.
func NewOutput[T any]() Output[T] {
	return common.NewOutput[T]()
}

type (
	// AppSettings re-exports setting.AppSettings.
	AppSettings = setting.AppSettings
	// SaveSettingInput re-exports setting.SaveSettingInput.
	SaveSettingInput = setting.SaveSettingInput
	// SettingsOutput re-exports setting.SettingsOutput.
	SettingsOutput = setting.SettingsOutput
	// TabItem re-exports setting.TabItem.
	TabItem = setting.TabItem
	// TabState re-exports setting.TabState.
	TabState = setting.TabState
	// SaveTabStateInput re-exports setting.SaveTabStateInput.
	SaveTabStateInput = setting.SaveTabStateInput
)

type (
	// UpdateStateOutput re-exports update.UpdateStateOutput.
	UpdateStateOutput = update.UpdateStateOutput
)
