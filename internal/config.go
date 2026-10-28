package internal

import "encoding/json"

// Config holds the fields we read back from wails.json at runtime,
// so the project config stays the single source of truth for app metadata.
type Config struct {
	Name string `json:"name"`
}

// ParseConfig decodes the embedded wails.json payload handed in by main.
// A malformed payload yields a zero Config instead of an error.
func ParseConfig(raw []byte) Config {
	var cfg Config
	_ = json.Unmarshal(raw, &cfg) // on error keep whatever was decoded, see doc
	return cfg
}
