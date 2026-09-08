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

func InfoMessage(moduleName string, code string) Message {
	return Message{
		Order:       utils.ToPtr(time.Now().Format(cnst.FullDateTimeFormatPattern)),
		ModuleName:  utils.ToPtr(moduleName),
		MessageType: utils.ToPtr(cnst.MessageTypeInfo),
		MessageCode: utils.ToPtr(code),
	}
}

func ErrorMessage(moduleName string, code string) Message {
	return Message{
		Order:       utils.ToPtr(time.Now().Format(cnst.FullDateTimeFormatPattern)),
		ModuleName:  utils.ToPtr(moduleName),
		MessageType: utils.ToPtr(cnst.MessageTypeError),
		MessageCode: utils.ToPtr(code),
	}
}

func WarnMessage(moduleName string, code string) Message {
	return Message{
		Order:       utils.ToPtr(time.Now().Format(cnst.FullDateTimeFormatPattern)),
		ModuleName:  utils.ToPtr(moduleName),
		MessageType: utils.ToPtr(cnst.MessageTypeWarn),
		MessageCode: utils.ToPtr(code),
	}
}
