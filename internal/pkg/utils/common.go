// Package utils holds small helpers shared by the modules: ids, periodic reporting and secret encryption.
package utils

import (
	"time"

	"github.com/google/uuid"
)

// GenerateUUID returns a UUID v7: time-ordered, so ids sort by creation time (used for keyset paging).
func GenerateUUID() string {
	return uuid.Must(uuid.NewV7()).String()
}

// ReportEvery calls fn every d in a separate goroutine.
//
// The returned stop() function:
//  1. stops the ticker,
//  2. calls fn one last time (so the UI shows the final value),
//  3. waits for the goroutine to exit, so fn is never called after stop() returns.
//
// Used to throttle progress events: the caller updates a counter on every chunk and fn emits it at most once per d.
func ReportEvery(d time.Duration, fn func()) (stop func()) {
	t := time.NewTicker(d)
	quit := make(chan struct{})

	go func() {
		defer t.Stop()
		for {
			select {
			case <-t.C:
				fn()
			case <-quit:
				return
			}
		}
	}()

	return func() {
		// Unbuffered send: it completes only once the goroutine is out of fn, so the final fn below never overlaps it.
		quit <- struct{}{}
		fn()
	}
}
