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
	ConnectionInput  = bucket.ConnectionInput
	ConnectionOutput = bucket.ConnectionOutput
	Bucket           = bucket.Bucket
	ListBucketInput  = bucket.ListBucketInput
	ListBucketOutput = bucket.ListBucketOutput
	ListObjectInput  = bucket.ListObjectInput
	ListObjectOutput = bucket.ListObjectOutput
	ObjectItem       = bucket.ObjectItem
)

// master
type (
	MasterOutput        = master.MasterOutput
	GetMasterDataOutput = master.GetMasterDataOutput
	RegionOutput        = master.RegionOutput
)

// profile
type (
	ConnectionProfileOutput       = profile.ConnectionProfileOutput
	GetAllConnectionProfileOutput = profile.GetAllConnectionProfileOutput
)

// common functions
var (
	CreateMessage           = common.CreateMessage
	CreateMessageWithParams = common.CreateMessageWithParams
)
