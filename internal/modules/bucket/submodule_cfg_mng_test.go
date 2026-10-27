package bucket

// Branch table for submodule_cfg_mng.go.
//
//	buildClient: aws / minio with scheme / minio without scheme / no host /
//	             unparsable URL / madmin rejects host                     TestBuildClient_*
//	probe: OK / 403 InvalidAccessKeyId / AccessDenied / network error      TestProbe_*
//	describeConnectStatus: every case of the switch + DeadlineExceeded     TestDescribeConnectStatus
//	UnwrapAwsError: nil + 6 error kinds + unknown                          TestUnwrapAwsError
//	newHTTPClient                                                          TestNewHTTPClient

import (
	"S3Browser/models"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"testing"

	"github.com/aws/smithy-go"
)

func newTestCfgMng() *submoduleCfgMng {
	return newSubmoduleCfgMng(slog.New(slog.DiscardHandler))
}

func TestBuildClient_AWS(t *testing.T) {
	c := newTestCfgMng().buildClient(models.ConnectionProfileInput{
		Name: "n", Provider: "aws", Endpoint: "http://localhost:9000", Region: "r", PathStyle: true,
	})
	if c.ProfileName != "n" || c.Provider != "aws" || c.Client == nil || c.Presign == nil ||
		c.Transport == nil || c.MinioAdmin != nil {
		t.Fatalf("%+v", c)
	}
}

func TestBuildClient_Minio(t *testing.T) {
	for _, endpoint := range []string{"http://localhost:9000", "https://localhost:9000", "localhost:9000"} {
		c := newTestCfgMng().buildClient(models.ConnectionProfileInput{Provider: "minio", Endpoint: endpoint})
		if c.MinioAdmin == nil {
			t.Errorf("endpoint %q: MinioAdmin is nil", endpoint)
		}
	}
}

func TestBuildClient_MinioInvalidEndpoint(t *testing.T) {
	// no host, unparsable URL, hosts madmin rejects
	for _, endpoint := range []string{"http://", "://x", "http://-bad.com"} {
		c := newTestCfgMng().buildClient(models.ConnectionProfileInput{Provider: "minio", Endpoint: endpoint})
		if c.MinioAdmin != nil || c.Client == nil {
			t.Errorf("endpoint %q: %+v", endpoint, c)
		}
	}
}

func TestProbe_OK(t *testing.T) {
	srv := newS3Server(t, func(w http.ResponseWriter, _ *http.Request) {
		writeXML(w, "<ListAllMyBucketsResult><Buckets/></ListAllMyBucketsResult>")
	})
	out, err := newTestCfgMng().probe(context.Background(), newTestS3Conn(srv.URL))
	if err != nil || !out.Result || len(out.MessageList) != 0 || out.Body.Limited {
		t.Fatalf("err=%v out=%+v", err, out)
	}
}

func TestProbe_InvalidAccessKey(t *testing.T) {
	srv := newS3Server(t, func(w http.ResponseWriter, _ *http.Request) {
		writeS3Error(w, http.StatusForbidden, "InvalidAccessKeyId")
	})
	out, err := newTestCfgMng().probe(context.Background(), newTestS3Conn(srv.URL))
	if err == nil || !slices.Equal(codesOf(out.MessageList), []string{S3E001}) {
		t.Fatalf("err=%v out=%+v", err, out)
	}
}

func TestProbe_AccessDeniedIsLimited(t *testing.T) {
	srv := newS3Server(t, func(w http.ResponseWriter, _ *http.Request) {
		writeS3Error(w, http.StatusForbidden, "AccessDenied")
	})
	out, err := newTestCfgMng().probe(context.Background(), newTestS3Conn(srv.URL))
	if err != nil || !out.Body.Limited || !slices.Equal(codesOf(out.MessageList), []string{S3W001}) {
		t.Fatalf("err=%v out=%+v", err, out)
	}
}

func TestProbe_NetworkError(t *testing.T) {
	srv := newS3Server(t, func(http.ResponseWriter, *http.Request) {})
	conn := newTestS3Conn(srv.URL)
	srv.Close()
	out, err := newTestCfgMng().probe(context.Background(), conn)
	if err == nil || !slices.Equal(codesOf(out.MessageList), []string{S3E003}) {
		t.Fatalf("err=%v out=%+v", err, out)
	}
}

func TestDescribeConnectStatus(t *testing.T) {
	apiErr := func(code string) error {
		return &smithy.GenericAPIError{Code: code, Message: code}
	}
	tests := []struct {
		name    string
		err     error
		code    string
		typ     string
		limited bool
		wantErr bool
	}{
		{"deadline", fmt.Errorf("wrap: %w", context.DeadlineExceeded), S3E003, "E", false, true},
		{"invalid key", apiErr("InvalidAccessKeyId"), S3E001, "E", false, true},
		{"signature", apiErr("SignatureDoesNotMatch"), S3E001, "E", false, true},
		{"client token", apiErr("InvalidClientTokenId"), S3E001, "E", false, true},
		{"malformed", apiErr("AuthorizationHeaderMalformed"), S3E002, "E", false, true},
		{"region", apiErr("InvalidRegion"), S3E002, "E", false, true},
		{"denied", apiErr("AccessDenied"), S3W001, "W", true, false},
		{"all disabled", apiErr("AllAccessDisabled"), S3W001, "W", true, false},
		{"unauthorized", apiErr("UnauthorizedAccess"), S3W001, "W", true, false},
		{"unknown error", errors.New("plain"), S3E004, "E", false, true},
		{"other code", apiErr("NoSuchBucket"), S3E003, "E", false, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			out := models.NewOutput[models.ConnectOutput]()
			err := describeConnectStatus(tc.err, &out)
			if (err != nil) != tc.wantErr || out.Body.Limited != tc.limited ||
				len(out.MessageList) != 1 || out.MessageList[0].MessageCode != tc.code ||
				out.MessageList[0].MessageType != tc.typ {
				t.Fatalf("err=%v out=%+v", err, out)
			}
		})
	}
}

func TestUnwrapAwsError(t *testing.T) {
	inner := errors.New("inner")
	tests := []struct {
		name string
		err  error
		want string
	}{
		{"nil", nil, ""},
		{"canceled", &smithy.CanceledError{Err: inner}, (&smithy.CanceledError{Err: inner}).Error()},
		{"api", &smithy.GenericAPIError{Code: "Code1"}, "Code1"},
		{"deserialization", &smithy.DeserializationError{Err: inner},
			(&smithy.DeserializationError{Err: inner}).Error()},
		{"serialization", &smithy.SerializationError{Err: inner}, (&smithy.SerializationError{Err: inner}).Error()},
		{"operation", &smithy.OperationError{ServiceID: "S3", OperationName: "Op", Err: inner},
			(&smithy.OperationError{ServiceID: "S3", OperationName: "Op", Err: inner}).Error()},
		{"unknown", inner, ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := UnwrapAwsError(tc.err); got != tc.want {
				t.Fatalf("got %q want %q", got, tc.want)
			}
		})
	}
}

func TestNewHTTPClient(t *testing.T) {
	client, tr := newHTTPClient()
	if client.Transport != tr || tr.MaxConnsPerHost != 5000 || tr.ForceAttemptHTTP2 {
		t.Fatalf("%+v", tr)
	}
}
