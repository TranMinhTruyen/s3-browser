package bucket

// Branch table for submodule_bucket_mng.go (listBucket).
//
//	not connected -> S3E006                                  TestListBucket_NotConnected
//	success, no cursor / with cursor, maps buckets           TestListBucket_Success
//	NextCursor sent as continuation-token, limit as max-buckets  (same test)
//	S3 error -> S3E007                                       TestListBucket_Error
//	ctx canceled -> Result=false, no message                 TestListBucket_Canceled

import (
	"S3Browser/internal/modules/global"
	"S3Browser/models"
	"context"
	"log/slog"
	"net/http"
	"net/url"
	"slices"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
)

func newBucketEnv(t *testing.T, h http.HandlerFunc) (*submoduleBucketMng, *global.Module) {
	t.Helper()
	srv := newS3Server(t, h)
	g := global.NewModule()
	g.PutConnContainer("conn", newTestS3Conn(srv.URL))
	return newSubmoduleBucketMng(newTestApp(t), slog.New(slog.DiscardHandler), g), g
}

func TestListBucket_NotConnected(t *testing.T) {
	m, _ := newBucketEnv(t, func(http.ResponseWriter, *http.Request) {})
	out := m.listBucket(context.Background(), models.ListBucketInput{ConnectionId: "x", ProfileName: "p"})
	if out.Result || !slices.Equal(codesOf(out.MessageList), []string{S3E006}) ||
		out.MessageList[0].Params["name"] != "p" {
		t.Fatalf("%+v", out)
	}
}

func TestListBucket_Success(t *testing.T) {
	var query url.Values
	m, _ := newBucketEnv(t, func(w http.ResponseWriter, r *http.Request) {
		query = r.URL.Query()
		writeXML(w, `<ListAllMyBucketsResult><Buckets>
<Bucket><Name>a</Name><CreationDate>2024-01-02T03:04:05.000Z</CreationDate></Bucket>
<Bucket><Name>b</Name></Bucket></Buckets><ContinuationToken>next</ContinuationToken>
</ListAllMyBucketsResult>`)
	})

	out := m.listBucket(context.Background(), models.ListBucketInput{ConnectionId: "conn", Limit: 2})
	if !out.Result || aws.ToString(out.Body.NextCursor) != "next" || len(out.Body.BucketList) != 2 {
		t.Fatalf("%+v", out)
	}
	a, b := out.Body.BucketList[0], out.Body.BucketList[1]
	if a.Name != "a" || !a.CreationDate.Equal(time.Date(2024, 1, 2, 3, 4, 5, 0, time.UTC)) ||
		b.Name != "b" || !b.CreationDate.IsZero() {
		t.Fatalf("%+v", out.Body.BucketList)
	}
	if query.Get("max-buckets") != "2" || query.Has("continuation-token") {
		t.Fatalf("query without cursor: %q", query)
	}

	// With a cursor the token is forwarded.
	m.listBucket(context.Background(), models.ListBucketInput{ConnectionId: "conn", Limit: 2, NextCursor: "tok"})
	if query.Get("continuation-token") != "tok" {
		t.Fatalf("query with cursor: %q", query)
	}
}

func TestListBucket_Error(t *testing.T) {
	m, _ := newBucketEnv(t, func(w http.ResponseWriter, _ *http.Request) {
		writeS3Error(w, http.StatusForbidden, "AccessDenied")
	})
	out := m.listBucket(context.Background(), models.ListBucketInput{ConnectionId: "conn", ProfileName: "p"})
	if out.Result || !slices.Equal(codesOf(out.MessageList), []string{S3E007}) || out.MessageList[0].ErrorDetail == "" {
		t.Fatalf("%+v", out)
	}
}

func TestListBucket_Canceled(t *testing.T) {
	m, _ := newBucketEnv(t, func(http.ResponseWriter, *http.Request) {})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	out := m.listBucket(ctx, models.ListBucketInput{ConnectionId: "conn"})
	if out.Result || len(out.MessageList) != 0 {
		t.Fatalf("%+v", out)
	}
}
