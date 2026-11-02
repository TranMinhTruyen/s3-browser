package utils

// dialogCancelled is the text of cfd.ErrorCancelled, which Wails returns on Windows when the user closes a
// file dialog. macOS and Linux return an empty path with a nil error instead.
const dialogCancelled = "cancelled by user"

// IsDialogCancelled reports whether err means the user cancelled a native file dialog. The error is compared by
// text because Wails defines it in an internal package, so it can be neither imported nor matched with errors.Is.
func IsDialogCancelled(err error) bool {
	return err != nil && err.Error() == dialogCancelled
}
