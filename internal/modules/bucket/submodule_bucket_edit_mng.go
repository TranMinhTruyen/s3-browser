package bucket

import (
	"S3Browser/internal/modules/global"
	"S3Browser/internal/pkg/cnst"
	"S3Browser/models"
	"cmp"
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// defaultBucketRegion is the region AWS creates a bucket in without a LocationConstraint.
const defaultBucketRegion = "us-east-1"

// createPolicyRetries is how many times setting the policy of a new bucket is retried on NoSuchBucket.
const createPolicyRetries = 3

// submoduleBucketEditMng creates buckets and reads or changes their policy and details.
type submoduleBucketEditMng struct {
	logger *slog.Logger
	app    *application.App
	global *global.Module
}

// newSubmoduleBucketEditMng builds the bucket edit submodule on the shared connection store.
func newSubmoduleBucketEditMng(
	app *application.App,
	logger *slog.Logger,
	global *global.Module,
) *submoduleBucketEditMng {
	return &submoduleBucketEditMng{
		logger: logger.With("submodules", "bucket_edit_mng"),
		app:    app,
		global: global,
	}
}

// isRealAws reports whether the connection talks to AWS itself, not MinIO or a custom endpoint.
func isRealAws(conn *global.S3Conn) bool {
	return conn.Provider != cnst.ProviderMinio && !conn.CustomEndpoint
}

// createBucket creates input.Bucket (30s timeout). Any failure, including a wrong region, is reported as is:
// nothing is retried and no half-made state is left.
func (m *submoduleBucketEditMng) createBucket(
	ctx context.Context,
	input models.CreateBucketInput,
) models.Output[any] {
	ctx, cancel := withCallContext(ctx, m.app.Context(), 30*time.Second)
	defer cancel()

	output := models.NewOutput[any]()

	conn, ok := m.global.GetConnContainer(input.ConnectionId)
	if !ok {
		return output.ThrowError(notConnectedMessage(input.ProfileName))
	}
	if conn.AuthType == cnst.AuthAnonymous {
		return output.ThrowError(anonymousEditMessage())
	}

	mode := cmp.Or(input.Mode, policyModePrivate)
	switch validPolicyMode(mode, input.Policy) {
	case errInvalidMode:
		return output.ThrowError(bucketMessage(cnst.MessageTypeError, S3E053, input.Bucket, "invalid mode"))
	case errInvalidPolicy:
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Bucket, S3E057, ""))
	}

	createInput := &s3.CreateBucketInput{Bucket: &input.Bucket}
	var optFns []func(*s3.Options)
	if isRealAws(conn) {
		region := cmp.Or(input.Region, conn.Client.Options().Region, defaultBucketRegion)
		optFns = append(optFns, func(o *s3.Options) { o.Region = region })
		if region != defaultBucketRegion {
			createInput.CreateBucketConfiguration = &types.CreateBucketConfiguration{
				LocationConstraint: types.BucketLocationConstraint(region),
			}
		}
	}

	if _, err := conn.Client.CreateBucket(ctx, createInput, optFns...); err != nil {
		m.logger.Error("create bucket failed", slog.String("bucket", input.Bucket), slog.Any("error", err))
		return bucketEditFailed(ctx, output, input.ProfileName, input.Bucket, err, S3E053)
	}

	conn.Access.Reset()
	if mode == policyModePrivate {
		return *output.AddMessage(bucketMessage(cnst.MessageTypeSuccess, S3S007, input.Bucket, ""))
	}

	// The bucket exists from here on: a failed policy is a warning and the call still succeeds.
	err := applyPolicyAfterCreate(ctx, conn, input.Bucket, mode, input.Policy, optFns)
	switch {
	case err == nil:
		return *output.AddMessage(bucketMessage(cnst.MessageTypeSuccess, S3S007, input.Bucket, ""))
	case isCallCanceled(ctx):
		return output
	}
	m.logger.Warn("set policy of new bucket failed", slog.String("bucket", input.Bucket), slog.Any("error", err))
	code := S3W011
	if bucketEditCode(err, "") == S3E052 {
		if blocked, _ := readPublicBlocked(ctx, conn, input.Bucket, optFns...); blocked {
			code = S3W012
		}
	}
	return *output.AddMessage(bucketMessage(cnst.MessageTypeWarn, code, input.Bucket, UnwrapAwsError(err)))
}

// applyPolicyAfterCreate sets the policy of a new bucket. Real AWS can answer NoSuchBucket for a moment after the
// bucket is created, so that answer is retried up to createPolicyRetries times, one second apart.
func applyPolicyAfterCreate(
	ctx context.Context,
	conn *global.S3Conn,
	bucket, mode, pol string,
	optFns []func(*s3.Options),
) error {
	for retry := 0; ; retry++ {
		err := applyBucketPolicy(ctx, conn, bucket, mode, pol, optFns...)
		if err == nil || retry == createPolicyRetries || !isRealAws(conn) || UnwrapAwsError(err) != "NoSuchBucket" {
			return err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Second):
		}
	}
}

// bucketMessage is a message of the bucket module with the bucket param.
func bucketMessage(messageType, code, bucket, errorDetail string) models.Message {
	return models.NewParamsMessage(messageType, cnst.Bucket, code, errorDetail, map[string]any{
		"bucket": bucket,
	})
}

// anonymousEditMessage is the S3E054 message.
func anonymousEditMessage() models.Message {
	return models.NewMessage(cnst.MessageTypeError, cnst.Bucket, S3E054, "")
}

// bucketEditCode maps an error of creating or changing a bucket to a message code: AccessDenied gives S3E052,
// a taken name S3E050, an invalid name S3E051, anything else fallbackCode.
func bucketEditCode(err error, fallbackCode string) string {
	switch detail := UnwrapAwsError(err); {
	case detail == "AccessDenied" || statusCode(err) == http.StatusForbidden:
		return S3E052
	case detail == "BucketAlreadyExists" || detail == "BucketAlreadyOwnedByYou":
		return S3E050
	case detail == "InvalidBucketName":
		return S3E051
	}
	return fallbackCode
}

// bucketEditFailed ends a failed create or change of a bucket with the message of bucketEditCode and the AWS
// error code as detail.
func bucketEditFailed[T any](
	ctx context.Context,
	output models.Output[T],
	profileName, bucket string,
	err error,
	fallbackCode string,
) models.Output[T] {
	failed := bucketMessage(cnst.MessageTypeError, bucketEditCode(err, fallbackCode), bucket, UnwrapAwsError(err))
	return failCall(ctx, output, profileName, err, failed)
}
