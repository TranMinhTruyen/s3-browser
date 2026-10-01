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
	ConnectOutput          = bucket.ConnectOutput
	ListBucketInput        = bucket.ListBucketInput
	ListBucketOutput       = bucket.ListBucketOutput
	ListObjectInput        = bucket.ListObjectInput
	ListObjectOutput       = bucket.ListObjectOutput
	DownloadProgressOutput = bucket.DownloadProgressOutput
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
	CreateMessage           = common.CreateMessage
	CreateMessageWithParams = common.CreateMessageWithParams
)
