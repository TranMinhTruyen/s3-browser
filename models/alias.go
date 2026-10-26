package models

import (
	"S3Browser/models/bucket"
	"S3Browser/models/common"
	"S3Browser/models/master"
	"S3Browser/models/profile"
)

// common
type (
	Message       = common.Message
	Output[T any] = common.Output[T]
)

// bucket
type (
	Bucket                 = bucket.Bucket
	ObjectItem             = bucket.ObjectItem
	UploadObj              = bucket.UploadObj
	DroppedFile            = bucket.DroppedFile
	ConnectOutput          = bucket.ConnectOutput
	ListBucketInput        = bucket.ListBucketInput
	ListBucketOutput       = bucket.ListBucketOutput
	ListObjectInput        = bucket.ListObjectInput
	ListObjectOutput       = bucket.ListObjectOutput
	DownloadProgressOutput = bucket.DownloadProgressOutput
	DownloadObjInput       = bucket.DownloadObjInput
	UploadObjInput         = bucket.UploadObjInput
	DownloadHistoryItem    = bucket.DownloadHistoryItem
	DownloadHistoryInput   = bucket.DownloadHistoryInput
	DownloadHistoryOutput  = bucket.DownloadHistoryOutput
	DeleteObjInput         = bucket.DeleteObjInput
	UploadProgressOutput   = bucket.UploadProgressOutput
	FilesDroppedOutput     = bucket.FilesDroppedOutput
	UploadStartedOutput    = bucket.UploadStartedOutput
	UploadFinishedOutput   = bucket.UploadFinishedOutput
	UploadStatus           = bucket.UploadStatus
)

const (
	UploadStatusSuccess  = bucket.UploadStatusSuccess
	UploadStatusError    = bucket.UploadStatusError
	UploadStatusCanceled = bucket.UploadStatusCanceled
)

// master
type (
	MasterOutput        = master.MasterOutput
	GetMasterDataOutput = master.GetMasterDataOutput
	RegionOutput        = master.RegionOutput
)

// profile
type (
	ConnectionProfileInput        = profile.ConnectionProfileInput
	ConnectionProfileOutput       = profile.ConnectionProfileOutput
	GetAllConnectionProfileOutput = profile.GetAllConnectionProfileOutput
)

// common functions
var (
	NewMessage       = common.NewMessage
	NewParamsMessage = common.NewParamsMessage
)

// wraper func
func NewOutput[T any]() Output[T] {
	return common.NewOutput[T]()
}

func NewMessages() *Message {
	m := &Message{}
	m.New()
	return m
}
