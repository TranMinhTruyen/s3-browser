package common

// Output là cấu trúc bao ngoài mà mọi handler trả về.
type Output[T any] struct {
	Result      bool      `json:"result,omitempty"`
	MessageList []Message `json:"messageList,omitempty"`
	Body        T         `json:"body,omitempty"`
}

// NewOutput trả về Output rỗng với trạng thái thành công.
func NewOutput[T any]() Output[T] {
	return Output[T]{
		Result:      true,
		MessageList: []Message{},
	}
}

// AddMessage thêm thông báo mà không thay đổi Result.
func (o *Output[T]) AddMessage(messages ...Message) *Output[T] {
	o.MessageList = append(o.MessageList, messages...)
	return o
}

// ThrowError đánh dấu đầu ra thất bại, thêm thông báo rồi trả về theo giá trị.
func (o *Output[T]) ThrowError(messages ...Message) Output[T] {
	o.Result = false
	o.AddMessage(messages...)
	return *o
}
