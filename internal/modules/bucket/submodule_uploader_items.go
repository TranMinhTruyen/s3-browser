package bucket

import (
	"S3Browser/internal/pkg/cnst"
	"S3Browser/models"
	"context"
	"os"
	"strings"

	"github.com/aws/aws-sdk-go-v2/service/s3"
	"golang.org/x/sync/errgroup"
)

// cleanUploadItems returns a copy of items with a safe RelKey set on each. If a RelKey
// is not safe it returns the path of that item as badPath.
func cleanUploadItems(items []models.UploadObj) (clean []models.UploadObj, badPath string) {
	clean = make([]models.UploadObj, len(items))
	for i, item := range items {
		rel, ok := cleanRelKey(item.RelKey, item.Path)
		if !ok {
			return nil, item.Path
		}
		item.RelKey = rel
		clean[i] = item
	}
	return clean, ""
}

// groupUploadItems groups the indexes of items by the folder of their RelKey, in order of
// first appearance, and checks the per group limits. Sizes are read from disk; a file that
// can't be read counts as small (the upload reports it). If a limit is broken it returns
// the error message for it.
func groupUploadItems(items []models.UploadObj) (groups [][]int, violation []models.Message) {
	pos := map[string]int{}
	names := []string{}
	for i, item := range items {
		dir := relKeyDir(item.RelKey)
		p, ok := pos[dir]
		if !ok {
			p = len(groups)
			pos[dir] = p
			names = append(names, dir)
			groups = append(groups, nil)
		}
		groups[p] = append(groups[p], i)
	}

	for p, indexes := range groups {
		if len(indexes) > maxFilesPerFolder {
			return nil, []models.Message{
				models.NewParamsMessage(cnst.MessageTypeError, cnst.Bucket, S3E018, "", map[string]any{
					"folder": names[p],
					"max":    maxFilesPerFolder,
				}),
			}
		}
		large := 0
		for _, i := range indexes {
			// Sequential on purpose: at most maxTotalFiles cheap stats; parallel stat is not worth the complexity.
			if info, err := os.Stat(items[i].Path); err == nil && info.Size() > largeFileSize {
				large++
			}
		}
		if large > largeFileMaxCount {
			return nil, []models.Message{
				models.NewParamsMessage(cnst.MessageTypeError, cnst.Bucket, S3E022, "", map[string]any{
					"folder": names[p],
					"max":    largeFileMaxCount,
					"size":   largeFileSize >> 30,
				}),
			}
		}
	}
	return groups, nil
}

// renameKey puts id in front of the file name of relKey, keeping its folders:
// "a/b/c.txt" -> "a/b/<id>_c.txt".
func renameKey(relKey, id string) string {
	dir, name := "", relKey
	if i := strings.LastIndex(relKey, "/"); i >= 0 {
		dir, name = relKey[:i+1], relKey[i+1:]
	}
	return dir + id + "_" + name
}

// normalizePrefix turns p into the form used for keys: no leading "/", and a trailing
// "/" unless it is empty (the bucket root). Windows separators are converted to "/".
func normalizePrefix(p string) string {
	p = strings.TrimLeft(strings.ReplaceAll(p, `\`, "/"), "/")
	if p != "" && !strings.HasSuffix(p, "/") {
		p += "/"
	}
	return p
}

// existingKeys checks, uploadFileConcurrency at a time, whether an object with key
// prefix + RelKey already exists in bucket, for each item. Each distinct RelKey is
// checked once. It returns the RelKeys (without prefix) except those the bucket
// answered 404 for: a key that couldn't be checked is treated as existing, so its file
// gets a renamed key and nothing is overwritten.
func existingKeys(
	ctx context.Context,
	client *s3.Client,
	bucket, prefix string,
	items []models.UploadObj,
) map[string]struct{} {
	var names []string
	seen := make(map[string]struct{}, len(items))
	for _, item := range items {
		if _, ok := seen[item.RelKey]; !ok {
			seen[item.RelKey] = struct{}{}
			names = append(names, item.RelKey)
		}
	}

	// Each goroutine writes only its own index, so no lock is needed.
	errs := make([]error, len(names))
	var g errgroup.Group
	g.SetLimit(uploadFileConcurrency)
	for i, name := range names {
		g.Go(func() error {
			key := prefix + name
			_, errs[i] = client.HeadObject(ctx, &s3.HeadObjectInput{Bucket: &bucket, Key: &key})
			return nil
		})
	}
	_ = g.Wait()

	existing := make(map[string]struct{}, len(items))
	for i, name := range names {
		if errs[i] != nil && UnwrapAwsError(errs[i]) == "NotFound" {
			continue
		}
		existing[name] = struct{}{}
	}
	return existing
}
