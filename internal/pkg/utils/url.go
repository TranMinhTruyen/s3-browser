package utils

import (
	"net"
	"net/url"
	"strings"
)

// IsSecureUrl cho biết raw có phải URL tuyệt đối an toàn để gửi thông tin xác thực hay không: https được chấp nhận,
// còn http chỉ được dùng với host loopback (localhost, 127.0.0.0/8, ::1). URL lấy từ tài liệu bên ngoài (OIDC discovery)
// phải vượt qua kiểm tra này trước khi mở trình duyệt hoặc đổi token, để tài liệu độc hại không thể chuyển hướng đăng nhập
// đến đích không mã hóa hoặc không phải web (file:, javascript:, ...).
func IsSecureUrl(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil {
		return false
	}
	host := u.Hostname()
	switch {
	case host == "":
		return false
	case u.Scheme == "https":
		return true
	case u.Scheme == "http":
		ip := net.ParseIP(host)
		return strings.EqualFold(host, "localhost") || (ip != nil && ip.IsLoopback())
	}
	return false
}
