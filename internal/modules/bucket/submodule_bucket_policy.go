package bucket

import (
	"S3Browser/internal/modules/global"
	"S3Browser/internal/pkg/cnst"
	"S3Browser/models"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"reflect"
	"slices"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/minio/madmin-go/v4"
	"github.com/minio/pkg/v3/policy"
)

// Access modes of a bucket.
const (
	policyModePrivate = "private"
	policyModePublic  = "public"
	policyModeCustom  = "custom"
)

// getBucketPolicy reads the access state of input.Bucket (10s timeout).
func (m *submoduleBucketEditMng) getBucketPolicy(
	ctx context.Context,
	input models.BucketPolicyInput,
) models.Output[models.BucketPolicyOutput] {
	ctx, cancel := withCallContext(ctx, m.app.Context(), 10*time.Second)
	defer cancel()

	output := models.NewOutput[models.BucketPolicyOutput]()

	conn, ok := m.global.GetConnContainer(input.ConnectionId)
	if !ok {
		return output.ThrowError(notConnectedMessage(input.ProfileName))
	}
	if conn.AuthType == cnst.AuthAnonymous {
		return output.ThrowError(anonymousEditMessage())
	}

	state, err := m.loadPolicyState(ctx, conn, input.Bucket, policyOptFns(ctx, conn, input.Bucket))
	if err != nil {
		m.logger.Error("get bucket policy failed", slog.String("bucket", input.Bucket), slog.Any("error", err))
		return bucketEditFailed(ctx, output, input.ProfileName, input.Bucket, err, S3E055)
	}
	state.EditDenied = policyEditDenied(ctx, conn, input.Bucket)

	output.Body = state
	return output
}

// putBucketPolicy sets the access mode of input.Bucket (30s timeout) and returns the state read back.
func (m *submoduleBucketEditMng) putBucketPolicy(
	ctx context.Context,
	input models.PutBucketPolicyInput,
) models.Output[models.BucketPolicyOutput] {
	ctx, cancel := withCallContext(ctx, m.app.Context(), 30*time.Second)
	defer cancel()

	output := models.NewOutput[models.BucketPolicyOutput]()

	conn, ok := m.global.GetConnContainer(input.ConnectionId)
	if !ok {
		return output.ThrowError(notConnectedMessage(input.ProfileName))
	}
	if conn.AuthType == cnst.AuthAnonymous {
		return output.ThrowError(anonymousEditMessage())
	}

	switch validPolicyMode(input.Mode, input.Policy) {
	case errInvalidMode:
		return output.ThrowError(bucketMessage(cnst.MessageTypeError, S3E056, input.Bucket, "invalid mode"))
	case errInvalidPolicy:
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Bucket, S3E057, ""))
	}
	optFns := policyOptFns(ctx, conn, input.Bucket)
	if err := applyBucketPolicy(ctx, conn, input.Bucket, input.Mode, input.Policy, optFns...); err != nil {
		m.logger.Error("put bucket policy failed", slog.String("bucket", input.Bucket), slog.Any("error", err))
		return putPolicyFailed(ctx, conn, output, input, err, optFns)
	}

	conn.Access.Reset()
	state, err := m.loadPolicyState(ctx, conn, input.Bucket, optFns)
	if err != nil {
		// Saved, only the read back failed: show what was asked.
		m.logger.Warn("read back bucket policy failed", slog.String("bucket", input.Bucket), slog.Any("error", err))
		state = models.BucketPolicyOutput{Mode: input.Mode, Policy: input.Policy}
	}
	state.EditDenied = policyEditDenied(ctx, conn, input.Bucket)

	output.Body = state
	return *output.AddMessage(bucketMessage(cnst.MessageTypeSuccess, S3S008, input.Bucket, ""))
}

var (
	errInvalidMode   = errors.New("invalid policy mode")
	errInvalidPolicy = errors.New("invalid policy json")
)

// validPolicyMode checks mode and, for custom, that policy is JSON. It returns nil, errInvalidMode or errInvalidPolicy.
func validPolicyMode(mode, pol string) error {
	switch mode {
	case policyModePrivate, policyModePublic:
		return nil
	case policyModeCustom:
		if !json.Valid([]byte(pol)) {
			return errInvalidPolicy
		}
		return nil
	}
	return errInvalidMode
}

// applyBucketPolicy sets the access mode of the bucket: private deletes the policy, public and custom put one.
// The mode must have passed validPolicyMode.
func applyBucketPolicy(
	ctx context.Context,
	conn *global.S3Conn,
	bucket, mode, pol string,
	optFns ...func(*s3.Options),
) error {
	var err error
	switch mode {
	case policyModePrivate:
		_, err = conn.Client.DeleteBucketPolicy(ctx, &s3.DeleteBucketPolicyInput{Bucket: &bucket}, optFns...)
	case policyModePublic:
		_, err = conn.Client.PutBucketPolicy(ctx, &s3.PutBucketPolicyInput{
			Bucket: &bucket,
			Policy: aws.String(publicReadPolicy(bucket)),
		}, optFns...)
	case policyModeCustom:
		_, err = conn.Client.PutBucketPolicy(ctx, &s3.PutBucketPolicyInput{Bucket: &bucket, Policy: &pol}, optFns...)
	}
	return err
}

// policyOptFns sends the policy requests of real AWS to the region of the bucket. Elsewhere, or when the region
// can't be read, it returns nil and the connection region is used.
func policyOptFns(ctx context.Context, conn *global.S3Conn, bucket string) []func(*s3.Options) {
	if !isRealAws(conn) {
		return nil
	}
	region, err := readBucketRegion(ctx, conn, bucket)
	if err != nil {
		return nil
	}
	return regionOptFns(conn, region)
}

// putPolicyFailed maps a failed save: a malformed policy gives S3E057, a denied public policy under Block Public
// Access S3E058, anything else the generic bucket edit errors with S3E056 as fallback.
func putPolicyFailed(
	ctx context.Context,
	conn *global.S3Conn,
	output models.Output[models.BucketPolicyOutput],
	input models.PutBucketPolicyInput,
	err error,
	optFns []func(*s3.Options),
) models.Output[models.BucketPolicyOutput] {
	if UnwrapAwsError(err) == "MalformedPolicy" {
		return failCall(ctx, output, input.ProfileName, err,
			models.NewMessage(cnst.MessageTypeError, cnst.Bucket, S3E057, UnwrapAwsError(err)))
	}
	if input.Mode != policyModePrivate && bucketEditCode(err, S3E056) == S3E052 {
		if blocked, _ := readPublicBlocked(ctx, conn, input.Bucket, optFns...); blocked {
			return failCall(ctx, output, input.ProfileName, err,
				bucketMessage(cnst.MessageTypeError, S3E058, input.Bucket, UnwrapAwsError(err)))
		}
	}
	return bucketEditFailed(ctx, output, input.ProfileName, input.Bucket, err, S3E056)
}

// loadPolicyState reads the mode, policy and Block Public Access of the bucket. Only the policy read can fail the
// call: a Block Public Access read that fails counts as not blocked.
func (m *submoduleBucketEditMng) loadPolicyState(
	ctx context.Context,
	conn *global.S3Conn,
	bucket string,
	optFns []func(*s3.Options),
) (models.BucketPolicyOutput, error) {
	mode, pol, err := readPolicyMode(ctx, conn, bucket, optFns...)
	if err != nil {
		return models.BucketPolicyOutput{}, err
	}
	blocked, err := readPublicBlocked(ctx, conn, bucket, optFns...)
	if err != nil {
		m.logger.Debug("read public access block failed", slog.String("bucket", bucket), slog.Any("error", err))
	}
	return models.BucketPolicyOutput{Mode: mode, Policy: pol, PublicBlocked: blocked}, nil
}

// readPolicyMode returns the access mode of the bucket and its policy JSON (indented, empty when private).
func readPolicyMode(
	ctx context.Context,
	conn *global.S3Conn,
	bucket string,
	optFns ...func(*s3.Options),
) (mode, pol string, err error) {
	result, err := conn.Client.GetBucketPolicy(ctx, &s3.GetBucketPolicyInput{Bucket: &bucket}, optFns...)
	if err != nil {
		if UnwrapAwsError(err) == "NoSuchBucketPolicy" {
			return policyModePrivate, "", nil
		}
		return "", "", err
	}

	pol = aws.ToString(result.Policy)
	mode = policyModeCustom
	if samePolicy(pol, publicReadPolicy(bucket)) {
		mode = policyModePublic
	}
	var indented bytes.Buffer
	if json.Indent(&indented, []byte(pol), "", "  ") == nil {
		pol = indented.String()
	}
	return mode, pol, nil
}

// readPublicBlocked reports whether Block Public Access forbids a public policy. Only real AWS has it.
func readPublicBlocked(
	ctx context.Context,
	conn *global.S3Conn,
	bucket string,
	optFns ...func(*s3.Options),
) (bool, error) {
	if !isRealAws(conn) {
		return false, nil
	}
	result, err := conn.Client.GetPublicAccessBlock(ctx, &s3.GetPublicAccessBlockInput{Bucket: &bucket}, optFns...)
	if err != nil {
		if UnwrapAwsError(err) == "NoSuchPublicAccessBlockConfiguration" {
			return false, nil
		}
		return false, err
	}
	return result.PublicAccessBlockConfiguration != nil &&
		aws.ToBool(result.PublicAccessBlockConfiguration.BlockPublicPolicy), nil
}

// policyEditDenied reports whether the MinIO account is known not to be allowed to change the bucket policy.
// Without admin access, on a failed AccountInfo or a policy that is not simple, the answer is false.
func policyEditDenied(ctx context.Context, conn *global.S3Conn, bucket string) bool {
	if conn.MinioAdmin == nil {
		return false
	}
	callCtx, cancel := context.WithTimeout(ctx, bucketProbeTimeout)
	defer cancel()
	info, err := conn.MinioAdmin.AccountInfo(callCtx, madmin.AccountOpts{})
	if err != nil {
		return false
	}
	pol, err := policy.ParseConfig(bytes.NewReader(info.Policy))
	if err != nil || !isSimplePolicy(info.Policy) {
		return false
	}
	for _, action := range []policy.Action{policy.PutBucketPolicyAction, policy.DeleteBucketPolicyAction} {
		if !pol.IsAllowed(policy.Args{
			Action:          action,
			BucketName:      bucket,
			ConditionValues: map[string][]string{},
		}) {
			return true
		}
	}
	return false
}

// publicReadPolicy is the policy of the "public" mode: everyone can list the bucket and read its objects.
func publicReadPolicy(bucket string) string {
	arn := "arn:aws:s3:::" + bucket
	raw, _ := json.Marshal(map[string]any{
		"Version": "2012-10-17",
		"Statement": []map[string]any{
			{
				"Effect":    "Allow",
				"Principal": "*",
				"Action":    []string{"s3:GetBucketLocation", "s3:ListBucket"},
				"Resource":  arn,
			},
			{
				"Effect":    "Allow",
				"Principal": "*",
				"Action":    []string{"s3:GetObject"},
				"Resource":  arn + "/*",
			},
		},
	})
	return string(raw)
}

// samePolicy reports whether a and b are the same policy, ignoring formatting, key order and the string-or-array
// form MinIO normalizes (Principal "*" is {"AWS":["*"]}, Action and Resource are lists).
func samePolicy(a, b string) bool {
	x, okA := canonicalPolicy(a)
	y, okB := canonicalPolicy(b)
	return okA && okB && reflect.DeepEqual(x, y)
}

// canonicalPolicy parses a policy and rewrites Principal, Action and Resource of each statement to sorted lists.
func canonicalPolicy(raw string) (map[string]any, bool) {
	var pol map[string]any
	if json.Unmarshal([]byte(raw), &pol) != nil || pol == nil {
		return nil, false
	}
	statements, ok := pol["Statement"].([]any)
	if !ok {
		if single, isMap := pol["Statement"].(map[string]any); isMap {
			statements = []any{single}
		}
	}
	for _, s := range statements {
		if st, isMap := s.(map[string]any); isMap {
			if principal, found := st["Principal"]; found {
				if p, isStr := principal.(string); isStr {
					principal = map[string]any{"AWS": p}
				}
				if p, isMap := principal.(map[string]any); isMap {
					for k, v := range p {
						p[k] = sortedStrings(v)
					}
				}
				st["Principal"] = principal
			}
			for _, key := range []string{"Action", "Resource"} {
				if v, found := st[key]; found {
					st[key] = sortedStrings(v)
				}
			}
		}
	}
	pol["Statement"] = statements
	return pol, true
}

// sortedStrings turns a JSON string or array of strings into a sorted []any of strings.
func sortedStrings(v any) []any {
	items, ok := v.([]any)
	if !ok {
		items = []any{v}
	}
	out := slices.Clone(items)
	slices.SortFunc(out, func(x, y any) int { return strings.Compare(fmt.Sprint(x), fmt.Sprint(y)) })
	return out
}
