package global

import "testing"

func TestAcquireConn_Missing(t *testing.T) {
	m := NewModule()
	if _, _, ok := m.AcquireConn("x"); ok {
		t.Fatal("missing connection must not be acquired")
	}
}

func TestReplaceConn(t *testing.T) {
	m := NewModule()
	first, second := &S3Conn{}, &S3Conn{}

	if old := m.ReplaceConn("c", first); old != nil {
		t.Fatal("no previous connection expected")
	}
	if old := m.ReplaceConn("c", second); old != first {
		t.Fatal("previous connection must be returned")
	}
	if conn, ok := m.GetConnContainer("c"); !ok || conn != second {
		t.Fatal("new connection must be registered")
	}
}

func TestRemoveConnIfIdle(t *testing.T) {
	m := NewModule()
	m.PutConnContainer("c", &S3Conn{})

	_, release1, _ := m.AcquireConn("c")
	_, release2, _ := m.AcquireConn("c")

	if _, removed, busy := m.RemoveConnIfIdle("c"); !busy || removed || !m.HasConn("c") {
		t.Fatal("busy connection must stay")
	}

	release1()
	release1() // releasing twice must count once
	if _, _, busy := m.RemoveConnIfIdle("c"); !busy {
		t.Fatal("one transfer still running")
	}

	release2()
	if len(m.transfers) != 0 {
		t.Fatal("counter key must be deleted at zero")
	}
	if conn, removed, busy := m.RemoveConnIfIdle("c"); busy || !removed || conn == nil || m.HasConn("c") {
		t.Fatal("idle connection must be removed")
	}
	if _, removed, busy := m.RemoveConnIfIdle("c"); busy || removed {
		t.Fatal("nothing left to remove")
	}
}
