package bucket

import "time"

// OidcLoginOutput is the result of a OIDC sign-in. The tokens stay in the backend: the frontend only
// gets the session id to pass back as ConnectionProfileInput.OidcSessionId.
type OidcLoginOutput struct {
	SessionId string    `json:"sessionId"`
	ExpiresAt time.Time `json:"expiresAt"`
}
