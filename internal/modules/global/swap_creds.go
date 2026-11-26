package global

import (
	"context"
	"sync/atomic"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
)

// SwapCreds là provider thông tin xác thực của client S3. Có thể thay provider bên trong (Store) khi client đang chạy,
// nhờ đó không cần tạo client mới khi gia hạn thông tin xác thực và các lượt truyền vẫn tiếp tục.
// SwapCreds không lưu cache; các provider bên trong đã tự thực hiện việc đó.
type SwapCreds struct {
	current atomic.Pointer[swapState]
}

// swapState gồm một provider và thời hạn của thông tin xác thực lấy gần nhất. Chúng được giữ trong cùng một giá trị,
// để Retrieve hoàn tất sau Store chỉ cập nhật thời hạn của provider cũ mà nó đã gọi.
type swapState struct {
	provider aws.CredentialsProvider
	// expiry là nil nếu thông tin xác thực không hết hạn hoặc chưa xác định được thời hạn.
	expiry atomic.Pointer[time.Time]
}

// NewSwapCreds khởi tạo với provider.
func NewSwapCreds(provider aws.CredentialsProvider) *SwapCreds {
	s := &SwapCreds{}
	s.Store(provider)
	return s
}

// Retrieve triển khai aws.CredentialsProvider bằng provider hiện tại.
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

// Store thay provider; thời hạn được xác định lại sau lần Retrieve tiếp theo.
func (s *SwapCreds) Store(provider aws.CredentialsProvider) {
	s.current.Store(&swapState{provider: provider})
}

// Expiry trả thời điểm thông tin xác thực lấy gần nhất hết hạn. Hàm không gọi provider nên không bị chặn.
func (s *SwapCreds) Expiry() (time.Time, bool) {
	if at := s.current.Load().expiry.Load(); at != nil {
		return *at, true
	}
	return time.Time{}, false
}
