package bucket

import (
	"S3Browser/internal/modules/global"
	"S3Browser/internal/pkg/cnst"
	"S3Browser/models"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	// searchMaxResults is the most matches returned by one call.
	searchMaxResults = 100
	// searchPageSize is the keys requested per ListObjectsV2 page.
	searchPageSize = 1000
	// searchMaxPages is the most pages scanned by one call.
	searchMaxPages = 20
	// searchBucketCallTimeout bounds each ListBuckets call.
	searchBucketCallTimeout = 10 * time.Second
)

// submoduleSearchMng searches objects and buckets by keyword, page by page.
type submoduleSearchMng struct {
	logger *slog.Logger
	global *global.Module
	// appContext returns the app lifetime context. Tests replace it so they don't need a running app.
	appContext func() context.Context
}

// newSubmoduleSearchMng builds the search submodule on the shared connection store.
func newSubmoduleSearchMng(
	app *application.App,
	logger *slog.Logger,
	global *global.Module,
) *submoduleSearchMng {
	return &submoduleSearchMng{
		logger:     logger.With("submodules", "search_mng"),
		global:     global,
		appContext: app.Context,
	}
}

// searchObject scans the folder input.Prefix (no recursion) for keys containing input.Keyword,
// case-insensitively, and returns at most searchMaxResults matches.
// input.NextCursor is the StartAfter key to continue from (empty to start over). The returned
// NextCursor is where the next call must continue; it is empty only when nothing is left to scan.
// ctx is the call context: it is canceled when the frontend cancels the call.
func (m *submoduleSearchMng) searchObject(
	ctx context.Context,
	input models.SearchObjectInput,
) models.Output[models.SearchObjectOutput] {
	ctx, cancel := withCallContext(ctx, m.appContext(), 5*time.Minute)
	defer cancel()

	output := models.NewOutput[models.SearchObjectOutput]()

	keyword := strings.ToLower(strings.TrimSpace(input.Keyword))
	if keyword == "" {
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Bucket, S3E028, ""))
	}

	s3Conn, ok := m.global.GetConnContainer(input.ConnectionId)
	if !ok {
		return output.ThrowError(notConnectedMessage(input.ProfileName))
	}

	body := models.SearchObjectOutput{ObjectList: make([]models.ObjectItem, 0, searchMaxResults)}
	cursor := input.NextCursor
	done := false

	for range searchMaxPages {
		listInput := &s3.ListObjectsV2Input{
			Bucket:    &input.Bucket,
			Prefix:    &input.Prefix,
			Delimiter: aws.String("/"),
			MaxKeys:   aws.Int32(searchPageSize),
		}
		if cursor != "" {
			listInput.StartAfter = &cursor
		}

		page, err := s3Conn.Client.ListObjectsV2(ctx, listInput)
		if err != nil {
			if isCallCanceled(ctx) {
				output.Result = false
				return output
			}

			return output.ThrowError(
				models.NewParamsMessage(
					cnst.MessageTypeError,
					cnst.Bucket,
					S3E026,
					UnwrapAwsError(err),
					map[string]any{
						"name":   input.ProfileName,
						"bucket": input.Bucket,
					},
				),
			)
		}

		truncated := aws.ToBool(page.IsTruncated)
		before := cursor
		forEachKey(page, input.Prefix, func(key string, isFolder, isLast bool, item func() models.ObjectItem) bool {
			// The cursor always moves past the raw key, even when the key is filtered out.
			cursor = key
			if isFolder {
				cursor = strings.TrimSuffix(key, "/") + "0"
			}
			if containsFold(key, keyword) {
				body.ObjectList = append(body.ObjectList, item())
			}
			if len(body.ObjectList) < searchMaxResults {
				return true
			}
			// Stop right at this item, even in the middle of a page.
			// Nothing is left only if it was the last item of the last page.
			if isLast && !truncated {
				cursor = ""
			}
			done = true
			return false
		})
		if done {
			body.NextCursor = cursor
			output.Body = body
			return output
		}

		if !truncated || cursor == before {
			// Data ended (or the page gave no key to move on from, which would loop forever).
			cursor = ""
			break
		}
	}

	// Either the data ended (cursor empty) or the page limit hit: continue from the last examined key.
	body.NextCursor = cursor
	output.Body = body
	return output
}

// forEachKey visits the folders (CommonPrefixes) and files (Contents) of a page in key order, the order
// S3 lists them in, by merging the two already sorted lists. Empty keys and the folder marker
// (key == prefix) are skipped. item builds the ObjectItem lazily, so only matches pay for it.
// visit returns false to stop.
func forEachKey(
	page *s3.ListObjectsV2Output,
	prefix string,
	visit func(key string, isFolder, isLast bool, item func() models.ObjectItem) bool,
) {
	folders, files := page.CommonPrefixes, page.Contents
	i, j := 0, 0
	for i < len(folders) || j < len(files) {
		var key string
		// S3-compatible providers may omit optional fields, so read them via aws.ToX.
		isFolder := j >= len(files) ||
			(i < len(folders) && aws.ToString(folders[i].Prefix) < aws.ToString(files[j].Key))
		var item func() models.ObjectItem
		if isFolder {
			key = aws.ToString(folders[i].Prefix)
			item = func() models.ObjectItem {
				return models.ObjectItem{
					Key:      key,
					Name:     strings.TrimSuffix(strings.TrimPrefix(key, prefix), "/"),
					IsFolder: true,
				}
			}
			i++
		} else {
			o := files[j]
			key = aws.ToString(o.Key)
			item = func() models.ObjectItem {
				return models.ObjectItem{
					Key:          key,
					Name:         strings.TrimPrefix(key, prefix),
					Size:         aws.ToInt64(o.Size),
					LastModified: aws.ToTime(o.LastModified),
					ETag:         aws.ToString(o.ETag),
				}
			}
			j++
		}
		if key == "" || (!isFolder && key == prefix) {
			continue
		}
		if !visit(key, isFolder, i >= len(folders) && j >= len(files), item) {
			return
		}
	}
}

// containsFold reports whether s contains lowerSub (already lower-cased), ignoring case.
// ASCII-only input is compared without allocating; otherwise it falls back to strings.ToLower.
func containsFold(s, lowerSub string) bool {
	for k := 0; k < len(s); k++ {
		if s[k] >= utf8.RuneSelf {
			return strings.Contains(strings.ToLower(s), lowerSub)
		}
	}

	n := len(lowerSub)
	for k := 0; k+n <= len(s); k++ {
		m := 0
		for ; m < n; m++ {
			c := s[k+m]
			if 'A' <= c && c <= 'Z' {
				c += 'a' - 'A'
			}
			if c != lowerSub[m] {
				break
			}
		}
		if m == n {
			return true
		}
	}
	return false
}

// bucketCursor is the decoded SearchBucketInput.NextCursor: the ListBuckets page to call again
// (Token, empty for the first page) and how many of its buckets were already examined (Skip).
type bucketCursor struct {
	Token string `json:"token"`
	Skip  int    `json:"skip"`
}

// encodeBucketCursor turns c into the opaque string the frontend passes back as NextCursor.
func encodeBucketCursor(c bucketCursor) string {
	data, _ := json.Marshal(c)
	return base64.RawURLEncoding.EncodeToString(data)
}

// decodeBucketCursor parses a cursor made by encodeBucketCursor; an empty string means the first page.
func decodeBucketCursor(s string) (bucketCursor, error) {
	var c bucketCursor
	if s == "" {
		return c, nil
	}
	data, err := base64.RawURLEncoding.DecodeString(s)
	if err == nil {
		err = json.Unmarshal(data, &c)
	}
	if err == nil && c.Skip < 0 {
		err = fmt.Errorf("negative skip %d", c.Skip)
	}
	return c, err
}

// searchBucket scans the buckets for names containing input.Keyword, case-insensitively, and returns at
// most searchMaxResults matches. ListBuckets has no StartAfter, so the NextCursor is an opaque
// {token, skip} pair: re-list the page of token, then skip the buckets already examined.
// The returned NextCursor is empty only when nothing is left to scan; it always moves forward.
// An invalid input.NextCursor is rejected with S3E027 (not silently restarted, to avoid endless loops).
func (m *submoduleSearchMng) searchBucket(
	ctx context.Context,
	input models.SearchBucketInput,
) models.Output[models.SearchBucketOutput] {
	// No overall timeout: each ListBuckets call has its own (searchBucketCallTimeout).
	ctx, cancel := withCallContext(ctx, m.appContext(), 0)
	defer cancel()

	output := models.NewOutput[models.SearchBucketOutput]()
	failure := func(detail string) models.Output[models.SearchBucketOutput] {
		return output.ThrowError(
			models.NewParamsMessage(cnst.MessageTypeError, cnst.Bucket, S3E027, detail, map[string]any{
				"name": input.ProfileName,
			}),
		)
	}

	keyword := strings.ToLower(strings.TrimSpace(input.Keyword))
	if keyword == "" {
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Bucket, S3E028, ""))
	}

	cur, err := decodeBucketCursor(input.NextCursor)
	if err != nil {
		return failure("invalid cursor: " + err.Error())
	}

	s3Conn, ok := m.global.GetConnContainer(input.ConnectionId)
	if !ok {
		return output.ThrowError(notConnectedMessage(input.ProfileName))
	}

	if s3Conn.AuthType == cnst.AuthAnonymous {
		buckets := anonymousBuckets(s3Conn, keyword)
		output.Body.BucketList = buckets[:min(len(buckets), searchMaxResults)]
		return output
	}

	body := models.SearchBucketOutput{BucketList: make([]models.Bucket, 0, searchMaxResults)}

	for range searchMaxPages {
		listInput := &s3.ListBucketsInput{MaxBuckets: aws.Int32(searchPageSize)}
		if cur.Token != "" {
			listInput.ContinuationToken = &cur.Token
		}

		callCtx, cancelCall := context.WithTimeout(ctx, searchBucketCallTimeout)
		page, err := s3Conn.Client.ListBuckets(callCtx, listInput)
		cancelCall()
		if err != nil {
			if isCallCanceled(ctx) {
				output.Result = false
				return output
			}
			return failure(UnwrapAwsError(err))
		}

		// A provider may omit the token and return everything at once; then the page is the last one.
		next := aws.ToString(page.ContinuationToken)
		if next == cur.Token {
			next = ""
		}

		for i := min(cur.Skip, len(page.Buckets)); i < len(page.Buckets); i++ {
			name := aws.ToString(page.Buckets[i].Name)
			if !containsFold(name, keyword) {
				continue
			}
			body.BucketList = append(body.BucketList, models.Bucket{
				Name:         name,
				CreationDate: aws.ToTime(page.Buckets[i].CreationDate),
			})
			if len(body.BucketList) < searchMaxResults {
				continue
			}
			// Stop right at this bucket, even in the middle of a page.
			switch {
			case i+1 < len(page.Buckets):
				body.NextCursor = encodeBucketCursor(bucketCursor{Token: cur.Token, Skip: i + 1})
			case next != "":
				body.NextCursor = encodeBucketCursor(bucketCursor{Token: next})
			}
			output.Body = body
			return output
		}

		if next == "" {
			output.Body = body
			return output
		}
		cur = bucketCursor{Token: next}
	}

	// Page limit hit: continue from the next page.
	body.NextCursor = encodeBucketCursor(cur)
	output.Body = body
	return output
}
