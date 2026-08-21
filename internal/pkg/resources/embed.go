package resources

import (
	"embed"
)

//go:embed application*.yml
var ConfigFiles embed.FS
