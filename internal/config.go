package internal

import "encoding/json"

// Config holds the fields we read back from wails.json at runtime,
// so the project config stays the single source of truth for app metadata.
type Config struct {
	Name string `json:"name"`
}

// ParseConfig decodes the embedded wails.json payload handed in by main.
func ParseConfig(raw []byte) Config {
	var cfg Config
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return cfg
	}
	return cfg
}
