//go:build devtools

package main

import (
	"log/slog"
	"os"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// benchBlockedArgs are switches S3B_BENCH_BROWSER_ARGS may not set: the debug port and the user data dir belong to the
// bench script, and disable-features has its own env so Wails can merge it with its own list.
var benchBlockedArgs = []string{"--remote-debugging-", "--user-data-dir", "--disable-features"}

// benchFeatureName matches one WebView2 (Chromium) feature name.
var benchFeatureName = regexp.MustCompile(`^\w+$`)

// applyBenchOptions adds what the memory benchmark asks for through env to the WebView2 options. It is compiled only
// into the bench build (tag devtools); no env means no change.
func applyBenchOptions(logger *slog.Logger, w *application.WindowsOptions) {
	w.AdditionalBrowserArgs = append(w.AdditionalBrowserArgs, benchBrowserArgs(logger)...)
	w.DisabledFeatures = append(w.DisabledFeatures, benchDisabledFeatures(logger)...)
}

// benchBrowserArgs returns the browser switches of the bench run: the remote debugging port named by
// S3B_BENCH_CDP_PORT (1024-65535, so the benchmark can attach CDP) followed by the switches of S3B_BENCH_BROWSER_ARGS.
func benchBrowserArgs(logger *slog.Logger) []string {
	var args []string
	if value := os.Getenv("S3B_BENCH_CDP_PORT"); value != "" {
		port, err := strconv.Atoi(value)
		if err != nil || port < 1024 || port > 65535 {
			logger.Warn("S3B_BENCH_CDP_PORT ignored: want a number in 1024-65535", "value", value)
		} else {
			logger.Info("bench: remote debugging port enabled", "port", port)
			args = append(args, "--remote-debugging-port="+strconv.Itoa(port))
		}
	}
	return append(args, benchExtraArgs(logger)...)
}

// benchExtraArgs parses S3B_BENCH_BROWSER_ARGS: switches separated by spaces, each starting with "--". Every
// --js-flags=<v> is merged into one switch, because Chromium only keeps the last one.
func benchExtraArgs(logger *slog.Logger) []string {
	var args, jsFlags []string
	for _, arg := range strings.Fields(os.Getenv("S3B_BENCH_BROWSER_ARGS")) {
		lower := strings.ToLower(arg)
		blocked := slices.ContainsFunc(benchBlockedArgs, func(prefix string) bool {
			return strings.HasPrefix(lower, prefix)
		})
		if !strings.HasPrefix(arg, "--") || strings.Contains(arg, `"`) || blocked {
			logger.Warn("S3B_BENCH_BROWSER_ARGS: switch ignored", "value", arg)
			continue
		}
		if flags, ok := strings.CutPrefix(arg, "--js-flags="); ok {
			jsFlags = append(jsFlags, flags)
			continue
		}
		args = append(args, arg)
	}
	switch len(jsFlags) {
	case 0:
	case 1:
		args = append(args, "--js-flags="+jsFlags[0])
	default:
		args = append(args, `--js-flags="`+strings.Join(jsFlags, " ")+`"`)
	}
	if len(args) > 0 {
		logger.Info("bench: extra browser switches", "args", args)
	}
	return args
}

// benchDisabledFeatures parses S3B_BENCH_DISABLE_FEATURES: feature names separated by commas, no spaces.
func benchDisabledFeatures(logger *slog.Logger) []string {
	var features []string
	for _, name := range strings.Split(os.Getenv("S3B_BENCH_DISABLE_FEATURES"), ",") {
		switch {
		case name == "":
		case benchFeatureName.MatchString(name):
			features = append(features, name)
		default:
			logger.Warn("S3B_BENCH_DISABLE_FEATURES: feature ignored", "value", name)
		}
	}
	if len(features) > 0 {
		logger.Info("bench: extra disabled features", "features", features)
	}
	return features
}
