package common

type Output[T any] struct {
	MessageList *[]Message `json:"messageList,omitempty"`
	Body        *T         `json:"body,omitempty"`
}

func (o *Output[T]) New() {
	o.MessageList = &[]Message{}
	o.Body = new(T)
}

func (o *Output[T]) AddMessage(messages ...Message) {
	if o.MessageList == nil {
		o.MessageList = &[]Message{}
	}
	*o.MessageList = append(*o.MessageList, messages...)
}
