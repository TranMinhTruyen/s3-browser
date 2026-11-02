package global

import (
	"net/http"
	"slices"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/minio/madmin-go/v4"
)

// CredInfo tells what the app may expect from the credentials of a connection.
type CredInfo struct {
	// Refreshable is false when the user must act before Expiry (new MFA code, `aws sso login`, OIDC login),
	// so the app warns before it. For sso the SDK still renews the role credentials; Expiry is the login token's.
	Refreshable bool
	// Expiry returns when the credentials expire; false if they don't or it isn't known. It never blocks.
	// Nil for anonymous connections.
	Expiry func() (time.Time, bool)
}

// AnonymousBucket is a bucket the user entered for an anonymous connection.
type AnonymousBucket struct {
	Name string
	// Accessible is the result of the latest HeadBucket check that got an answer from the server.
	Accessible bool
}

// S3Conn bundles the clients of one connected profile. Transport is kept so the idle
// HTTP connections can be closed when the connection is dropped.
type S3Conn struct {
	ProfileName string
	Provider    string
	AuthType    string
	// AwsProfile is the AWS CLI profile name (sharedProfile, sso, assumeRole); "default" when none is set.
	AwsProfile string

	Client  *s3.Client
	Presign *s3.PresignClient

	MinioAdmin *madmin.AdminClient

	Transport *http.Transport

	// Creds is what Client signs with; nil for anonymous connections.
	Creds    *SwapCreds
	CredInfo CredInfo

	// anonymousBuckets are the buckets of an anonymous connection (the API can't list them). The list is fixed
	// after the connection is built; only the Accessible flags change, under anonymousMu.
	anonymousMu      sync.RWMutex
	anonymousBuckets []AnonymousBucket

	expiryMu    sync.Mutex
	expiryTimer *time.Timer
	closed      bool
}

// SetAnonymousBuckets sets the buckets of an anonymous connection. Call it before the connection is shared.
func (c *S3Conn) SetAnonymousBuckets(names []string) {
	c.anonymousMu.Lock()
	defer c.anonymousMu.Unlock()
	c.anonymousBuckets = make([]AnonymousBucket, len(names))
	for i, name := range names {
		c.anonymousBuckets[i].Name = name
	}
}

// AnonymousBuckets returns a copy of the buckets of an anonymous connection.
func (c *S3Conn) AnonymousBuckets() []AnonymousBucket {
	c.anonymousMu.RLock()
	defer c.anonymousMu.RUnlock()
	return slices.Clone(c.anonymousBuckets)
}

// SetAnonymousAccessible records the check result of the i-th bucket of AnonymousBuckets.
func (c *S3Conn) SetAnonymousAccessible(i int, accessible bool) {
	c.anonymousMu.Lock()
	defer c.anonymousMu.Unlock()
	c.anonymousBuckets[i].Accessible = accessible
}

// SetExpiryTimer keeps the timer that warns before the credentials expire, replacing (and stopping) the previous
// one. On a closed connection the timer is stopped at once.
func (c *S3Conn) SetExpiryTimer(t *time.Timer) {
	c.expiryMu.Lock()
	defer c.expiryMu.Unlock()
	if c.expiryTimer != nil {
		c.expiryTimer.Stop()
	}
	c.expiryTimer = t
	if c.closed && t != nil {
		t.Stop()
	}
}

// Close stops the expiry timer and closes the idle HTTP connections. Call it outside of the registry lock.
func (c *S3Conn) Close() {
	c.expiryMu.Lock()
	c.closed = true
	if c.expiryTimer != nil {
		c.expiryTimer.Stop()
	}
	c.expiryMu.Unlock()

	if c.Transport != nil {
		c.Transport.CloseIdleConnections()
	}
}

// ExpiresIn returns the time left when the credentials can't be renewed automatically and expire within window.
func (c *S3Conn) ExpiresIn(window time.Duration) (time.Duration, bool) {
	if c == nil || c.CredInfo.Refreshable || c.CredInfo.Expiry == nil {
		return 0, false
	}
	at, ok := c.CredInfo.Expiry()
	left := time.Until(at)
	return left, ok && left > 0 && left < window
}

// GetConnContainer returns the connection registered under the given id.
func (m *Module) GetConnContainer(id string) (*S3Conn, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	conn, ok := m.connContainer[id]
	return conn, ok
}

// HasConn reports whether a connection is registered under the given id.
func (m *Module) HasConn(id string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	_, ok := m.connContainer[id]
	return ok
}

// RemoveConn unregisters the connection under the given id and returns it. Remove* functions
// never close it themselves: closing does network I/O, so the caller does it after the
// lock is released.
func (m *Module) RemoveConn(id string) (*S3Conn, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	conn, ok := m.connContainer[id]
	if ok {
		delete(m.connContainer, id)
	}
	return conn, ok
}

// ReplaceConn registers the connection under the given id and returns the previous one, in the
// same lock, so the caller can close it outside of the lock. old is nil if there was none.
func (m *Module) ReplaceConn(id string, conn *S3Conn) (old *S3Conn) {
	m.mu.Lock()
	defer m.mu.Unlock()
	old = m.connContainer[id]
	m.connContainer[id] = conn
	return old
}

// AcquireConn returns the connection under the given id and counts one running transfer
// (upload or download) on it, in the same lock, so RemoveConnIfIdle can't miss it.
// The caller must call release exactly once when the transfer ends.
func (m *Module) AcquireConn(id string) (conn *S3Conn, release func(), ok bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	conn, ok = m.connContainer[id]
	if !ok {
		return nil, nil, false
	}
	m.transfers[id]++

	var once sync.Once
	return conn, func() { once.Do(func() { m.releaseTransfer(id) }) }, true
}

// releaseTransfer drops one running transfer from the counter of the given connection id.
func (m *Module) releaseTransfer(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.transfers[id] <= 1 {
		delete(m.transfers, id)
		return
	}
	m.transfers[id]--
}

// RemoveConnIfIdle unregisters the connection under the given id unless a transfer is
// running on it; then busy is true and nothing is removed. The returned connection must be
// closed by the caller outside of the lock.
func (m *Module) RemoveConnIfIdle(id string) (conn *S3Conn, removed, busy bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.transfers[id] > 0 {
		return nil, false, true
	}
	conn, removed = m.connContainer[id]
	if removed {
		delete(m.connContainer, id)
	}
	return conn, removed, false
}

// RemoveAllConn unregisters every connection and returns them so the caller can close
// them outside of the lock.
func (m *Module) RemoveAllConn() []*S3Conn {
	m.mu.Lock()
	defer m.mu.Unlock()
	conns := make([]*S3Conn, 0, len(m.connContainer))
	for id, conn := range m.connContainer {
		conns = append(conns, conn)
		delete(m.connContainer, id)
	}
	return conns
}
