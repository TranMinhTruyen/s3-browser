package global

import (
	"context"
	"sync/atomic"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
)

// SwapCreds is the credentials provider of an S3 client. The provider behind it can be replaced (Store) while
// the client keeps running, so renewed credentials never need a new client and running transfers continue.
// It does not cache: the providers stored in it already do.
type SwapCreds struct {
	current atomic.Pointer[swapState]
}

// swapState is one provider with the expiry of its last retrieved credentials. They live in one value so a
// Retrieve that finishes after Store only updates the expiry of its own (old) provider.
type swapState struct {
	provider aws.CredentialsProvider
	// expiry is nil when the credentials don't expire or aren't known yet.
	expiry atomic.Pointer[time.Time]
}

// NewSwapCreds starts with provider.
func NewSwapCreds(provider aws.CredentialsProvider) *SwapCreds {
	s := &SwapCreds{}
	s.Store(provider)
	return s
}

// Retrieve implements aws.CredentialsProvider with the current provider.
func (s *SwapCreds) Retrieve(ctx context.Context) (aws.Credentials, error) {
	st := s.current.Load()
	creds, err := st.provider.Retrieve(ctx)
	if err != nil {
		return creds, err
	}
	if creds.CanExpire {
		st.expiry.Store(&creds.Expires)
	} else {
		st.expiry.Store(nil)
	}
	return creds, nil
}

// Store replaces the provider; the expiry is known again after the next Retrieve.
func (s *SwapCreds) Store(provider aws.CredentialsProvider) {
	s.current.Store(&swapState{provider: provider})
}

// Expiry returns when the last retrieved credentials expire. It never calls the provider, so it can't block.
func (s *SwapCreds) Expiry() (time.Time, bool) {
	if at := s.current.Load().expiry.Load(); at != nil {
		return *at, true
	}
	return time.Time{}, false
}
