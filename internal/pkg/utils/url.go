package utils

import (
	"net"
	"net/url"
	"strings"
)

// IsSecureUrl reports whether raw is an absolute URL that is safe to send credentials to: https, or http only
// for a loopback host (localhost, 127.0.0.0/8, ::1). A URL from a remote document (OIDC discovery) must pass
// this before the browser opens it or a token is exchanged, so a hostile document cannot redirect the sign-in
// to a plain-text or non-web target (file:, javascript:, ...).
func IsSecureUrl(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil {
		return false
	}
	host := u.Hostname()
	switch {
	case host == "":
		return false
	case u.Scheme == "https":
		return true
	case u.Scheme == "http":
		ip := net.ParseIP(host)
		return strings.EqualFold(host, "localhost") || (ip != nil && ip.IsLoopback())
	}
	return false
}
