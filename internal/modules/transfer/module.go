package transfer

import (
	"context"
	"fmt"
	"minio-browser/internal/modules/bucket"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type Module struct {
	ctx    context.Context
	bucket *bucket.Module
}

func NewModule(bucket *bucket.Module) *Module {
	return &Module{
		bucket: bucket,
	}
}

func (m *Module) Startup(ctx context.Context) {
	m.ctx = ctx
}

type API struct{ m *Module }

func (m *Module) API() *API {
	return &API{m: m}
}

// Greet returns a greeting for the given name
func (a *API) Greet(firstName string, lastName string) {
	result := fmt.Sprintf("Hello %s %s, It's show time!", firstName, lastName)
	runtime.EventsEmit(a.m.ctx, "transfer:greet", result)
}
