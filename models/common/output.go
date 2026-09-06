package common

type Output[T any] struct {
	MessageList *[]Message `json:"messageList"`
	Body        *T         `json:"body"`
}
