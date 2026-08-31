package db

import (
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"sort"
	"strings"
)

//go:embed all:schemas/*.sql
var schemasFS embed.FS

func RunMigrations(db *sql.DB) error {
	entries, err := fs.ReadDir(schemasFS, "schemas")
	if err != nil {
		return fmt.Errorf("read schemas dir: %w", err)
	}

	var files []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".sql") {
			files = append(files, e.Name())
		}
	}
	sort.Strings(files)

	for _, name := range files {
		content, err := schemasFS.ReadFile("schemas/" + name)
		if err != nil {
			return fmt.Errorf("read schemas %s: %w", name, err)
		}

		if _, err := db.Exec(string(content)); err != nil {
			return fmt.Errorf("exec schemas %s: %w", name, err)
		}
	}

	return nil
}
