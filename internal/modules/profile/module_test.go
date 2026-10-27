package profile

import (
	"net/http"
	"strings"
	"testing"

	"S3Browser/internal/modules/global"
	"S3Browser/models"
)

func newInput() models.ConnectionProfileInput {
	return models.ConnectionProfileInput{
		Name:         "dev",
		Color:        "red",
		Provider:     "minio",
		Endpoint:     "http://localhost:9000",
		Region:       "us-east-1",
		AccessKey:    "ak",
		SecretKey:    "sk",
		PathStyle:    true,
		AutoConnect:  true,
		SavePassword: true,
	}
}

func firstCode(msgs []models.Message) string {
	if len(msgs) == 0 {
		return ""
	}
	return msgs[0].MessageCode
}

func TestCreateProfile(t *testing.T) {
	tests := []struct {
		name         string
		savePassword bool
	}{
		{"save password", true},
		{"no password", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m, sqlDB := newTestModule(t)
			in := newInput()
			in.SavePassword = tt.savePassword

			out := m.CreateProfile(in)
			if !out.Result || firstCode(out.MessageList) != PFS001 {
				t.Fatalf("want success PFS001, got %+v", out)
			}
			if out.Body.ID == "" || out.Body.Name != "dev" || out.Body.SecretKey != "sk" {
				t.Fatalf("unexpected body: %+v", out.Body)
			}

			var stored string
			if err := sqlDB.QueryRow("SELECT secret_key FROM connection_profiles WHERE id = ?", out.Body.ID).
				Scan(&stored); err != nil {
				t.Fatalf("select: %v", err)
			}
			if tt.savePassword == (stored == "") {
				t.Fatalf("stored secret = %q, savePassword = %v", stored, tt.savePassword)
			}
		})
	}
}

func TestCreateProfile_Errors(t *testing.T) {
	t.Run("encrypt fails", func(t *testing.T) {
		m, _ := newTestModuleWithKM(t, newBrokenKeyManager(t))
		out := m.CreateProfile(newInput())
		if out.Result || firstCode(out.MessageList) != PFE002 {
			t.Fatalf("want PFE002, got %+v", out)
		}
	})
	t.Run("db rejects", func(t *testing.T) {
		m, _ := newTestModule(t)
		in := newInput()
		in.Name = strings.Repeat("x", 101) // violates the CHECK on name length
		out := m.CreateProfile(in)
		if out.Result || firstCode(out.MessageList) != PFE001 {
			t.Fatalf("want PFE001, got %+v", out)
		}
	})
}

func TestUpdateProfileById(t *testing.T) {
	tests := []struct {
		name         string
		savePassword bool
	}{
		{"save password", true},
		{"clear password", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m, sqlDB := newTestModule(t)
			created := m.CreateProfile(newInput()).Body

			in := newInput()
			in.Id, in.Version, in.Name, in.SavePassword = created.ID, created.Version, "renamed", tt.savePassword
			out := m.UpdateProfileById(in)
			if !out.Result || firstCode(out.MessageList) != PFS002 {
				t.Fatalf("want success PFS002, got %+v", out)
			}
			if out.Body.Name != "renamed" || out.Body.Version != created.Version+1 {
				t.Fatalf("unexpected body: %+v", out.Body)
			}

			var stored string
			if err := sqlDB.QueryRow("SELECT secret_key FROM connection_profiles WHERE id = ?", created.ID).
				Scan(&stored); err != nil {
				t.Fatalf("select: %v", err)
			}
			if tt.savePassword == (stored == "") {
				t.Fatalf("stored secret = %q, savePassword = %v", stored, tt.savePassword)
			}
		})
	}
}

func TestUpdateProfileById_Errors(t *testing.T) {
	t.Run("encrypt fails", func(t *testing.T) {
		m, _ := newTestModuleWithKM(t, newBrokenKeyManager(t))
		out := m.UpdateProfileById(newInput())
		if out.Result || firstCode(out.MessageList) != PFE002 {
			t.Fatalf("want PFE002, got %+v", out)
		}
	})
	t.Run("stale version", func(t *testing.T) {
		m, _ := newTestModule(t)
		created := m.CreateProfile(newInput()).Body
		in := newInput()
		in.Id, in.Version = created.ID, created.Version+10
		out := m.UpdateProfileById(in)
		if out.Result || firstCode(out.MessageList) != PFE005 {
			t.Fatalf("want PFE005, got %+v", out)
		}
	})
}

func TestDeleteProfileById(t *testing.T) {
	tests := []struct {
		name    string
		connect bool
	}{
		{"without active connection", false},
		{"with active connection", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m, _ := newTestModule(t)
			created := m.CreateProfile(newInput()).Body
			if tt.connect {
				m.global.PutConnContainer(created.ID, &global.S3Conn{Transport: &http.Transport{}})
			}

			out := m.DeleteProfileById(models.ConnectionProfileInput{Id: created.ID, Name: "dev"})
			if !out.Result || !out.Body || firstCode(out.MessageList) != PFS003 {
				t.Fatalf("want success PFS003, got %+v", out)
			}
			if m.global.HasConn(created.ID) {
				t.Fatal("connection must be removed")
			}
			if got := m.GetConnectionProfileById(created.ID); got.Result {
				t.Fatal("profile must be gone")
			}
		})
	}
}

func TestDeleteProfileById_Errors(t *testing.T) {
	t.Run("transfers in progress", func(t *testing.T) {
		m, _ := newTestModule(t)
		created := m.CreateProfile(newInput()).Body
		m.global.PutConnContainer(created.ID, &global.S3Conn{Transport: &http.Transport{}})
		_, release, _ := m.global.AcquireConn(created.ID)
		defer release()

		out := m.DeleteProfileById(models.ConnectionProfileInput{Id: created.ID, Name: "dev"})
		if out.Result || firstCode(out.MessageList) != PFE007 || !m.global.HasConn(created.ID) {
			t.Fatalf("want PFE007 and connection kept, got %+v", out)
		}
	})
	t.Run("db error", func(t *testing.T) {
		m, sqlDB := newTestModule(t)
		_ = sqlDB.Close()
		out := m.DeleteProfileById(models.ConnectionProfileInput{Id: "x", Name: "dev"})
		if out.Result || firstCode(out.MessageList) != PFE006 {
			t.Fatalf("want PFE006, got %+v", out)
		}
	})
}

func TestGetConnectionProfileById(t *testing.T) {
	tests := []struct {
		name         string
		savePassword bool
		wantSecret   string
	}{
		{"decrypts secret", true, "sk"},
		{"empty secret", false, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m, _ := newTestModule(t)
			in := newInput()
			in.SavePassword = tt.savePassword
			created := m.CreateProfile(in).Body

			out := m.GetConnectionProfileById(created.ID)
			if !out.Result || out.Body.ID != created.ID || out.Body.SecretKey != tt.wantSecret {
				t.Fatalf("unexpected output: %+v", out)
			}
		})
	}
}

func TestGetConnectionProfileById_Errors(t *testing.T) {
	t.Run("not found", func(t *testing.T) {
		m, _ := newTestModule(t)
		out := m.GetConnectionProfileById("missing")
		if out.Result || firstCode(out.MessageList) != PFE003 {
			t.Fatalf("want PFE003, got %+v", out)
		}
	})
	t.Run("decrypt fails", func(t *testing.T) {
		m, sqlDB := newTestModule(t)
		created := m.CreateProfile(newInput()).Body
		mustExec(t, sqlDB, "UPDATE connection_profiles SET secret_key = 'not-a-cipher' WHERE id = ?", created.ID)
		out := m.GetConnectionProfileById(created.ID)
		if out.Result || firstCode(out.MessageList) != PFE002 {
			t.Fatalf("want PFE002, got %+v", out)
		}
	})
}

func TestGetAllConnectionProfile(t *testing.T) {
	m, _ := newTestModule(t)
	connected := m.CreateProfile(newInput()).Body
	noSecret := newInput()
	noSecret.SavePassword = false
	plain := m.CreateProfile(noSecret).Body
	m.global.PutConnContainer(connected.ID, &global.S3Conn{})

	out := m.GetAllConnectionProfile()
	if !out.Result || len(out.MessageList) != 0 || len(out.Body.ConnectionProfiles) != 2 {
		t.Fatalf("unexpected output: %+v", out)
	}
	if got := out.Body.ConnectionProfiles[connected.ID]; !got.IsConnected || got.SecretKey != "sk" {
		t.Fatalf("connected profile wrong: %+v", got)
	}
	if got := out.Body.ConnectionProfiles[plain.ID]; got.IsConnected || got.SecretKey != "" {
		t.Fatalf("plain profile wrong: %+v", got)
	}
}

func TestGetAllConnectionProfile_Errors(t *testing.T) {
	t.Run("db error", func(t *testing.T) {
		m, sqlDB := newTestModule(t)
		_ = sqlDB.Close()
		out := m.GetAllConnectionProfile()
		if out.Result || firstCode(out.MessageList) != PFE003 {
			t.Fatalf("want PFE003, got %+v", out)
		}
	})
	t.Run("decrypt fails keeps listing", func(t *testing.T) {
		m, sqlDB := newTestModule(t)
		created := m.CreateProfile(newInput()).Body
		mustExec(t, sqlDB, "UPDATE connection_profiles SET secret_key = 'not-a-cipher' WHERE id = ?", created.ID)
		out := m.GetAllConnectionProfile()
		if firstCode(out.MessageList) != PFE002 || len(out.Body.ConnectionProfiles) != 1 {
			t.Fatalf("want PFE002 and one profile, got %+v", out)
		}
	})
}
