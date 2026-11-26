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

// benchBlockedArgs là các tùy chọn không được phép đặt trong S3B_BENCH_BROWSER_ARGS: cổng debug và thư mục dữ liệu
// do script benchmark quản lý; disable-features có biến môi trường riêng để Wails gộp với danh sách của nó.
var benchBlockedArgs = []string{"--remote-debugging-", "--user-data-dir", "--disable-features"}

// benchFeatureName khớp với một tên tính năng WebView2 (Chromium).
var benchFeatureName = regexp.MustCompile(`^\w+$`)

// applyBenchOptions thêm các tùy chọn mà benchmark bộ nhớ yêu cầu qua biến môi trường vào WebView2. Hàm chỉ được biên dịch
// trong bản dựng benchmark (tag devtools); nếu không có biến môi trường thì không thay đổi gì.
func applyBenchOptions(logger *slog.Logger, w *application.WindowsOptions) {
	w.AdditionalBrowserArgs = append(w.AdditionalBrowserArgs, benchBrowserArgs(logger)...)
	w.DisabledFeatures = append(w.DisabledFeatures, benchDisabledFeatures(logger)...)
}

// benchBrowserArgs trả về các tùy chọn trình duyệt của lượt benchmark: cổng gỡ lỗi từ xa trong S3B_BENCH_CDP_PORT
// (1024-65535 để benchmark có thể kết nối CDP), tiếp theo là các tùy chọn từ S3B_BENCH_BROWSER_ARGS.
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

// benchExtraArgs phân tích S3B_BENCH_BROWSER_ARGS: các tùy chọn phân cách bằng dấu cách và mỗi tùy chọn bắt đầu bằng "--".
// Gộp mọi --js-flags=<v> thành một tùy chọn vì Chromium chỉ giữ lại giá trị cuối cùng.
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

// benchDisabledFeatures phân tích S3B_BENCH_DISABLE_FEATURES: tên tính năng phân cách bằng dấu phẩy, không có dấu cách.
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
