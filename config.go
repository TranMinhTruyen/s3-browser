package main

import (
	_ "embed"
	"encoding/json"
)

//go:embed wails.json
var wailsConfigJSON []byte

// wailsConfig holds the fields we read back from wails.json at runtime,
// so the project config stays the single source of truth for app metadata.
type wailsConfig struct {
	Name           string `json:"name"`
	OutputFilename string `json:"outputfilename"`
}

func loadWailsConfig() wailsConfig {
	var cfg wailsConfig
	if err := json.Unmarshal(wailsConfigJSON, &cfg); err != nil {
		return cfg
	}
	return cfg
}
