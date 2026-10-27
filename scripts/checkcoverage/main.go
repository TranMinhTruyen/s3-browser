// Command checkcoverage runs the Go tests of a package pattern and checks statement coverage.
//
// Per-file and total percentages are printed; blocks shared by several packages are merged
// (a block counts as covered if any package hit it). Files whose path contains an -exclude
// fragment are dropped before the numbers are computed. It exits 1 when the total is below -min.
//
// Usage (from App/S3Browser): go run ./scripts/checkcoverage [-min 95] [-exclude a,b] [-exclude c]
package main

import (
	"bufio"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sort"
	"strconv"
	"strings"
)

// block is one line of a cover profile: <file>:<range> <statements> <count>.
type block struct {
	file  string
	key   string // file:range, identifies a block across packages
	stmts int
	hit   bool
}

// fileStat is the coverage of one file.
type fileStat struct {
	file    string
	stmts   int
	covered int
}

func (s fileStat) percent() float64 {
	if s.stmts == 0 {
		return 100
	}
	return 100 * float64(s.covered) / float64(s.stmts)
}

// excludeFlag collects -exclude values; each value may hold several fragments separated by commas.
type excludeFlag []string

func (e *excludeFlag) String() string { return strings.Join(*e, ",") }

func (e *excludeFlag) Set(v string) error {
	for _, part := range strings.Split(v, ",") {
		if part = strings.TrimSpace(part); part != "" {
			*e = append(*e, part)
		}
	}
	return nil
}

func main() {
	minPct := flag.Float64("min", 95, "minimum total coverage in percent")
	profile := flag.String("coverprofile", "coverage.out", "cover profile file")
	packages := flag.String("packages", "./internal/modules/...", "package pattern to test")
	var exclude excludeFlag
	flag.Var(&exclude, "exclude", "path fragment of files to ignore (repeatable or comma separated)")
	flag.Parse()

	if code := runTests(*packages, *profile); code != 0 {
		os.Exit(code)
	}

	f, err := os.Open(*profile)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer func() { _ = f.Close() }()
	blocks, err := parseProfile(f)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	stats := perFile(mergeBlocks(filterBlocks(blocks, exclude)))
	for _, s := range stats {
		fmt.Printf("%6.1f%%  %4d/%-4d %s\n", s.percent(), s.covered, s.stmts, s.file)
	}
	total := sum(stats)
	fmt.Printf("TOTAL %.1f%% (%d/%d), min %v%%\n", total.percent(), total.covered, total.stmts, *minPct)

	if total.percent() < *minPct {
		fmt.Fprintf(os.Stderr, "Coverage %.1f%% is below %v%%\n", total.percent(), *minPct)
		os.Exit(1)
	}
}

// runTests runs go test with a shared cover profile and returns the exit code (0 on success).
func runTests(packages, profile string) int {
	cmd := exec.Command("go", "test", "-coverpkg="+packages, "-coverprofile="+profile, packages)
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	err := cmd.Run()
	var exitErr *exec.ExitError
	switch {
	case err == nil:
		return 0
	case errors.As(err, &exitErr):
		return exitErr.ExitCode()
	default:
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
}

// parseProfile reads a cover profile, skipping the "mode:" header and malformed lines.
func parseProfile(r io.Reader) ([]block, error) {
	var blocks []block
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for sc.Scan() {
		if b, ok := parseLine(sc.Text()); ok {
			blocks = append(blocks, b)
		}
	}
	return blocks, sc.Err()
}

// parseLine parses "<file>:<range> <statements> <count>".
func parseLine(line string) (block, bool) {
	fields := strings.Fields(line)
	if len(fields) != 3 {
		return block{}, false
	}
	colon := strings.LastIndex(fields[0], ":")
	stmts, err1 := strconv.Atoi(fields[1])
	count, err2 := strconv.Atoi(fields[2])
	if colon <= 0 || err1 != nil || err2 != nil {
		return block{}, false
	}
	return block{file: fields[0][:colon], key: fields[0], stmts: stmts, hit: count > 0}, true
}

// filterBlocks drops blocks whose file path contains any of the fragments.
func filterBlocks(blocks []block, exclude []string) []block {
	var out []block
next:
	for _, b := range blocks {
		for _, frag := range exclude {
			if strings.Contains(b.file, frag) {
				continue next
			}
		}
		out = append(out, b)
	}
	return out
}

// mergeBlocks joins blocks with the same file:range, so a statement is counted once and is covered if any copy was hit.
func mergeBlocks(blocks []block) []block {
	index := map[string]int{}
	var out []block
	for _, b := range blocks {
		if i, ok := index[b.key]; ok {
			out[i].hit = out[i].hit || b.hit
			continue
		}
		index[b.key] = len(out)
		out = append(out, b)
	}
	return out
}

// perFile sums the statements per file, sorted by file name.
func perFile(blocks []block) []fileStat {
	byFile := map[string]*fileStat{}
	for _, b := range blocks {
		s := byFile[b.file]
		if s == nil {
			s = &fileStat{file: b.file}
			byFile[b.file] = s
		}
		s.stmts += b.stmts
		if b.hit {
			s.covered += b.stmts
		}
	}
	stats := make([]fileStat, 0, len(byFile))
	for _, s := range byFile {
		stats = append(stats, *s)
	}
	sort.Slice(stats, func(i, j int) bool { return stats[i].file < stats[j].file })
	return stats
}

func sum(stats []fileStat) fileStat {
	var t fileStat
	for _, s := range stats {
		t.stmts += s.stmts
		t.covered += s.covered
	}
	return t
}
