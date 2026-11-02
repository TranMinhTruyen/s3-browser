package bucket

import (
	"S3Browser/internal/modules/global"
	"S3Browser/internal/pkg/cnst"
	"S3Browser/models"
	"context"
	"errors"
	"math"
	"time"
)

// transferExpiryWarn is how close to expiry non-renewable credentials must be for a transfer to warn about it.
const transferExpiryWarn = 15 * time.Minute

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

// isCredentialsExpired reports whether err means the credentials ran out: the server rejected an expired token, or
// an MFA or OIDC session had to be renewed with a code or sign-in the app no longer has.
func isCredentialsExpired(err error) bool {
	if errors.Is(err, errMFACodeRequired) || errors.Is(err, errOidcLoginRequired) {
		return true
	}
	switch UnwrapAwsError(err) {
	case "ExpiredToken", "ExpiredTokenException", "RequestExpired":
		return true
	}
	return false
}

// expiredMessage is the S3E030 message for the profile name.
func expiredMessage(profileName string, err error) models.Message {
	return models.NewParamsMessage(cnst.MessageTypeError, cnst.Bucket, S3E030, UnwrapAwsError(err), map[string]any{
		"name": profileName,
	})
}

// transferExpiryWarning returns the S3W008 warning to show when a transfer starts on credentials that
// can't be renewed and expire within transferExpiryWarn; nothing if they are fine or c is nil.
func transferExpiryWarning(c *global.S3Conn, profileName string) []models.Message {
	left, ok := c.ExpiresIn(transferExpiryWarn)
	if !ok {
		return nil
	}
	minutes := int(math.Ceil(left.Minutes()))
	return []models.Message{
		models.NewParamsMessage(cnst.MessageTypeWarn, cnst.Bucket, S3W008, "", map[string]any{
			"name":    profileName,
			"minutes": minutes,
		}),
	}
}
