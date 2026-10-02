package common

import (
	"S3Browser/internal/pkg/cnst"
	"time"
)

type Message struct {
	Order       string         `json:"order,omitempty"`
	ModuleName  string         `json:"moduleName,omitempty"`
	MessageType string         `json:"messageType,omitempty"`
	MessageCode string         `json:"messageCode,omitempty"`
	Params      map[string]any `json:"params,omitempty"`
	ErrorDetail string         `json:"errorDetail,omitempty"`
}

func (m *Message) New() *Message {
	m.Order = time.Now().Format(cnst.FullDateTimeFormatPattern)
	return m
}

func NewMessage(messageType string, moduleName string, code string, errorDetail string) Message {
	return Message{
		Order:       time.Now().Format(cnst.FullDateTimeFormatPattern),
		ModuleName:  moduleName,
		MessageType: messageType,
		MessageCode: code,
		ErrorDetail: errorDetail,
	}
}

func NewErrorMessage(moduleName string, code string, errorDetail string) Message {
	message := NewMessage(cnst.MessageTypeError, moduleName, code, errorDetail)
	return message
}

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
