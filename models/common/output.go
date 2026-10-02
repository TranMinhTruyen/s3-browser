package common

type Output[T any] struct {
	Result      *bool      `json:"result"`
	MessageList *[]Message `json:"messageList,omitempty"`
	Body        *T         `json:"body,omitempty"`
}

func NewOutput[T any]() Output[T] {
	o := Output[T]{}
	*o.Result = true
	*o.MessageList = []Message{}
	o.Body = nil
	return o
}

func (o *Output[T]) AddMessage(messages ...Message) *Output[T] {
	if *o.MessageList == nil {
		*o.MessageList = []Message{}
	}
	*o.MessageList = append(*o.MessageList, messages...)
	return o
}

func (o *Output[T]) ThrowError(messages ...Message) Output[T] {
	*o.Result = false
	*o.MessageList = append(*o.MessageList, messages...)
	return *o
}
