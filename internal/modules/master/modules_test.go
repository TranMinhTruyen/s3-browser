package master

import "testing"

func TestGetMasterData(t *testing.T) {
	m, sqlDB := newTestModule(t)
	_, err := sqlDB.Exec(`INSERT INTO master(code, name, sort_order, value1, value2, value3, value4, value5,
		value6, value7, value8, value9, value10)
		VALUES ('FULL', 'n', 1, 'v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10')`)
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	tests := []struct {
		name  string
		codes []string
		want  map[string]int
	}{
		{"nil codes", nil, map[string]int{}},
		{"empty code skipped", []string{""}, map[string]int{}},
		{"unknown code gives empty list", []string{"NONE"}, map[string]int{"NONE": 0}},
		{"region and full", []string{"REGION", "FULL"}, map[string]int{"REGION": 8, "FULL": 1}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			out := m.GetMasterData(tt.codes)
			if !out.Result || len(out.MessageList) != 0 {
				t.Fatalf("unexpected failure: %+v", out)
			}
			if len(out.Body.MasterData) != len(tt.want) {
				t.Fatalf("got %d codes, want %d", len(out.Body.MasterData), len(tt.want))
			}
			for code, n := range tt.want {
				if got := len(out.Body.MasterData[code]); got != n {
					t.Fatalf("%s: got %d items, want %d", code, got, n)
				}
			}
		})
	}

	item := m.GetMasterData([]string{"FULL"}).Body.MasterData["FULL"][0]
	if item.Value1 != "v1" || item.Value2 != "v2" || item.Value10 != "v10" || item.Name != "n" {
		t.Fatalf("fields not mapped: %+v", item)
	}
}

func TestGetMasterData_DBError(t *testing.T) {
	m, sqlDB := newTestModule(t)
	_ = sqlDB.Close()

	out := m.GetMasterData([]string{"REGION"})
	if len(out.MessageList) != 1 || out.MessageList[0].MessageCode != MTE001 {
		t.Fatalf("want one %s message, got %+v", MTE001, out.MessageList)
	}
	if _, ok := out.Body.MasterData["REGION"]; ok {
		t.Fatal("failed code must not be in the body")
	}
}

func TestGetRegion(t *testing.T) {
	m, _ := newTestModule(t)

	out := m.GetRegion()
	if !out.Result {
		t.Fatalf("unexpected failure: %+v", out)
	}
	want := map[string]int{"01": 4, "02": 2, "03": 1, "04": 1}
	if len(out.Body.RegionData) != len(want) {
		t.Fatalf("got %d groups, want %d", len(out.Body.RegionData), len(want))
	}
	for group, n := range want {
		if got := len(out.Body.RegionData[group]); got != n {
			t.Fatalf("group %s: got %d, want %d", group, got, n)
		}
	}
}

func TestGetRegion_DBError(t *testing.T) {
	m, sqlDB := newTestModule(t)
	_ = sqlDB.Close()

	out := m.GetRegion()
	if out.Result || len(out.MessageList) != 1 || out.MessageList[0].MessageCode != MTE001 {
		t.Fatalf("want failure with %s, got %+v", MTE001, out)
	}
}
