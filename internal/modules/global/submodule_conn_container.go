package global

import (
	"net/http"
	"sync"

	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/minio/madmin-go/v4"
)

type S3Conn struct {
	ProfileName string
	Provider    string

	Client  *s3.Client
	Presign *s3.PresignClient

	MinioAdmin *madmin.AdminClient

	Transport *http.Transport
}

// PutConnContainer registers a connection under the given id, replacing any previous one.
func (m *Module) PutConnContainer(id string, conn *S3Conn) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.connContainer[id] = conn
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

// RemoveConn unregisters the connection under the given id and returns it so the
// caller can close it outside of the lock.
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
