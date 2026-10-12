package common

type Output[T any] struct {
	Result      bool      `json:"result,omitempty"`
	MessageList []Message `json:"messageList,omitempty"`
	Body        T         `json:"body,omitempty"`
}

func NewOutput[T any]() Output[T] {
	return Output[T]{
		Result:      true,
		MessageList: []Message{},
	}
}

func (o *Output[T]) AddMessage(messages ...Message) *Output[T] {
	o.MessageList = append(o.MessageList, messages...)
	return o
}

func (o *Output[T]) ThrowError(messages ...Message) Output[T] {
	o.Result = false
	o.AddMessage(messages...)
	return *o
}
