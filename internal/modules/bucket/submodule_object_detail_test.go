package bucket

// Branch table for submodule_object_detail.go (getObjectDetail).
//
//	empty key / folder key -> S3E025, no S3 call          TestGetObjectDetail_InvalidKey
//	not connected -> S3E006                               TestGetObjectDetail_NotConnected
//	success: contentType + metadata + storageClass        TestGetObjectDetail_Success
//	optional fields nil -> empty values, metadata {}      TestGetObjectDetail_NilFields
//	AWS error -> S3E024                                   TestGetObjectDetail_Error
//	ctx canceled -> Result=false, no message              TestGetObjectDetail_Canceled

import (
	"S3Browser/models"
	"context"
	"log/slog"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

type fakeHeader struct {
	calls int
	fn    func(ctx context.Context, in *s3.HeadObjectInput) (*s3.HeadObjectOutput, error)
}

func (f *fakeHeader) HeadObject(
	ctx context.Context, in *s3.HeadObjectInput, _ ...func(*s3.Options),
) (*s3.HeadObjectOutput, error) {
	f.calls++
	return f.fn(ctx, in)
}

func newDetailObjMng(client s3Header) *submoduleObjMng {
	return &submoduleObjMng{
		logger:     slog.New(slog.DiscardHandler),
		getHeader:  func(id string) (s3Header, bool) { return client, id == "conn" },
		appContext: context.Background,
	}
}

func detailInput(key string) models.ObjectDetailInput {
	return models.ObjectDetailInput{ConnectionId: "conn", Bucket: "b", Key: key}
}

func detailCodes(out models.Output[models.ObjectDetailOutput]) []string {
	var c []string
	for _, m := range out.MessageList {
		c = append(c, m.MessageCode)
	}
	return c
}

func TestGetObjectDetail_InvalidKey(t *testing.T) {
	for _, key := range []string{"", "a/", "/"} {
		f := &fakeHeader{}
		out := newDetailObjMng(f).getObjectDetail(context.Background(), detailInput(key))
		if out.Result || len(detailCodes(out)) != 1 || detailCodes(out)[0] != S3E025 || f.calls != 0 {
			t.Fatalf("key %q: %+v calls=%d", key, out, f.calls)
		}
	}
}

func TestGetObjectDetail_NotConnected(t *testing.T) {
	in := detailInput("a.txt")
	in.ConnectionId = "other"
	out := newDetailObjMng(&fakeHeader{}).getObjectDetail(context.Background(), in)
	if out.Result || detailCodes(out)[0] != S3E006 {
		t.Fatalf("%+v", out)
	}
}

func TestGetObjectDetail_Success(t *testing.T) {
	f := &fakeHeader{fn: func(_ context.Context, in *s3.HeadObjectInput) (*s3.HeadObjectOutput, error) {
		if aws.ToString(in.Bucket) != "b" || aws.ToString(in.Key) != "dir/a.txt" {
			t.Errorf("bad input: %+v", in)
		}
		return &s3.HeadObjectOutput{
			ContentType:  aws.String("text/plain"),
			StorageClass: types.StorageClassStandardIa,
			Metadata:     map[string]string{"owner": "me"},
		}, nil
	}}
	out := newDetailObjMng(f).getObjectDetail(context.Background(), detailInput("dir/a.txt"))
	b := out.Body
	if !out.Result || b.Key != "dir/a.txt" || b.ContentType != "text/plain" ||
		b.StorageClass != "STANDARD_IA" || len(b.Metadata) != 1 || b.Metadata["owner"] != "me" {
		t.Fatalf("%+v", out)
	}
}

func TestGetObjectDetail_NilFields(t *testing.T) {
	f := &fakeHeader{fn: func(context.Context, *s3.HeadObjectInput) (*s3.HeadObjectOutput, error) {
		return &s3.HeadObjectOutput{}, nil
	}}
	out := newDetailObjMng(f).getObjectDetail(context.Background(), detailInput("a.txt"))
	b := out.Body
	if !out.Result || b.ContentType != "" || b.StorageClass != "" || b.Metadata == nil || len(b.Metadata) != 0 {
		t.Fatalf("%+v", out)
	}
}

func TestGetObjectDetail_Error(t *testing.T) {
	f := &fakeHeader{fn: func(context.Context, *s3.HeadObjectInput) (*s3.HeadObjectOutput, error) {
		return nil, errBoom
	}}
	out := newDetailObjMng(f).getObjectDetail(context.Background(), detailInput("a.txt"))
	if out.Result || len(detailCodes(out)) != 1 || detailCodes(out)[0] != S3E024 {
		t.Fatalf("%+v", out)
	}
}

func TestGetObjectDetail_Canceled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	f := &fakeHeader{fn: func(ctx context.Context, _ *s3.HeadObjectInput) (*s3.HeadObjectOutput, error) {
		cancel()
		return nil, ctx.Err()
	}}
	out := newDetailObjMng(f).getObjectDetail(ctx, detailInput("a.txt"))
	if out.Result || len(out.MessageList) != 0 {
		t.Fatalf("%+v", out)
	}
}
