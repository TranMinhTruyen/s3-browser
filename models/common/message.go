// Package common chứa các model dùng chung cho mọi module: Output và Message.
package common

import (
	"S3Browser/internal/pkg/cnst"
	"time"
)

// Message là một thông báo dành cho người dùng; frontend ánh xạ MessageCode sang nội dung đã bản địa hóa.
type Message struct {
	Order       string         `json:"order,omitempty"`
	ModuleName  string         `json:"moduleName,omitempty"`
	MessageType string         `json:"messageType,omitempty"`
	MessageCode string         `json:"messageCode,omitempty"`
	Params      map[string]any `json:"params,omitempty"`
	ErrorDetail string         `json:"errorDetail,omitempty"`
}

// NewMessage tạo thông báo với thời điểm hiện tại (Order).
func NewMessage(messageType string, moduleName string, code string, errorDetail string) Message {
	return Message{
		Order:       time.Now().Format(cnst.FullDateTimeFormatPattern),
		ModuleName:  moduleName,
		MessageType: messageType,
		MessageCode: code,
		ErrorDetail: errorDetail,
	}
}

// NewParamsMessage tương tự NewMessage nhưng có params cho nội dung đã bản địa hóa.
func NewParamsMessage(
	messageType string,
	moduleName string,
	code string,
	errorDetail string,
	params map[string]any,
) Message {
	message := NewMessage(messageType, moduleName, code, errorDetail)
	message.Params = params
	return message
}
