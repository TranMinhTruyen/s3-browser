// Package models tái xuất các model đầu vào/đầu ra của mọi miền dưới một import path,
// để module và handler chỉ cần import "S3Browser/models".
package models

import (
	"S3Browser/models/bucket"
	"S3Browser/models/common"
	"S3Browser/models/db"
	"S3Browser/models/master"
	"S3Browser/models/profile"
	"S3Browser/models/setting"
	"S3Browser/models/update"
)

type (
	// Message tái xuất common.Message.
	Message = common.Message
	// Output tái xuất common.Output.
	Output[T any] = common.Output[T]
)

type (
	// Bucket tái xuất bucket.Bucket.
	Bucket = bucket.Bucket
	// ObjectItem tái xuất bucket.ObjectItem.
	ObjectItem = bucket.ObjectItem
	// UploadObj tái xuất bucket.UploadObj.
	UploadObj = bucket.UploadObj
	// DroppedFile tái xuất bucket.DroppedFile.
	DroppedFile = bucket.DroppedFile
	// DroppedGroup tái xuất bucket.DroppedGroup.
	DroppedGroup = bucket.DroppedGroup
	// CredentialExpiringOutput tái xuất bucket.CredentialExpiringOutput.
	CredentialExpiringOutput = bucket.CredentialExpiringOutput
	// OidcLoginOutput tái xuất bucket.OidcLoginOutput.
	OidcLoginOutput = bucket.OidcLoginOutput
	// ConnectOutput tái xuất bucket.ConnectOutput.
	ConnectOutput = bucket.ConnectOutput
	// ListBucketInput tái xuất bucket.ListBucketInput.
	ListBucketInput = bucket.ListBucketInput
	// ListBucketOutput tái xuất bucket.ListBucketOutput.
	ListBucketOutput = bucket.ListBucketOutput
	// CheckBucketAccessInput tái xuất bucket.CheckBucketAccessInput.
	CheckBucketAccessInput = bucket.CheckBucketAccessInput
	// CheckBucketAccessOutput tái xuất bucket.CheckBucketAccessOutput.
	CheckBucketAccessOutput = bucket.CheckBucketAccessOutput
	// ListObjectInput tái xuất bucket.ListObjectInput.
	ListObjectInput = bucket.ListObjectInput
	// ListObjectOutput tái xuất bucket.ListObjectOutput.
	ListObjectOutput = bucket.ListObjectOutput
	// SearchObjectInput tái xuất bucket.SearchObjectInput.
	SearchObjectInput = bucket.SearchObjectInput
	// SearchObjectOutput tái xuất bucket.SearchObjectOutput.
	SearchObjectOutput = bucket.SearchObjectOutput
	// SearchBucketInput tái xuất bucket.SearchBucketInput.
	SearchBucketInput = bucket.SearchBucketInput
	// SearchBucketOutput tái xuất bucket.SearchBucketOutput.
	SearchBucketOutput = bucket.SearchBucketOutput
	// ObjectDetailInput tái xuất bucket.ObjectDetailInput.
	ObjectDetailInput = bucket.ObjectDetailInput
	// ObjectDetailOutput tái xuất bucket.ObjectDetailOutput.
	ObjectDetailOutput = bucket.ObjectDetailOutput
	// DownloadProgressBatchOutput tái xuất bucket.DownloadProgressBatchOutput.
	DownloadProgressBatchOutput = bucket.DownloadProgressBatchOutput
	// DownloadProgressOutput tái xuất bucket.DownloadProgressOutput.
	DownloadProgressOutput = bucket.DownloadProgressOutput
	// DownloadObjInput tái xuất bucket.DownloadObjInput.
	DownloadObjInput = bucket.DownloadObjInput
	// UploadObjInput tái xuất bucket.UploadObjInput.
	UploadObjInput = bucket.UploadObjInput
	// DownloadHistoryItem tái xuất bucket.DownloadHistoryItem.
	DownloadHistoryItem = bucket.DownloadHistoryItem
	// DownloadHistoryInput tái xuất bucket.DownloadHistoryInput.
	DownloadHistoryInput = bucket.DownloadHistoryInput
	// DownloadHistoryOutput tái xuất bucket.DownloadHistoryOutput.
	DownloadHistoryOutput = bucket.DownloadHistoryOutput
	// DeleteFailure tái xuất bucket.DeleteFailure.
	DeleteFailure = bucket.DeleteFailure
	// DeleteObjOutput tái xuất bucket.DeleteObjOutput.
	DeleteObjOutput = bucket.DeleteObjOutput
	// DeleteObjInput tái xuất bucket.DeleteObjInput.
	DeleteObjInput = bucket.DeleteObjInput
	// DeletePrefixInput tái xuất bucket.DeletePrefixInput.
	DeletePrefixInput = bucket.DeletePrefixInput
	// DeletePrefixOutput tái xuất bucket.DeletePrefixOutput.
	DeletePrefixOutput = bucket.DeletePrefixOutput
	// UploadProgressBatchOutput tái xuất bucket.UploadProgressBatchOutput.
	UploadProgressBatchOutput = bucket.UploadProgressBatchOutput
	// UploadProgressOutput tái xuất bucket.UploadProgressOutput.
	UploadProgressOutput = bucket.UploadProgressOutput
	// FilesDroppedOutput tái xuất bucket.FilesDroppedOutput.
	FilesDroppedOutput = bucket.FilesDroppedOutput
	// UploadStartedOutput tái xuất bucket.UploadStartedOutput.
	UploadStartedOutput = bucket.UploadStartedOutput
	// UploadFinishedOutput tái xuất bucket.UploadFinishedOutput.
	UploadFinishedOutput = bucket.UploadFinishedOutput
	// UploadStatus tái xuất bucket.UploadStatus.
	UploadStatus = bucket.UploadStatus
	// CreateBucketInput tái xuất bucket.CreateBucketInput.
	CreateBucketInput = bucket.CreateBucketInput
	// BucketPolicyInput tái xuất bucket.BucketPolicyInput.
	BucketPolicyInput = bucket.BucketPolicyInput
	// BucketPolicyOutput tái xuất bucket.BucketPolicyOutput.
	BucketPolicyOutput = bucket.BucketPolicyOutput
	// PutBucketPolicyInput tái xuất bucket.PutBucketPolicyInput.
	PutBucketPolicyInput = bucket.PutBucketPolicyInput
	// BucketDetailInput tái xuất bucket.BucketDetailInput.
	BucketDetailInput = bucket.BucketDetailInput
	// BucketDetailOutput tái xuất bucket.BucketDetailOutput.
	BucketDetailOutput = bucket.BucketDetailOutput
	// DeleteBucketInput tái xuất bucket.DeleteBucketInput.
	DeleteBucketInput = bucket.DeleteBucketInput
	// DeleteBucketInfoOutput tái xuất bucket.DeleteBucketInfoOutput.
	DeleteBucketInfoOutput = bucket.DeleteBucketInfoOutput
	// DeleteBucketOutput tái xuất bucket.DeleteBucketOutput.
	DeleteBucketOutput = bucket.DeleteBucketOutput
)

const (
	// UploadStatusSuccess tái xuất bucket.UploadStatusSuccess.
	// UploadStatusSuccess tái xuất bucket.UploadStatusSuccess.
	UploadStatusSuccess = bucket.UploadStatusSuccess
	// UploadStatusError tái xuất bucket.UploadStatusError.
	// UploadStatusError tái xuất bucket.UploadStatusError.
	UploadStatusError = bucket.UploadStatusError
	// UploadStatusCanceled tái xuất bucket.UploadStatusCanceled.
	// UploadStatusCanceled tái xuất bucket.UploadStatusCanceled.
	UploadStatusCanceled = bucket.UploadStatusCanceled
)

type (
	// MasterOutput tái xuất master.MasterOutput.
	MasterOutput = master.MasterOutput
	// GetMasterDataOutput tái xuất master.GetMasterDataOutput.
	GetMasterDataOutput = master.GetMasterDataOutput
	// RegionOutput tái xuất master.RegionOutput.
	RegionOutput = master.RegionOutput
)

type (
	// ConnectionProfileInput tái xuất profile.ConnectionProfileInput.
	ConnectionProfileInput = profile.ConnectionProfileInput
	// ConnectionProfileOutput tái xuất profile.ConnectionProfileOutput.
	ConnectionProfileOutput = profile.ConnectionProfileOutput
	// GetAllConnectionProfileOutput tái xuất profile.GetAllConnectionProfileOutput.
	GetAllConnectionProfileOutput = profile.GetAllConnectionProfileOutput
	// ExportProfileInput tái xuất profile.ExportProfileInput.
	ExportProfileInput = profile.ExportProfileInput
	// ImportProfileInput tái xuất profile.ImportProfileInput.
	ImportProfileInput = profile.ImportProfileInput
	// ImportFileOutput tái xuất profile.ImportFileOutput.
	ImportFileOutput = profile.ImportFileOutput
	// AuthConfig tái xuất profile.AuthConfig.
	AuthConfig = profile.AuthConfig
	// AuthSecret tái xuất profile.AuthSecret.
	AuthSecret = profile.AuthSecret
	// AwsProfileOutput tái xuất profile.AwsProfileOutput.
	AwsProfileOutput = profile.AwsProfileOutput
)

type (
	// DbProfileConfig tái xuất db.DbProfileConfig.
	DbProfileConfig = db.DbProfileConfig
	// DbProfileInput tái xuất db.DbProfileInput.
	DbProfileInput = db.DbProfileInput
	// DbProfileRefInput tái xuất db.DbProfileRefInput.
	DbProfileRefInput = db.DbProfileRefInput
	// DbProfileOutput tái xuất db.DbProfileOutput.
	DbProfileOutput = db.DbProfileOutput
	// GetAllDbProfileOutput tái xuất db.GetAllDbProfileOutput.
	GetAllDbProfileOutput = db.GetAllDbProfileOutput
	// TableInfoInput tái xuất db.TableInfoInput.
	TableInfoInput = db.TableInfoInput
	// ExecuteSqlInput tái xuất db.ExecuteSqlInput.
	ExecuteSqlInput = db.ExecuteSqlInput
	// OpenTableRowsInput tái xuất db.OpenTableRowsInput.
	OpenTableRowsInput = db.OpenTableRowsInput
	// FetchRowsInput tái xuất db.FetchRowsInput.
	FetchRowsInput = db.FetchRowsInput
	// CloseDbTabInput tái xuất db.CloseDbTabInput.
	CloseDbTabInput = db.CloseDbTabInput
	// DbColumn tái xuất db.DbColumn.
	DbColumn = db.DbColumn
	// StatementError tái xuất db.StatementError.
	StatementError = db.StatementError
	// StatementResult tái xuất db.StatementResult.
	StatementResult = db.StatementResult
	// ExecuteSqlOutput tái xuất db.ExecuteSqlOutput.
	ExecuteSqlOutput = db.ExecuteSqlOutput
	// FetchRowsOutput tái xuất db.FetchRowsOutput.
	FetchRowsOutput = db.FetchRowsOutput
	// DbObject tái xuất db.DbObject.
	DbObject = db.DbObject
	// DbSchema tái xuất db.DbSchema.
	DbSchema = db.DbSchema
	// SchemaTreeOutput tái xuất db.SchemaTreeOutput.
	SchemaTreeOutput = db.SchemaTreeOutput
	// TableColumn tái xuất db.TableColumn.
	TableColumn = db.TableColumn
	// TableIndex tái xuất db.TableIndex.
	TableIndex = db.TableIndex
	// TableConstraint tái xuất db.TableConstraint.
	TableConstraint = db.TableConstraint
	// TableForeignKey tái xuất db.TableForeignKey.
	TableForeignKey = db.TableForeignKey
	// TableInfoOutput tái xuất db.TableInfoOutput.
	TableInfoOutput = db.TableInfoOutput
)

// Các hàm dùng chung.
var (
	// NewMessage tái xuất common.NewMessage.
	NewMessage = common.NewMessage
	// NewParamsMessage tái xuất common.NewParamsMessage.
	NewParamsMessage = common.NewParamsMessage
)

// NewOutput bọc common.NewOutput vì không thể alias hàm generic bằng var.
func NewOutput[T any]() Output[T] {
	return common.NewOutput[T]()
}

type (
	// AppSettings tái xuất setting.AppSettings.
	AppSettings = setting.AppSettings
	// SaveSettingInput tái xuất setting.SaveSettingInput.
	SaveSettingInput = setting.SaveSettingInput
	// SettingsOutput tái xuất setting.SettingsOutput.
	SettingsOutput = setting.SettingsOutput
	// TabItem tái xuất setting.TabItem.
	TabItem = setting.TabItem
	// TabState tái xuất setting.TabState.
	TabState = setting.TabState
	// SaveTabStateInput tái xuất setting.SaveTabStateInput.
	SaveTabStateInput = setting.SaveTabStateInput
	// SqlTabTable tái xuất setting.SqlTabTable.
	SqlTabTable = setting.SqlTabTable
	// SqlTabItem tái xuất setting.SqlTabItem.
	SqlTabItem = setting.SqlTabItem
	// SaveSqlTabStateInput tái xuất setting.SaveSqlTabStateInput.
	SaveSqlTabStateInput = setting.SaveSqlTabStateInput
)

type (
	// UpdateStateOutput tái xuất update.UpdateStateOutput.
	UpdateStateOutput = update.UpdateStateOutput
)
