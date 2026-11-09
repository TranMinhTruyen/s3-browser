// Package update holds the models of the app self-update module.
package update

// UpdateStateOutput is the state of the self-update, returned by the update calls and sent with the
// update:state-changed event.
type UpdateStateOutput struct {
	// Supported is false for dev, portable, non-NSIS builds and other OS: the frontend hides the feature.
	Supported bool `json:"supported"`
	// State is idle, checking, upToDate, available, downloading, ready or error.
	State          string `json:"state"`
	CurrentVersion string `json:"currentVersion"`
	// Version is the new release, set from available on.
	Version string `json:"version,omitempty"`
	// ReleaseUrl is the GitHub page of the new release.
	ReleaseUrl string `json:"releaseUrl,omitempty"`
	// Written and Total are the bytes downloaded and the installer size while downloading.
	Written int64 `json:"written"`
	Total   int64 `json:"total"`
	// ErrorCode is the message code (UPE...) of the failure when State is error.
	ErrorCode string `json:"errorCode,omitempty"`
}
