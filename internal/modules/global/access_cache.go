package global

import (
	"sync"
	"time"
)

// accessTTL is how long a bucket access check stays valid; after it the bucket is checked again.
const accessTTL = 5 * time.Minute

// AccessKind is the kind of access a check tells about.
type AccessKind int

const (
	AccessRead AccessKind = iota
	AccessWrite
)

type accessEntry struct {
	denied bool
	at     time.Time
}

// AccessCache keeps the bucket access checks of one connection, per bucket name. Read and write results have their
// own time because a listing doesn't always check the write access. The zero value is ready to use.
//
// Reset bumps a generation. A caller reads Generation before probing and passes it to Set / MarkAccount, which
// ignore the result when a Reset happened meanwhile (it was made with the old credentials).
type AccessCache struct {
	mu         sync.Mutex
	entries    [2]map[string]accessEntry
	accountAt  time.Time
	generation uint64
}

// Generation returns the current generation; take it before starting a probe.
func (a *AccessCache) Generation() uint64 {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.generation
}

// Get returns whether the access was denied at the latest check; ok is false when there is none or it expired.
func (a *AccessCache) Get(kind AccessKind, bucket string) (denied, ok bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	e, ok := a.entries[kind][bucket]
	return e.denied, ok && time.Since(e.at) < accessTTL
}

// Set records the result of a check that got a sure answer from the server; gen is the Generation taken before it.
func (a *AccessCache) Set(kind AccessKind, bucket string, denied bool, gen uint64) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if gen != a.generation {
		return
	}
	if a.entries[kind] == nil {
		a.entries[kind] = map[string]accessEntry{}
	}
	a.entries[kind][bucket] = accessEntry{denied: denied, at: time.Now()}
}

// AccountFresh reports whether the MinIO AccountInfo was called recently enough (see MarkAccount) not to call it again.
func (a *AccessCache) AccountFresh() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return time.Since(a.accountAt) < accessTTL
}

// MarkAccount records that the MinIO AccountInfo was just called, whether or not it succeeded; gen is the
// Generation taken before the call.
func (a *AccessCache) MarkAccount(gen uint64) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if gen == a.generation {
		a.accountAt = time.Now()
	}
}

// Reset forgets every result, e.g. when the credentials changed.
func (a *AccessCache) Reset() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.entries = [2]map[string]accessEntry{}
	a.accountAt = time.Time{}
	a.generation++
}
