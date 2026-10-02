package cnst

// Module name.
var (
	Master  = "master"
	Profile = "profile"
	Bucket  = "bucket"
	Object  = "object"
)

var (
	DateTimeFormatPattern     = "2006-01-02 15:04:05"
	FullDateTimeFormatPattern = "2006-01-02T15:04:05.000"
	DateFormatPattern         = "2006-01-02"

	// Message type codes. These must match the names of Java's MessageTypeEnum
	// (S/E/W/I) - the RPC caller deserializes messageType into that enum.
	MessageTypeSuccess = "S"
	MessageTypeError   = "E"
	MessageTypeWarn    = "W"
	MessageTypeInfo    = "I"
)
