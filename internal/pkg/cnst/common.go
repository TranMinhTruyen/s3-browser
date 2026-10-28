// Package cnst holds the constants shared across the backend.
package cnst

// Module names, used as Message.ModuleName.
var (
	Master  = "master"
	Profile = "profile"
	Bucket  = "bucket"
)

var (
	// FullDateTimeFormatPattern is the layout of Message.Order.
	FullDateTimeFormatPattern = "2006-01-02T15:04:05.000"

	// MessageTypeSuccess is the success type code. Message type codes must match the names of
	// Java's MessageTypeEnum (S/E/W/I) - the RPC caller deserializes messageType into that enum.
	MessageTypeSuccess = "S"
	// MessageTypeError is the error type code.
	MessageTypeError = "E"
	// MessageTypeWarn is the warning type code.
	MessageTypeWarn = "W"
	// MessageTypeInfo is the info type code.
	MessageTypeInfo = "I"
)
