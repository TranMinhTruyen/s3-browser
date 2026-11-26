package bucket

import (
	"S3Browser/internal/modules/global"
	"context"

	miniocredentials "github.com/minio/minio-go/v7/pkg/credentials"
)

// adminCreds cung cấp cho madmin thông tin xác thực của kết nối bằng cách đọc SwapCreds ở mỗi yêu cầu,
// nhờ đó thông tin xác thực được ReauthConnection gia hạn (SwapCreds.Store) áp dụng ngay mà không cần tạo admin client mới.
type adminCreds struct {
	creds *global.SwapCreds
}

// newAdminCreds trả về thông tin xác thực madmin được đồng bộ với creds.
func newAdminCreds(creds *global.SwapCreds) *miniocredentials.Credentials {
	return miniocredentials.New(&adminCreds{creds: creds})
}

// RetrieveWithCredContext đọc thông tin xác thực hiện tại; SwapCreds và các provider của nó lưu cache giá trị này.
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

// Retrieve là phiên bản cũ của RetrieveWithCredContext.
func (p *adminCreds) Retrieve() (miniocredentials.Value, error) {
	return p.RetrieveWithCredContext(nil)
}

// IsExpired luôn trả true: madmin lưu cache dữ liệu nhận được nên provider đã thay thế phải được đọc lại ở yêu cầu sau.
func (p *adminCreds) IsExpired() bool { return true }
