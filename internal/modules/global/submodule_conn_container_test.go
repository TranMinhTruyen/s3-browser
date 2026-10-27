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

func TestNewModule(t *testing.T) {
	m := NewModule()
	if m.connContainer == nil || m.transfers == nil {
		t.Fatal("maps must be initialised")
	}
}

func TestPutGetHasRemoveConn(t *testing.T) {
	m := NewModule()
	conn := &S3Conn{ProfileName: "p"}

	if m.HasConn("c") {
		t.Fatal("empty container must not have connection")
	}
	if _, ok := m.GetConnContainer("c"); ok {
		t.Fatal("missing connection must not be found")
	}
	if _, ok := m.RemoveConn("c"); ok {
		t.Fatal("missing connection must not be removed")
	}

	m.PutConnContainer("c", conn)
	if !m.HasConn("c") {
		t.Fatal("connection must be registered")
	}
	if got, ok := m.GetConnContainer("c"); !ok || got != conn {
		t.Fatal("registered connection must be returned")
	}
	if got, ok := m.RemoveConn("c"); !ok || got != conn || m.HasConn("c") {
		t.Fatal("connection must be removed and returned")
	}
}

func TestAcquireConn_CountsTransfers(t *testing.T) {
	m := NewModule()
	conn := &S3Conn{}
	m.PutConnContainer("c", conn)

	got, release1, ok := m.AcquireConn("c")
	if !ok || got != conn || release1 == nil {
		t.Fatal("registered connection must be acquired")
	}
	_, release2, _ := m.AcquireConn("c")
	if m.transfers["c"] != 2 {
		t.Fatalf("transfers = %d, want 2", m.transfers["c"])
	}

	release1()
	if m.transfers["c"] != 1 {
		t.Fatalf("transfers = %d, want 1", m.transfers["c"])
	}
	release2()
	if _, ok := m.transfers["c"]; ok {
		t.Fatal("counter must be deleted at zero")
	}
}

func TestRemoveAllConn(t *testing.T) {
	tests := []struct {
		name string
		ids  []string
	}{
		{"empty", nil},
		{"several", []string{"a", "b", "c"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := NewModule()
			for _, id := range tt.ids {
				m.PutConnContainer(id, &S3Conn{ProfileName: id})
			}
			if got := m.RemoveAllConn(); len(got) != len(tt.ids) {
				t.Fatalf("removed %d, want %d", len(got), len(tt.ids))
			}
			if len(m.connContainer) != 0 {
				t.Fatal("container must be empty")
			}
		})
	}
}
