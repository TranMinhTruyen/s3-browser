package bucket

import (
	"S3Browser/internal/pkg/cnst"
	"S3Browser/models"
	"context"
	"errors"
	"time"
)

// withCallContext derives the context of one Wails call. The call context only ends when the
// frontend cancels the call, and Wails detaches it from the app lifetime, so it also stops on
// appCtx (app shutdown) and, if timeout > 0, after timeout so a hung endpoint can't block forever.
// The returned cancel must be deferred: it releases the timer and the appCtx watcher.
func withCallContext(ctx, appCtx context.Context, timeout time.Duration) (context.Context, context.CancelFunc) {
	var cancel context.CancelFunc
	if timeout > 0 {
		ctx, cancel = context.WithTimeout(ctx, timeout)
	} else {
		ctx, cancel = context.WithCancel(ctx)
	}
	stop := context.AfterFunc(appCtx, cancel)

	return ctx, func() {
		stop()
		cancel()
	}
}

// isCallCanceled reports whether the frontend canceled the call. Nobody waits for the result then,
// so callers return Result=false without a message. A timeout is not a cancel and is still reported.
func isCallCanceled(ctx context.Context) bool {
	return errors.Is(ctx.Err(), context.Canceled)
}

// notConnectedMessage is the S3E006 message for a connection id that is not in the shared store.
func notConnectedMessage(profileName string) models.Message {
	return models.NewParamsMessage(cnst.MessageTypeError, cnst.Bucket, S3E006, "", map[string]any{
		"name": profileName,
	})
}
