package bucket

import (
	"S3Browser/internal/modules/global"
	"S3Browser/internal/pkg/cnst"
	"S3Browser/models"
	"bytes"
	"context"
	"crypto/md5"
	"encoding/base64"
	"log/slog"
	"net/http"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/minio/madmin-go/v4"
	"github.com/minio/pkg/v3/policy"
	"github.com/wailsapp/wails/v3/pkg/application"
	"golang.org/x/sync/errgroup"
)

const (
	// bucketProbeConcurrency is the most HeadBucket / PutObject probes at the same time when flagging buckets.
	bucketProbeConcurrency = 16
	// bucketProbeTimeout caps the whole access probe of one listing.
	bucketProbeTimeout = 4 * time.Second
	// writeProbeKey is the key of the write probe; the wrong Content-MD5 keeps the object from being stored.
	writeProbeKey = ".s3b-write-probe"
)

// submoduleBucketMng lists the buckets of a connection.
type submoduleBucketMng struct {
	logger *slog.Logger
	app    *application.App
	global *global.Module
}

// newSubmoduleBucketMng builds the bucket submodule on the shared connection store.
func newSubmoduleBucketMng(
	app *application.App,
	logger *slog.Logger,
	global *global.Module,
) *submoduleBucketMng {
	return &submoduleBucketMng{
		logger: logger.With("submodules", "bucket_mng"),
		app:    app,
		global: global,
	}
}

// listBucket returns one page of the buckets of a connection (ListBuckets, 10s timeout).
// input.NextCursor is the continuation token of the previous page.
func (m *submoduleBucketMng) listBucket(
	ctx context.Context,
	input models.ListBucketInput,
) models.Output[models.ListBucketOutput] {
	ctx, cancel := withCallContext(ctx, m.app.Context(), 10*time.Second)
	defer cancel()

	output := models.NewOutput[models.ListBucketOutput]()

	s3Conn, ok := m.global.GetConnContainer(input.ConnectionId)
	if !ok {
		return output.ThrowError(notConnectedMessage(input.ProfileName))
	}

	if s3Conn.AuthType == cnst.AuthAnonymous {
		// Check again so a bucket whose policy changed since connecting gets the right flag.
		checkAnonymousBuckets(ctx, s3Conn)
		if isCallCanceled(ctx) {
			// Canceled by the frontend: fail silently, nobody waits for the result.
			return output.ThrowError()
		}
		output.Body.BucketList = anonymousBuckets(s3Conn, "")
		if !flagBucketAccess(ctx, s3Conn, output.Body.BucketList, input.CheckWrite, input.LazyAccess, false) {
			return output.ThrowError()
		}
		return output
	}

	listBucketInput := &s3.ListBucketsInput{
		MaxBuckets: aws.Int32(input.Limit),
	}
	if input.NextCursor != "" {
		listBucketInput.ContinuationToken = &input.NextCursor
	}

	result, err := s3Conn.Client.ListBuckets(ctx, listBucketInput)

	if err != nil {
		return failCall(ctx, output, input.ProfileName, err,
			models.NewParamsMessage(cnst.MessageTypeError, cnst.Bucket, S3E007, err.Error(), map[string]any{
				"name": input.ProfileName,
			}))
	}

	body := models.ListBucketOutput{
		BucketList: make([]models.Bucket, len(result.Buckets)),
		NextCursor: result.ContinuationToken,
	}

	for i, item := range result.Buckets {
		body.BucketList[i] = models.Bucket{
			Name:         aws.ToString(item.Name),
			CreationDate: aws.ToTime(item.CreationDate),
		}
	}

	if !flagBucketAccess(ctx, s3Conn, body.BucketList, input.CheckWrite, input.LazyAccess, false) {
		return output.ThrowError()
	}

	output.Body = body
	return output
}

// checkBucketAccess returns the access flags of input.BucketNames (10s timeout), probing the ones the cache
// doesn't know. A bucket whose probe gave no sure answer comes back with AccessPending.
func (m *submoduleBucketMng) checkBucketAccess(
	ctx context.Context,
	input models.CheckBucketAccessInput,
) models.Output[models.CheckBucketAccessOutput] {
	ctx, cancel := withCallContext(ctx, m.app.Context(), 10*time.Second)
	defer cancel()

	output := models.NewOutput[models.CheckBucketAccessOutput]()

	s3Conn, ok := m.global.GetConnContainer(input.ConnectionId)
	if !ok {
		return output.ThrowError(notConnectedMessage(input.ProfileName))
	}

	buckets := make([]models.Bucket, len(input.BucketNames))
	for i, name := range input.BucketNames {
		buckets[i].Name = name
	}

	if s3Conn.AuthType == cnst.AuthAnonymous {
		// The anonymous check already ran when listing; only copy its result.
		inaccessible := map[string]bool{}
		for _, b := range anonymousBuckets(s3Conn, "") {
			inaccessible[b.Name] = b.Inaccessible
		}
		for i := range buckets {
			buckets[i].Inaccessible = inaccessible[buckets[i].Name]
		}
	}

	if !flagBucketAccess(ctx, s3Conn, buckets, input.CheckWrite, false, input.WithPolicy) {
		return output.ThrowError()
	}
	output.Body.BucketList = buckets
	return output
}

// flagBucketAccess flags Inaccessible, DeleteDenied (MinIO with credentials) and, when checkWrite is set, ReadOnly
// on the buckets, then PolicyMode (see flagPolicyModes; readPolicy tells whether to read the missing ones). An
// anonymous connection is already flagged Inaccessible by its own check. When lazy is set, a bucket that needs a
// probe and has no cached result is not probed but flagged AccessPending. It returns false when the frontend
// canceled the call.
func flagBucketAccess(
	ctx context.Context,
	conn *global.S3Conn,
	buckets []models.Bucket,
	checkWrite, lazy, readPolicy bool,
) bool {
	if conn.AuthType != cnst.AuthAnonymous {
		if conn.MinioAdmin != nil {
			// Fills the read cache so markInaccessibleBuckets can skip HeadBucket.
			loadAccountAccess(ctx, conn)
		}
		markInaccessibleBuckets(ctx, conn, buckets, lazy)
		if conn.MinioAdmin != nil {
			for i := range buckets {
				buckets[i].DeleteDenied = isDenied(conn, global.AccessDelete, buckets[i].Name)
			}
		}
	}
	if checkWrite {
		markReadOnlyBuckets(ctx, conn, buckets, lazy)
	}
	flagPolicyModes(ctx, conn, buckets, !readPolicy)
	return !isCallCanceled(ctx)
}

// flagPolicyModes sets PolicyMode from the cache and, unless lazy, reads the missing ones in parallel under
// bucketProbeTimeout. A bucket whose policy can't be read is flagged "unknown"; only a sure answer of the server
// (see isSurePolicyError) is cached, so a timeout or network error is retried next time. Anonymous connections
// are skipped, and so are lazy buckets with nothing cached (PolicyMode stays empty = not known yet).
func flagPolicyModes(ctx context.Context, conn *global.S3Conn, buckets []models.Bucket, lazy bool) {
	if conn.AuthType == cnst.AuthAnonymous {
		return
	}
	var pending []int
	for i := range buckets {
		if buckets[i].Inaccessible {
			buckets[i].PolicyMode = policyModeUnknown
		} else if mode, ok := conn.Access.GetPolicy(buckets[i].Name); ok {
			buckets[i].PolicyMode = mode
		} else if !lazy {
			pending = append(pending, i)
		}
	}
	if len(pending) == 0 {
		return
	}
	gen := conn.Access.Generation()
	ctx, cancel := context.WithTimeout(ctx, bucketProbeTimeout)
	defer cancel()

	var g errgroup.Group
	g.SetLimit(bucketProbeConcurrency)
	for _, i := range pending {
		g.Go(func() error {
			mode, err := readPolicyModeInRegion(ctx, conn, buckets[i].Name)
			if err != nil {
				mode = policyModeUnknown
			}
			buckets[i].PolicyMode = mode
			if err == nil || isSurePolicyError(err) {
				conn.Access.SetPolicy(buckets[i].Name, mode, gen)
			}
			return nil
		})
	}
	_ = g.Wait()
}

// markInaccessibleBuckets flags Inaccessible the buckets the connection can't read. Results are cached per
// connection (global.AccessCache); for MinIO with credentials loadAccountAccess has already cached most of them.
// The others are checked with HeadBucket in parallel, and only a 403 flags the bucket: other failures (301 wrong
// region, 404, network) leave it unflagged. The probe has its own timeout, so a slow bucket never fails the listing.
func markInaccessibleBuckets(ctx context.Context, conn *global.S3Conn, buckets []models.Bucket, lazy bool) {
	checkDenied(ctx, conn, global.AccessRead, buckets, lazy, func(ctx context.Context, name string) error {
		_, err := conn.Client.HeadBucket(ctx, &s3.HeadBucketInput{Bucket: aws.String(name)})
		return err
	}, func(b *models.Bucket, denied bool) { b.Inaccessible = denied })
}

// isDenied reports whether a valid cached check says the access to the bucket is denied.
func isDenied(conn *global.S3Conn, kind global.AccessKind, name string) bool {
	denied, ok := conn.Access.Get(kind, name)
	return ok && denied
}

// loadAccountAccess caches the read and write access of every bucket from one MinIO AccountInfo, unless the cache
// still has it. Write is Access.Write. Read is cached only when sure (see the switch below); otherwise the bucket is
// left to a HeadBucket probe. MinIO leaves out the buckets with no permission at all, so those still need a probe.
// It has its own timeout. A failed AccountInfo is remembered (not retried within the cache TTL) unless the caller's
// ctx is done (canceled or past its deadline). It returns false on failure, but true while a remembered failure is
// still fresh.
func loadAccountAccess(ctx context.Context, conn *global.S3Conn) bool {
	if conn.Access.AccountFresh() {
		return true
	}
	gen := conn.Access.Generation()
	callCtx, cancel := context.WithTimeout(ctx, bucketProbeTimeout)
	defer cancel()
	info, err := conn.MinioAdmin.AccountInfo(callCtx, madmin.AccountOpts{})
	if err != nil {
		if ctx.Err() == nil {
			conn.Access.MarkAccount(gen)
		}
		return false
	}
	pol, parseErr := policy.ParseConfig(bytes.NewReader(info.Policy))
	// IsAllowed is evaluated without request conditions, so a "no" is only trusted for a simple policy.
	simple := isSimplePolicy(info.Policy)
	for _, b := range info.Buckets {
		conn.Access.Set(global.AccessWrite, b.Name, !b.Access.Write, gen)
		// Unlike read, a "no" for delete is only trusted for a simple policy; otherwise it stays "allowed".
		canDelete := parseErr != nil || !simple || pol.IsAllowed(policy.Args{
			Action:          policy.DeleteBucketAction,
			BucketName:      b.Name,
			ConditionValues: map[string][]string{},
		})
		conn.Access.Set(global.AccessDelete, b.Name, !canDelete, gen)
		canList := parseErr == nil && pol.IsAllowed(policy.Args{
			Action:          policy.ListBucketAction,
			BucketName:      b.Name,
			ConditionValues: map[string][]string{},
		})
		switch {
		case !b.Access.Read: // no ListBucket nor GetBucketLocation
			conn.Access.Set(global.AccessRead, b.Name, true, gen)
		case canList:
			conn.Access.Set(global.AccessRead, b.Name, false, gen)
		case parseErr == nil && simple:
			conn.Access.Set(global.AccessRead, b.Name, true, gen)
		}
	}
	conn.Access.MarkAccount(gen)
	return true
}

// isSimplePolicy reports whether the policy has no Condition nor variable, so IsAllowed (evaluated without request
// conditions) can be trusted when it says "no".
func isSimplePolicy(raw []byte) bool {
	return !bytes.Contains(raw, []byte(`"Condition"`)) && !bytes.Contains(raw, []byte("${"))
}

// checkDenied sets the flag of each bucket (skipping the Inaccessible ones) from the cache, and runs probe in
// parallel for the others, under bucketProbeTimeout. Only the answers of the server are cached: probe returning
// nil or an HTTP status counts, 403 meaning denied. Timeouts, cancels and network errors are not cached, leave
// the flag unset and mark the bucket AccessPending. When lazy is set, the buckets without a cached result are not
// probed and are marked AccessPending.
func checkDenied(
	ctx context.Context,
	conn *global.S3Conn,
	kind global.AccessKind,
	buckets []models.Bucket,
	lazy bool,
	probe func(ctx context.Context, name string) error,
	set func(b *models.Bucket, denied bool),
) {
	var pending []int
	for i := range buckets {
		if buckets[i].Inaccessible {
			continue
		}
		if denied, ok := conn.Access.Get(kind, buckets[i].Name); ok {
			set(&buckets[i], denied)
		} else if lazy {
			buckets[i].AccessPending = true
		} else {
			pending = append(pending, i)
		}
	}
	if len(pending) == 0 {
		return
	}
	gen := conn.Access.Generation()
	ctx, cancel := context.WithTimeout(ctx, bucketProbeTimeout)
	defer cancel()

	var g errgroup.Group
	g.SetLimit(bucketProbeConcurrency)
	for _, i := range pending {
		g.Go(func() error {
			err := probe(ctx, buckets[i].Name)
			status := statusCode(err)
			denied := status == http.StatusForbidden
			sure := err == nil || status != 0
			if sure {
				set(&buckets[i], denied)
				conn.Access.Set(kind, buckets[i].Name, denied, gen)
			}
			buckets[i].AccessPending = buckets[i].AccessPending || !sure
			return nil
		})
	}
	_ = g.Wait()
}

// markReadOnlyBuckets flags ReadOnly on the accessible buckets the connection can read but not write to.
// It must run after markInaccessibleBuckets / anonymousBuckets. How it checks depends on the connection:
//   - MinIO with credentials: the cached admin AccountInfo (see loadAccountAccess) gives the write access of every
//     bucket in one call; if it fails, or a bucket isn't in it, nothing is flagged.
//   - MinIO anonymous, or real AWS (no custom endpoint): a cached write probe per bucket (see probeWriteDenied).
//   - Any other server (custom-endpoint AWS provider such as Floci or Ceph): not checked, nothing is flagged.
//     Some of them ignore Content-MD5 and would really store the probe object.
func markReadOnlyBuckets(ctx context.Context, conn *global.S3Conn, buckets []models.Bucket, lazy bool) {
	switch {
	case conn.AuthType != cnst.AuthAnonymous && conn.MinioAdmin != nil: // MinIO with credentials
		if !loadAccountAccess(ctx, conn) {
			return
		}
		for i := range buckets {
			buckets[i].ReadOnly = !buckets[i].Inaccessible && isDenied(conn, global.AccessWrite, buckets[i].Name)
		}
	case conn.Provider == cnst.ProviderMinio && conn.AuthType == cnst.AuthAnonymous,
		conn.Provider != cnst.ProviderMinio && !conn.CustomEndpoint:
		probeWriteDenied(ctx, conn, buckets, lazy)
	}
}

// probeWriteDenied flags ReadOnly on the buckets where a PutObject with a deliberately wrong Content-MD5 gets 403.
// A caller allowed to write gets BadDigest and nothing is stored; a caller not allowed gets AccessDenied first.
// Both answers are cached; buckets not checked in time (own timeout) are not flagged.
func probeWriteDenied(ctx context.Context, conn *global.S3Conn, buckets []models.Bucket, lazy bool) {
	wrongMD5 := md5.Sum([]byte("s3b"))
	checkDenied(ctx, conn, global.AccessWrite, buckets, lazy, func(ctx context.Context, name string) error {
		_, err := conn.Client.PutObject(ctx, &s3.PutObjectInput{
			Bucket:        aws.String(name),
			Key:           aws.String(writeProbeKey),
			Body:          bytes.NewReader(nil),
			ContentLength: aws.Int64(0),
			ContentMD5:    aws.String(base64.StdEncoding.EncodeToString(wrongMD5[:])),
		}, func(o *s3.Options) {
			// Without this the SDK adds a CRC checksum header on top of the MD5.
			o.RequestChecksumCalculation = aws.RequestChecksumCalculationWhenRequired
		})
		return err
	}, func(b *models.Bucket, denied bool) { b.ReadOnly = denied })
}

// anonymousBuckets returns the buckets the user entered for an anonymous connection (the API can't list them),
// keeping those whose name contains lowerKeyword (already lower-cased; empty keeps all). Buckets that failed
// the latest check are flagged Inaccessible.
func anonymousBuckets(c *global.S3Conn, lowerKeyword string) []models.Bucket {
	all := c.AnonymousBuckets()
	buckets := make([]models.Bucket, 0, len(all))
	for _, b := range all {
		if containsFold(b.Name, lowerKeyword) {
			buckets = append(buckets, models.Bucket{Name: b.Name, Inaccessible: !b.Accessible})
		}
	}
	return buckets
}
