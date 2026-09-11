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
}

func SuccessMessage(moduleName string, code string) Message {

	return Message{
		Order:       utils.ToPtr(time.Now().Format(cnst.FullDateTimeFormatPattern)),
		ModuleName:  utils.ToPtr(moduleName),
		MessageType: utils.ToPtr(cnst.MessageTypeSuccess),
		MessageCode: utils.ToPtr(code),
	}
}

func CreateMessage(messageType string, moduleName string, code string) Message {
	return Message{
		Order:       utils.ToPtr(time.Now().Format(cnst.FullDateTimeFormatPattern)),
		ModuleName:  utils.ToPtr(moduleName),
		MessageType: utils.ToPtr(messageType),
		MessageCode: utils.ToPtr(code),
	}
}

func CreateMessageWithParams(messageType string, moduleName string, code string, params map[string]any) Message {
	message := CreateMessage(messageType, moduleName, code)
	message.Params = &params
	return message
}
