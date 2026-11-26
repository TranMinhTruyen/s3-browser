package global

import (
	"net/http"
	"slices"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/minio/madmin-go/v4"
)

// CredInfo mô tả thông tin ứng dụng có thể dựa vào đối với thông tin xác thực của kết nối.
type CredInfo struct {
	// Refreshable là false khi người dùng phải thao tác trước Expiry (nhập mã MFA mới, chạy `aws sso login`, đăng nhập OIDC),
	// vì vậy ứng dụng sẽ cảnh báo trước thời điểm đó. Với sso, SDK vẫn tự gia hạn thông tin xác thực của role; Expiry là hạn của token đăng nhập.
	Refreshable bool
	// Expiry trả về thời điểm thông tin xác thực hết hạn; false nếu chúng không hết hạn hoặc chưa xác định được thời điểm.
	// Hàm không chặn. Giá trị nil dùng cho kết nối ẩn danh.
	Expiry func() (time.Time, bool)
}

// AnonymousBucket là bucket do người dùng nhập cho kết nối ẩn danh.
type AnonymousBucket struct {
	Name string
	// Accessible là kết quả lần kiểm tra HeadBucket gần nhất nhận được phản hồi từ máy chủ.
	Accessible bool
}

// S3Conn chứa các client của một hồ sơ đã kết nối. Transport được giữ lại để đóng các kết nối
// HTTP đang nhàn rỗi khi ngắt kết nối.
type S3Conn struct {
	ProfileName string
	Provider    string
	AuthType    string
	// AwsProfile là tên hồ sơ AWS CLI (sharedProfile, sso, assumeRole); dùng "default" nếu chưa đặt.
	AwsProfile string
	// CustomEndpoint là true nếu hồ sơ chỉ định endpoint, tức máy chủ không phải AWS.
	CustomEndpoint bool

	Client  *s3.Client
	Presign *s3.PresignClient

	MinioAdmin *madmin.AdminClient

	Transport *http.Transport

	// Creds là thông tin Client dùng để ký yêu cầu; nil với kết nối ẩn danh.
	Creds    *SwapCreds
	CredInfo CredInfo

	// Access lưu tạm kết quả kiểm tra quyền truy cập bucket. Xóa cache khi thông tin xác thực thay đổi.
	Access AccessCache

	// anonymousBuckets là danh sách bucket của kết nối ẩn danh (API không thể liệt kê chúng). Danh sách được cố định
	// sau khi tạo kết nối; chỉ các cờ Accessible thay đổi và được bảo vệ bởi anonymousMu.
	anonymousMu      sync.RWMutex
	anonymousBuckets []AnonymousBucket

	expiryMu    sync.Mutex
	expiryTimer *time.Timer
	closed      bool
}

// SetAnonymousBuckets đặt danh sách bucket cho kết nối ẩn danh. Gọi hàm trước khi chia sẻ kết nối.
func (c *S3Conn) SetAnonymousBuckets(names []string) {
	c.anonymousMu.Lock()
	defer c.anonymousMu.Unlock()
	c.anonymousBuckets = make([]AnonymousBucket, len(names))
	for i, name := range names {
		c.anonymousBuckets[i].Name = name
	}
}

// AnonymousBuckets trả về bản sao danh sách bucket của kết nối ẩn danh.
func (c *S3Conn) AnonymousBuckets() []AnonymousBucket {
	c.anonymousMu.RLock()
	defer c.anonymousMu.RUnlock()
	return slices.Clone(c.anonymousBuckets)
}

// SetAnonymousAccessible ghi nhận kết quả kiểm tra của bucket thứ i trong AnonymousBuckets.
func (c *S3Conn) SetAnonymousAccessible(i int, accessible bool) {
	c.anonymousMu.Lock()
	defer c.anonymousMu.Unlock()
	c.anonymousBuckets[i].Accessible = accessible
}

// SetExpiryTimer lưu bộ hẹn giờ cảnh báo trước khi thông tin xác thực hết hạn, đồng thời thay thế (và dừng) bộ hẹn giờ cũ.
// Nếu kết nối đã đóng, bộ hẹn giờ sẽ dừng ngay.
func (c *S3Conn) SetExpiryTimer(t *time.Timer) {
	c.expiryMu.Lock()
	defer c.expiryMu.Unlock()
	if c.expiryTimer != nil {
		c.expiryTimer.Stop()
	}
	c.expiryTimer = t
	if c.closed && t != nil {
		t.Stop()
	}
}

// Close dừng bộ hẹn giờ hết hạn và đóng các kết nối HTTP đang nhàn rỗi. Gọi hàm bên ngoài khóa registry.
func (c *S3Conn) Close() {
	c.expiryMu.Lock()
	c.closed = true
	if c.expiryTimer != nil {
		c.expiryTimer.Stop()
	}
	c.expiryMu.Unlock()

	if c.Transport != nil {
		c.Transport.CloseIdleConnections()
	}
}

// ExpiresIn trả về thời gian còn lại nếu thông tin xác thực không thể tự gia hạn và sẽ hết hạn trong khoảng window.
func (c *S3Conn) ExpiresIn(window time.Duration) (time.Duration, bool) {
	if c == nil || c.CredInfo.Refreshable || c.CredInfo.Expiry == nil {
		return 0, false
	}
	at, ok := c.CredInfo.Expiry()
	left := time.Until(at)
	return left, ok && left > 0 && left < window
}

// GetConnContainer trả về kết nối được đăng ký với id đã cho.
func (m *Module) GetConnContainer(id string) (*S3Conn, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	conn, ok := m.connContainer[id]
	return conn, ok
}

// HasConn cho biết có kết nối nào được đăng ký với id đã cho hay không.
func (m *Module) HasConn(id string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	_, ok := m.connContainer[id]
	return ok
}

// RemoveConn hủy đăng ký rồi trả về kết nối mang id đã cho. Các hàm Remove* không tự đóng kết nối:
// thao tác đóng có I/O mạng nên bên gọi chỉ thực hiện sau khi nhả khóa.
func (m *Module) RemoveConn(id string) (*S3Conn, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	conn, ok := m.connContainer[id]
	if ok {
		delete(m.connContainer, id)
	}
	return conn, ok
}

// ReplaceConn đăng ký kết nối với id đã cho và trả về kết nối trước đó trong cùng một lần khóa,
// để bên gọi có thể đóng kết nối cũ bên ngoài khóa. old là nil nếu chưa có kết nối nào.
func (m *Module) ReplaceConn(id string, conn *S3Conn) (old *S3Conn) {
	m.mu.Lock()
	defer m.mu.Unlock()
	old = m.connContainer[id]
	m.connContainer[id] = conn
	return old
}

// AcquireConn trả về kết nối mang id đã cho và tăng số lượt truyền dữ liệu đang chạy (tải lên hoặc tải xuống)
// ngay trong cùng một lần khóa, để RemoveConnIfIdle không bỏ sót lượt truyền. Bên gọi phải gọi release đúng một lần
// khi lượt truyền kết thúc.
func (m *Module) AcquireConn(id string) (conn *S3Conn, release func(), ok bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	conn, ok = m.connContainer[id]
	if !ok {
		return nil, nil, false
	}
	m.transfers[id]++

	var once sync.Once
	return conn, func() { once.Do(func() { m.releaseTransfer(id) }) }, true
}

// releaseTransfer giảm bộ đếm một lượt truyền đang chạy của kết nối mang id đã cho.
func (m *Module) releaseTransfer(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.transfers[id] <= 1 {
		delete(m.transfers, id)
		return
	}
	m.transfers[id]--
}

// RemoveConnIfIdle hủy đăng ký kết nối mang id đã cho, trừ khi kết nối đang có lượt truyền dữ liệu;
// trong trường hợp đó busy là true và kết nối không bị gỡ. Bên gọi phải đóng kết nối trả về bên ngoài khóa.
func (m *Module) RemoveConnIfIdle(id string) (conn *S3Conn, removed, busy bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.transfers[id] > 0 {
		return nil, false, true
	}
	conn, removed = m.connContainer[id]
	if removed {
		delete(m.connContainer, id)
	}
	return conn, removed, false
}

// RemoveAllConn hủy đăng ký mọi kết nối và trả về chúng để bên gọi đóng bên ngoài khóa.
func (m *Module) RemoveAllConn() []*S3Conn {
	m.mu.Lock()
	defer m.mu.Unlock()
	conns := make([]*S3Conn, 0, len(m.connContainer))
	for id, conn := range m.connContainer {
		conns = append(conns, conn)
		delete(m.connContainer, id)
	}
	return conns
}
