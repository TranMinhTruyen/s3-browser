// Package cnst chứa các hằng số dùng chung trong backend.
package cnst

// Tên module, được dùng trong Message.ModuleName.
var (
	Master  = "master"
	Profile = "profile"
	Bucket  = "bucket"
	Setting = "setting"
	Update  = "update"
	Db      = "db"
)

var (
	// FullDateTimeFormatPattern là định dạng của Message.Order.
	FullDateTimeFormatPattern = "2006-01-02T15:04:05.000"

	// MessageTypeSuccess là mã loại thông báo thành công. Các mã loại phải khớp tên trong MessageTypeEnum của Java
	// (S/E/W/I) vì bên gọi RPC giải tuần tự messageType thành enum đó.
	MessageTypeSuccess = "S"
	// MessageTypeError là mã loại thông báo lỗi.
	MessageTypeError = "E"
	// MessageTypeWarn là mã loại thông báo cảnh báo.
	MessageTypeWarn = "W"
	// MessageTypeInfo là mã loại thông báo thông tin.
	MessageTypeInfo = "I"
)
