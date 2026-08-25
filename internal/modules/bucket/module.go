package bucket

import (
	"context"

	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type Module struct {
	ctx     context.Context
	clients map[string]*s3.Client
}

func NewModule() *Module {
	return &Module{}
}

func (m *Module) Startup(ctx context.Context) {
	m.ctx = ctx
}
