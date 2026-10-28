package common

// Output is the envelope every handler returns.
type Output[T any] struct {
	Result      bool      `json:"result,omitempty"`
	MessageList []Message `json:"messageList,omitempty"`
	Body        T         `json:"body,omitempty"`
}

// NewOutput returns a successful, empty Output.
func NewOutput[T any]() Output[T] {
	return Output[T]{
		Result:      true,
		MessageList: []Message{},
	}
}

// AddMessage appends messages without changing Result.
func (o *Output[T]) AddMessage(messages ...Message) *Output[T] {
	o.MessageList = append(o.MessageList, messages...)
	return o
}

// ThrowError marks the output as failed, adds messages and returns it by value.
func (o *Output[T]) ThrowError(messages ...Message) Output[T] {
	o.Result = false
	o.AddMessage(messages...)
	return *o
}
