package utils

import (
	"time"

	"github.com/google/uuid"
)

func GenerateUUID() string {
	return uuid.Must(uuid.NewV7()).String()
}

// ReportEvery calls fn every d in a separate goroutine.
//
// The returned stop() function:
//  1. stops the ticker,
//  2. calls fn one last time (so the UI shows the final value),
//  3. waits for the goroutine to exit, so fn is never called after stop() returns.
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
		quit <- struct{}{}
		fn()
	}
}
