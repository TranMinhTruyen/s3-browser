package common

import (
	"S3Browser/internal/pkg/cnst"
	"S3Browser/internal/pkg/utils"
	"time"
)

type Message struct {
	Order       *string         `json:"order,omitempty"`
	ModuleName  *string         `json:"moduleName,omitempty"`
	MessageType *string         `json:"messageType,omitempty"`
	MessageCode *string         `json:"messageCode,omitempty"`
	Params      *map[string]any `json:"params,omitempty"`
	ErrorDetail *string         `json:"errorDetail,omitempty"`
}

func CreateMessage(messageType string, moduleName string, code string, errorDetail string) Message {
	return Message{
		Order:       utils.ToPtr(time.Now().Format(cnst.FullDateTimeFormatPattern)),
		ModuleName:  utils.ToPtr(moduleName),
		MessageType: utils.ToPtr(messageType),
		MessageCode: utils.ToPtr(code),
		ErrorDetail: utils.ToPtr(errorDetail),
	}
}

func CreateMessageWithParams(
	messageType string,
	moduleName string,
	code string,
	errorDetail string,
	params map[string]any,
) Message {
	message := CreateMessage(messageType, moduleName, code, errorDetail)
	message.Params = &params
	return message
}
