package main

import (
	"strings"
	"testing"
)

const sampleProfile = `mode: set
app/a.go:1.1,2.2 2 1
app/a.go:3.1,4.2 3 0
app/b[x].go:1.1,2.2 5 0
app/b[x].go:3.1,4.2 5 0
bad line
app/c.go:1.1,2.2 x 1
app/a.go:3.1,4.2 3 1
`

func mustParse(t *testing.T) []block {
	t.Helper()
	blocks, err := parseProfile(strings.NewReader(sampleProfile))
	if err != nil {
		t.Fatal(err)
	}
	return blocks
}

func TestParseProfile(t *testing.T) {
	blocks := mustParse(t)
	// header, "bad line" and the line with a non-numeric statement count are skipped
	if len(blocks) != 5 {
		t.Fatalf("got %d blocks: %+v", len(blocks), blocks)
	}
	want := block{file: "app/a.go", key: "app/a.go:1.1,2.2", stmts: 2, hit: true}
	if blocks[0] != want {
		t.Fatalf("got %+v want %+v", blocks[0], want)
	}
	if blocks[1].hit {
		t.Fatal("count 0 must not be a hit")
	}
}

func TestParseLine_Invalid(t *testing.T) {
	for _, l := range []string{"", "mode: set", ":1.1,2.2 1 1", "a.go:1.1,2.2 1 x", "a.go 1 1"} {
		if _, ok := parseLine(l); ok {
			t.Errorf("%q must be rejected", l)
		}
	}
}

func TestMergeBlocks(t *testing.T) {
	merged := mergeBlocks(mustParse(t))
	if len(merged) != 4 {
		t.Fatalf("got %d blocks: %+v", len(merged), merged)
	}
	// the duplicate a.go block is hit in one copy only: it is covered once, not counted twice
	stats := perFile(merged)
	if stats[0].file != "app/a.go" || stats[0].stmts != 5 || stats[0].covered != 5 {
		t.Fatalf("%+v", stats[0])
	}
}

func TestFilterBlocks(t *testing.T) {
	blocks := mustParse(t)
	// substring match, no wildcard: "[x]" is literal
	got := filterBlocks(blocks, []string{"b[x]"})
	for _, b := range got {
		if strings.Contains(b.file, "b[x]") {
			t.Fatalf("not excluded: %+v", b)
		}
	}
	if len(got) != 3 {
		t.Fatalf("got %d blocks", len(got))
	}
	if len(filterBlocks(blocks, nil)) != len(blocks) {
		t.Fatal("no exclude must keep everything")
	}
}

func TestPerFileAndTotal(t *testing.T) {
	stats := perFile(mergeBlocks(mustParse(t)))
	if len(stats) != 2 || stats[0].file != "app/a.go" || stats[1].file != "app/b[x].go" {
		t.Fatalf("%+v", stats)
	}
	if p := stats[1].percent(); p != 0 {
		t.Fatalf("b percent %v", p)
	}
	total := sum(stats)
	if total.stmts != 15 || total.covered != 5 {
		t.Fatalf("%+v", total)
	}
	if p := total.percent(); p < 33.3 || p > 33.4 {
		t.Fatalf("total percent %v", p)
	}
	if (fileStat{}).percent() != 100 {
		t.Fatal("empty file must be 100%")
	}
}

func TestExcludeFlag(t *testing.T) {
	var e excludeFlag
	for _, v := range []string{"a.go, b.go", "c.go", " ,"} {
		if err := e.Set(v); err != nil {
			t.Fatal(err)
		}
	}
	if e.String() != "a.go,b.go,c.go" {
		t.Fatalf("got %q", e.String())
	}
}
