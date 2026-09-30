package global

import (
	"net/http"

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
