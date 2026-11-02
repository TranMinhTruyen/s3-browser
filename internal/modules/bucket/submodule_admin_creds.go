package bucket

import (
	"S3Browser/internal/modules/global"
	"context"

	miniocredentials "github.com/minio/minio-go/v7/pkg/credentials"
)

// adminCreds gives madmin the credentials of a connection by reading its SwapCreds on every request, so
// credentials renewed by ReauthConnection (SwapCreds.Store) apply to madmin at once, without a new admin client.
type adminCreds struct {
	creds *global.SwapCreds
}

// newAdminCreds returns the madmin credentials that follow creds.
func newAdminCreds(creds *global.SwapCreds) *miniocredentials.Credentials {
	return miniocredentials.New(&adminCreds{creds: creds})
}

// RetrieveWithCredContext reads the current credentials; SwapCreds and its providers cache them.
func (p *adminCreds) RetrieveWithCredContext(cc *miniocredentials.CredContext) (miniocredentials.Value, error) {
	ctx := context.Background()
	if cc != nil && cc.Context != nil {
		ctx = cc.Context
	}
	v, err := p.creds.Retrieve(ctx)
	if err != nil {
		return miniocredentials.Value{}, err
	}
	return miniocredentials.Value{
		AccessKeyID:     v.AccessKeyID,
		SecretAccessKey: v.SecretAccessKey,
		SessionToken:    v.SessionToken,
		Expiration:      v.Expires,
		SignerType:      miniocredentials.SignatureV4,
	}, nil
}

// Retrieve is the deprecated form of RetrieveWithCredContext.
func (p *adminCreds) Retrieve() (miniocredentials.Value, error) {
	return p.RetrieveWithCredContext(nil)
}

// IsExpired is always true: madmin caches what it gets, and a swapped provider must be seen on the next request.
func (p *adminCreds) IsExpired() bool { return true }
