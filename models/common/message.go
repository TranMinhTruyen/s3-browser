package common

import (
	"S3Browser/internal/pkg/cnst"
	"S3Browser/internal/pkg/utils"
	"time"
)

type Message struct {
	Order       *string         `json:"order"`
	ModuleName  *string         `json:"moduleName"`
	MessageType *string         `json:"messageType"`
	MessageCode *string         `json:"messageCode"`
	Params      *map[string]any `json:"params"`
	ErrorDetail *string         `json:"errorDetail"`
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
