// Package utils holds small helpers shared by the modules: ids, batched progress reporting and secret encryption.
package utils

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"
)

// GenerateUUID returns a UUID v7: time-ordered, so ids sort by creation time (used for keyset paging).
func GenerateUUID() string {
	return uuid.Must(uuid.NewV7()).String()
}

// reportInterval is how often BatchReporter emits.
const reportInterval = 200 * time.Millisecond

// BatchReporter throttles progress events for many concurrent jobs into one batch event.
//
// Each job registers a read function with Track. While at least one job is tracked, a single
// ticker goroutine calls emit every reportInterval with the progress of all jobs; it exits when
// no job is left or the context ends. Callers update counters on every chunk and never emit themselves.
type BatchReporter[T any] struct {
	mu      sync.Mutex
	jobs    map[string]func() (T, bool)
	running bool
	ctx     func() context.Context
	emit    func(items []T)
}

// NewBatchReporter creates a reporter. ctx returns the context that stops the ticker (app shutdown);
// emit sends one batch to the frontend.
func NewBatchReporter[T any](ctx func() context.Context, emit func(items []T)) *BatchReporter[T] {
	return &BatchReporter[T]{jobs: make(map[string]func() (T, bool)), ctx: ctx, emit: emit}
}

// Track adds a job and starts the ticker if it is not running. read returns the current progress,
// or false if there is nothing to report yet.
//
// The returned done() emits one last batch (so the UI shows the final value) and then removes the job.
// Emitting is serialized with the ticker, so a final value is never overtaken by an older tick.
// done is idempotent: calls after the first do nothing.
func (r *BatchReporter[T]) Track(id string, read func() (T, bool)) (done func()) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.jobs[id] = read
	if !r.running {
		r.running = true
		go r.run(r.ctx())
	}
	var once sync.Once
	return func() {
		once.Do(func() {
			r.mu.Lock()
			defer r.mu.Unlock()
			r.emitLocked()
			delete(r.jobs, id)
		})
	}
}

// run emits a batch every reportInterval until no job is left or ctx ends.
func (r *BatchReporter[T]) run(ctx context.Context) {
	t := time.NewTicker(reportInterval)
	defer t.Stop()
	for {
		select {
		case <-t.C:
		case <-ctx.Done():
			r.mu.Lock()
			r.running = false
			r.mu.Unlock()
			return
		}
		r.mu.Lock()
		if len(r.jobs) == 0 {
			r.running = false
			r.mu.Unlock()
			return
		}
		r.emitLocked()
		r.mu.Unlock()
	}
}

// emitLocked emits the progress of all jobs, if any has something to report. The caller must hold mu.
func (r *BatchReporter[T]) emitLocked() {
	items := make([]T, 0, len(r.jobs))
	for _, read := range r.jobs {
		if item, ok := read(); ok {
			items = append(items, item)
		}
	}
	if len(items) > 0 {
		r.emit(items)
	}
}
