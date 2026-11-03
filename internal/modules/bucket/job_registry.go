package bucket

import (
	"context"
	"sync"
)

// jobRegistry holds the cancel funcs of the transfers in flight, keyed by transfer ID. It is a sync.Map
// because the cancel handlers read it while the transfer goroutines add and remove entries.
type jobRegistry struct {
	jobs sync.Map
}

// start returns a context for the job id, canceled by cancel, cancelAll or parent. The returned func
// must be deferred: it releases the context and removes the job.
func (r *jobRegistry) start(parent context.Context, id string) (context.Context, func()) {
	ctx, cancel := context.WithCancel(parent)
	r.jobs.Store(id, cancel)
	return ctx, func() { cancel(); r.jobs.Delete(id) }
}

// cancel cancels the job id and reports whether it was running. Unknown or finished IDs are ignored.
func (r *jobRegistry) cancel(id string) bool {
	v, ok := r.jobs.LoadAndDelete(id)
	if ok {
		v.(context.CancelFunc)()
	}
	return ok
}

// cancelAll cancels every running job and calls onCancel with the ID of each.
func (r *jobRegistry) cancelAll(onCancel func(id string)) {
	r.jobs.Range(func(k, v any) bool {
		v.(context.CancelFunc)()
		onCancel(k.(string))
		return true
	})
}
