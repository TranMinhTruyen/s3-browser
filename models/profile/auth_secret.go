package profile

// AuthSecret holds the secrets of a profile besides SecretKey. It is stored encrypted as JSON in
// connection_profiles.auth_secret, only when the user ticks Save password, and is never sent to the frontend.
type AuthSecret struct {
	SessionToken string `json:"sessionToken,omitempty"`
	LdapPassword string `json:"ldapPassword,omitempty"`
	KeyPassword  string `json:"keyPassword,omitempty"`
}
