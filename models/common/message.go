// Package common holds the models shared by every module: the Output envelope and Message.
package common

import (
	"S3Browser/internal/pkg/cnst"
	"time"
)

// Message is one user-facing message; the frontend resolves MessageCode to a localized text.
type Message struct {
	Order       string         `json:"order,omitempty"`
	ModuleName  string         `json:"moduleName,omitempty"`
	MessageType string         `json:"messageType,omitempty"`
	MessageCode string         `json:"messageCode,omitempty"`
	Params      map[string]any `json:"params,omitempty"`
	ErrorDetail string         `json:"errorDetail,omitempty"`
}

// NewMessage builds a message stamped with the current time (Order).
func NewMessage(messageType string, moduleName string, code string, errorDetail string) Message {
	return Message{
		Order:       time.Now().Format(cnst.FullDateTimeFormatPattern),
		ModuleName:  moduleName,
		MessageType: messageType,
		MessageCode: code,
		ErrorDetail: errorDetail,
	}
}

// NewParamsMessage is NewMessage with params for the localized text.
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
