package update

import (
	"S3Browser/models"
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/updater"
	"github.com/wailsapp/wails/v3/pkg/updater/providers/github"
)

// Các giá trị của UpdateStateOutput.State.
const (
	stateIdle        = "idle"
	stateChecking    = "checking"
	stateUpToDate    = "upToDate"
	stateAvailable   = "available"
	stateDownloading = "downloading"
	stateReady       = "ready"
	stateError       = "error"
)

const (
	repository       = "TranMinhTruyen/s3-browser"
	checksumAsset    = "checksums.txt"
	firstCheckDelay  = 10 * time.Second
	checkInterval    = 6 * time.Hour
	checkTimeout     = 30 * time.Second
	progressInterval = 200 * time.Millisecond
	downloadTimeout  = 30 * time.Minute // whole download
	downloadIdle     = 60 * time.Second // no new byte for this long stops the download
	maxRedirects     = 10
	cleanupDelay     = 30 * time.Second // lets the installer that relaunched the app exit and unlock its exe
)

// errBusy cho biết đang có thao tác kiểm tra, tải xuống hoặc bộ cài sẵn sàng (hoặc tính năng đang tắt), nên không có gì được thực hiện.
var errBusy = errors.New("update is busy")

// noAssetRe khớp với lỗi provider khi bản phát hành không có bộ cài cho máy này.
var noAssetRe = regexp.MustCompile(`release (\S+) has no asset for`)

// updateError là lỗi kèm mã thông báo cần hiển thị; version được dùng cho tham số {version}.
type updateError struct {
	code    string
	version string
	err     error
}

func (e *updateError) Error() string { return e.err.Error() }
func (e *updateError) Unwrap() error { return e.err }

// submoduleUpdateMng quản lý trạng thái cập nhật. Mọi thay đổi trạng thái đều đi qua mu; mỗi lần chỉ chạy một thao tác
// kiểm tra hoặc tải xuống.
type submoduleUpdateMng struct {
	logger   *slog.Logger
	app      *application.App
	version  string
	provider *github.Provider // stable releases only
	betaProv *github.Provider // also pre-releases
	ctx      context.Context  // ends on close or app shutdown, stops the download and the periodic check
	cancel   context.CancelFunc

	mu         sync.Mutex
	st         models.UpdateStateOutput
	rel        *updater.Release // release found by the last check
	installer  string           // downloaded and verified installer
	autoUpdate bool
	beta       bool // follow pre-releases too
	stopLoop   context.CancelFunc
	lastEmit   time.Time
}

func newSubmoduleUpdateMng(app *application.App, logger *slog.Logger, version string, devMode bool,
) *submoduleUpdateMng {
	ctx, cancel := context.WithCancel(app.Context())
	m := &submoduleUpdateMng{
		logger:  logger.With("submodules", "update_mng"),
		app:     app,
		version: version,
		ctx:     ctx,
		cancel:  cancel,
		st:      models.UpdateStateOutput{State: stateIdle, CurrentVersion: version},
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.ResponseHeaderTimeout = checkTimeout
	cfg := github.Config{
		Repository:    repository,
		ChecksumAsset: checksumAsset,
		AssetMatcher:  matchInstaller,
		HTTPClient:    &http.Client{Transport: transport, CheckRedirect: checkRedirect},
	}
	// Config.Prerelease được cố định khi khởi tạo nên cần một provider riêng cho mỗi kênh.
	provider, err := github.New(cfg)
	if err == nil {
		cfg.Prerelease = true
		m.betaProv, err = github.New(cfg)
	}
	if err != nil {
		m.logger.Error("create github provider failed", "error", err)
	}
	m.provider = provider
	// Chế độ dev luôn bật để có thể kiểm tra luồng cập nhật; bộ cài sẽ được đặt vào thư mục exe dành cho dev.
	m.st.Supported = err == nil && version != "" && (devMode || installSupported())
	m.logger.Info("update module ready", "version", version, "supported", m.st.Supported)
	go m.cleanupDownloads()
	return m
}

// cleanupDownloads xóa bộ cài còn lại từ lần cập nhật trước khi ứng dụng khởi động lại. File đang bị khóa được giữ
// đến lần khởi động sau; lượt tải xuống mới bắt đầu trong lúc này không bị ảnh hưởng.
func (m *submoduleUpdateMng) cleanupDownloads() {
	select {
	case <-m.ctx.Done():
		return
	case <-time.After(cleanupDelay):
	}
	m.mu.Lock()
	defer m.mu.Unlock() // held so no download starts while the folder is removed
	if m.st.State == stateDownloading || m.st.State == stateReady {
		return
	}
	if err := os.RemoveAll(downloadDir()); err != nil {
		m.logger.Warn("remove old update files failed", "error", err)
	}
}

// downloadDir là thư mục tạm chứa bộ cài đã tải xuống.
func downloadDir() string {
	return filepath.Join(os.TempDir(), "S3Browser-update")
}

// snapshot trả về bản sao trạng thái hiện tại.
func (m *submoduleUpdateMng) snapshot() models.UpdateStateOutput {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.st
}

// emit gửi trạng thái đến frontend.
func (m *submoduleUpdateMng) emit(st models.UpdateStateOutput) {
	m.app.Event.Emit(EventStateChanged, st)
}

// update thay đổi trạng thái dưới khóa rồi gửi trạng thái mới.
func (m *submoduleUpdateMng) update(change func(st *models.UpdateStateOutput)) {
	m.mu.Lock()
	change(&m.st)
	st := m.st
	m.mu.Unlock()
	m.emit(st)
}

// fail đặt trạng thái thành error với mã tương ứng của err. Nếu kiểm tra thất bại, hàm cũng xóa thông tin bản phát hành cũ.
func (m *submoduleUpdateMng) fail(err *updateError, forgetRelease bool) {
	m.logger.Warn("update failed", "code", err.code, "error", err.err)
	m.mu.Lock()
	if forgetRelease {
		m.rel = nil
	}
	st := m.setErrorLocked(err)
	m.mu.Unlock()
	m.emit(st)
}

// setErrorLocked đặt trạng thái thành error (mu phải đang được giữ) rồi trả về trạng thái đó. version điền tham số của UPE006.
func (m *submoduleUpdateMng) setErrorLocked(err *updateError) models.UpdateStateOutput {
	m.st.State, m.st.ErrorCode = stateError, err.code
	if err.version != "" {
		m.st.Version = err.version
	}
	return m.st
}

// check tìm bản phát hành mới hơn. Nếu bật tự động cập nhật, bản mới sẽ bắt đầu được tải xuống.
func (m *submoduleUpdateMng) check(ctx context.Context) error {
	return m.runCheck(ctx, true)
}

// runCheck thực hiện check; nếu kênh thay đổi trong lúc lấy dữ liệu, kết quả cũ bị bỏ và, nếu retry được bật,
// hàm kiểm tra lại một lần theo kênh mới.
func (m *submoduleUpdateMng) runCheck(ctx context.Context, retry bool) error {
	m.mu.Lock()
	switch m.st.State {
	case stateChecking, stateDownloading, stateReady:
		m.mu.Unlock()
		return errBusy
	}
	if !m.st.Supported {
		m.mu.Unlock()
		return errBusy
	}
	prev, beta := m.st, m.beta
	m.st.State = stateChecking
	m.st.ErrorCode = ""
	checking := m.st
	m.mu.Unlock()
	m.emit(checking)

	rel, checkErr := m.fetchRelease(ctx, beta)
	canceled := checkErr != nil && errors.Is(ctx.Err(), context.Canceled)

	m.mu.Lock()
	if m.beta == beta && checkErr != nil && !canceled {
		m.mu.Unlock()
		m.fail(checkErr, true)
		return checkErr
	}
	if m.beta != beta {
		m.rel = nil
		m.st = models.UpdateStateOutput{Supported: true, State: stateIdle, CurrentVersion: m.version}
		idle := m.st
		m.mu.Unlock()
		m.emit(idle)
		if canceled {
			return checkErr
		}
		if retry {
			return m.runCheck(ctx, false)
		}
		return nil
	}
	if checkErr != nil {
		m.st = prev
		restored := m.st
		m.mu.Unlock()
		m.emit(restored)
		return checkErr
	}
	m.rel = rel
	if rel == nil {
		m.st = models.UpdateStateOutput{Supported: true, State: stateUpToDate, CurrentVersion: m.version}
	} else {
		m.st.State = stateAvailable
		m.st.Version = rel.Version
		m.st.ReleaseUrl = releaseURL(rel)
		m.st.Written, m.st.Total = 0, rel.Artifact.Size
	}
	st, auto := m.st, m.autoUpdate
	m.mu.Unlock()
	m.emit(st)

	if rel != nil && auto {
		if dlErr := m.startDownload(); dlErr != nil {
			m.logger.Warn("auto download failed", "error", dlErr)
		}
	}
	return nil
}

// fetchRelease yêu cầu GitHub cung cấp bản phát hành để cài; nil nghĩa là đã cập nhật mới nhất. Bật Beta: chỉ lấy bản
// thử nghiệm mới hơn. Tắt Beta: lấy bản ổn định mới hơn, hoặc bản ổn định mới nhất nếu bản đang chạy là thử nghiệm.
func (m *submoduleUpdateMng) fetchRelease(ctx context.Context, beta bool) (*updater.Release, *updateError) {
	ctx, cancel := context.WithTimeout(ctx, checkTimeout)
	defer cancel()
	provider, current := m.provider, m.version
	switch {
	case beta:
		provider = m.betaProv
	case strings.Contains(m.version, "-"):
		// Nếu tắt beta khi đang dùng bản thử nghiệm, quay về bản ổn định mới nhất, kể cả khi đó là bản cũ hơn.
		current = "0.0.0"
	}
	rel, err := provider.Check(ctx, updater.CheckRequest{
		CurrentVersion: current,
		Platform:       runtime.GOOS,
		Arch:           runtime.GOARCH,
	})
	switch {
	case err != nil:
		return nil, checkError(err)
	case rel == nil || rel.Version == m.version:
		return nil, nil
	case beta && rel.Channel != "prerelease":
		// Khi bật beta chỉ lấy bản thử nghiệm; bản ổn định mới hơn đứng đầu danh sách vẫn được xem là đã cập nhật.
		return nil, nil
	case rel.Artifact.Filename != installerName(rel.Version):
		return nil, &updateError{code: UPE006, version: rel.Version, err: errors.New("no installer for this machine")}
	}
	return rel, nil
}

// checkError ánh xạ lỗi provider sang mã thông báo.
func checkError(err error) *updateError {
	msg := err.Error()
	if found := noAssetRe.FindStringSubmatch(msg); found != nil {
		return &updateError{code: UPE006, version: strings.TrimPrefix(found[1], "v"), err: err}
	}
	if strings.Contains(msg, "checksum sidecar") {
		return &updateError{code: UPE004, err: err}
	}
	if strings.Contains(msg, "api 403") || strings.Contains(msg, "api 429") {
		return &updateError{code: UPE002, err: err}
	}
	return &updateError{code: UPE001, err: err}
}

// startDownload tải ngầm bản phát hành tìm được trong lần kiểm tra gần nhất. Hàm không làm gì trừ khi trạng thái là
// available hoặc error sau lần tải thất bại (thử lại). Bản phát hành không có checksum SHA-256 sẽ bị từ chối.
func (m *submoduleUpdateMng) startDownload() *updateError {
	m.mu.Lock()
	rel := m.rel
	if rel == nil || (m.st.State != stateAvailable && m.st.State != stateError) {
		m.mu.Unlock()
		return nil
	}
	// Kiểm tra hợp lệ và chuyển sang trạng thái downloading trong cùng một lần giữ khóa để không khởi chạy hai lượt tải cùng lúc.
	if err := validateRelease(rel); err != nil {
		m.logger.Warn("update failed", "code", err.code, "error", err.err)
		st := m.setErrorLocked(err)
		m.mu.Unlock()
		m.emit(st)
		return err
	}
	m.st.State, m.st.ErrorCode = stateDownloading, ""
	m.st.Written, m.st.Total = 0, rel.Artifact.Size
	st := m.st
	m.mu.Unlock()
	m.emit(st)
	go m.runDownload(rel)
	return nil
}

// validateRelease từ chối bản phát hành không có checksum SHA-256 hoặc có URL tải xuống không thuộc GitHub.
func validateRelease(rel *updater.Release) *updateError {
	if v := rel.Verification; v == nil || v.DigestAlgo != "sha256" || len(v.Digest) != sha256.Size {
		return &updateError{code: UPE004, err: errors.New("release has no sha256 checksum")}
	}
	if u, _ := rel.Metadata["github.asset.url"].(string); !allowedURL(u) {
		return &updateError{code: UPE003, err: fmt.Errorf("download url %q is not allowed", u)}
	}
	return nil
}

// runDownload tải và xác minh bộ cài, sau đó chuyển trạng thái thành ready hoặc error.
func (m *submoduleUpdateMng) runDownload(rel *updater.Release) {
	path, err := m.download(rel)
	if m.ctx.Err() != nil {
		return
	}
	if err != nil {
		m.fail(err, false)
		return
	}
	m.mu.Lock()
	m.installer = path
	m.mu.Unlock()
	m.update(func(st *models.UpdateStateOutput) { st.State = stateReady })
}

// download ghi bộ cài vào thư mục tạm đồng thời tính hash, rồi xóa file nếu SHA-256 không khớp.
func (m *submoduleUpdateMng) download(rel *updater.Release) (string, *updateError) {
	dir := downloadDir()
	_ = os.RemoveAll(dir) // an older installer is useless now
	path := filepath.Join(dir, filepath.Base(rel.Artifact.Filename))
	file, err := createFile(dir, path)
	if err != nil {
		return "", &updateError{code: UPE003, err: err}
	}
	hash := sha256.New()
	// HTTP client không giới hạn thời gian chờ body nên hủy lượt tải nếu bị treo hoặc chạy quá lâu.
	ctx, cancel := context.WithTimeout(m.ctx, downloadTimeout)
	defer cancel()
	idle := time.AfterFunc(downloadIdle, cancel)
	defer idle.Stop()
	err = m.provider.Download(ctx, rel, io.MultiWriter(file, hash), func(written, total int64) {
		idle.Reset(downloadIdle)
		m.onProgress(written, total)
	})
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		_ = os.Remove(path)
		return "", &updateError{code: UPE003, err: err}
	}
	if !bytes.Equal(hash.Sum(nil), rel.Verification.Digest) {
		_ = os.Remove(path)
		return "", &updateError{code: UPE004, err: errors.New("sha256 does not match")}
	}
	return path, nil
}

// onProgress ghi nhận số byte đã ghi và gửi trạng thái tối đa mỗi progressInterval.
func (m *submoduleUpdateMng) onProgress(written, total int64) {
	m.mu.Lock()
	m.st.Written = written
	if total > 0 {
		m.st.Total = total
	}
	send := time.Since(m.lastEmit) >= progressInterval
	if send {
		m.lastEmit = time.Now()
	}
	st := m.st
	m.mu.Unlock()
	if send {
		m.emit(st)
	}
}

// install kiểm tra lại checksum của bộ cài (vì chương trình khác có thể ghi vào thư mục tạm) rồi chạy bộ cài.
// Bên gọi thoát ứng dụng nếu hàm trả nil.
func (m *submoduleUpdateMng) install() *updateError {
	m.mu.Lock()
	ready, path, rel := m.st.State == stateReady, m.installer, m.rel
	m.mu.Unlock()
	if !ready || rel == nil {
		return &updateError{code: UPE005, err: errors.New("no installer is ready")}
	}

	sum, err := fileSum(path)
	if err != nil || !bytes.Equal(sum, rel.Verification.Digest) {
		_ = os.Remove(path)
		bad := &updateError{code: UPE004, err: errors.New("installer is missing or sha256 does not match")}
		m.fail(bad, false)
		return bad
	}
	dir, err := exeDir()
	if err == nil {
		err = launchInstaller(path, dir)
	}
	if err != nil {
		m.logger.Warn("run installer failed", "error", err)
		return &updateError{code: UPE005, err: err}
	}
	return nil
}

// setAutoUpdate bật hoặc tắt kiểm tra định kỳ. Khi bật, hàm cũng tải xuống bản phát hành đã tìm thấy; khi tắt,
// lượt tải đang chạy vẫn tiếp tục.
func (m *submoduleUpdateMng) setAutoUpdate(enabled bool) {
	m.mu.Lock()
	if !m.st.Supported || enabled == m.autoUpdate {
		m.mu.Unlock()
		return
	}
	m.autoUpdate = enabled
	if m.stopLoop != nil {
		m.stopLoop()
		m.stopLoop = nil
	}
	if !enabled {
		m.mu.Unlock()
		return
	}
	loopCtx, stop := context.WithCancel(m.ctx)
	m.stopLoop = stop
	available := m.st.State == stateAvailable
	m.mu.Unlock()

	if available {
		_ = m.startDownload()
	}
	go m.loop(loopCtx)
}

// setBeta chuyển giữa chỉ bản ổn định và cả bản ổn định lẫn thử nghiệm. Kết quả tìm trên kênh cũ bị xóa
// (trở về idle), trừ khi đang tải xuống hoặc bộ cài đã sẵn sàng.
func (m *submoduleUpdateMng) setBeta(enabled bool) {
	m.mu.Lock()
	if enabled == m.beta {
		m.mu.Unlock()
		return
	}
	m.beta = enabled
	if !m.st.Supported || m.st.State == stateChecking || m.st.State == stateDownloading || m.st.State == stateReady {
		m.mu.Unlock()
		return
	}
	m.rel = nil
	m.st = models.UpdateStateOutput{Supported: true, State: stateIdle, CurrentVersion: m.version}
	st := m.st
	m.mu.Unlock()
	m.emit(st)
}

// loop kiểm tra sau khi khởi chạy 10 giây, sau đó lặp lại mỗi checkInterval đến khi ctx kết thúc. Lỗi chỉ được ghi log.
func (m *submoduleUpdateMng) loop(ctx context.Context) {
	timer := time.NewTimer(firstCheckDelay)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			if err := m.check(ctx); err != nil && !errors.Is(err, errBusy) {
				m.logger.Warn("auto check failed", "error", err)
			}
			timer.Reset(checkInterval)
		}
	}
}

// close dừng kiểm tra định kỳ và lượt tải xuống.
func (m *submoduleUpdateMng) close() {
	m.cancel()
}

// installerName trả về tên asset bộ cài dành cho máy này trong bản phát hành.
func installerName(version string) string {
	return fmt.Sprintf("S3Browser-%s-windows-%s-installer.exe", version, runtime.GOARCH)
}

// matchInstaller chọn bộ cài dành cho máy này; phiên bản trong tên được kiểm tra sau khi tìm thấy.
func matchInstaller(_ updater.CheckRequest, assets []github.ReleaseAsset) int {
	suffix := fmt.Sprintf("-windows-%s-installer.exe", runtime.GOARCH)
	for i, a := range assets {
		if strings.HasPrefix(a.Name, "S3Browser-") && strings.HasSuffix(a.Name, suffix) {
			return i
		}
	}
	return -1
}

// allowedURL chỉ chấp nhận URL https trên máy chủ GitHub.
func allowedURL(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" {
		return false
	}
	host := strings.ToLower(u.Hostname())
	return host == "api.github.com" || host == "github.com" || strings.HasSuffix(host, ".githubusercontent.com")
}

// checkRedirect đảm bảo mọi bước chuyển hướng của yêu cầu đều nằm trên máy chủ GitHub.
func checkRedirect(req *http.Request, via []*http.Request) error {
	if len(via) >= maxRedirects {
		return errors.New("stopped after too many redirects")
	}
	if !allowedURL(req.URL.String()) {
		return fmt.Errorf("redirect to %s is not allowed", req.URL.Host)
	}
	return nil
}

// releaseURL trả về trang GitHub của bản phát hành hoặc "" nếu URL không thuộc GitHub.
func releaseURL(rel *updater.Release) string {
	if u, _ := rel.Metadata["github.release.htmlURL"].(string); allowedURL(u) {
		return u
	}
	return ""
}

// exeDir trả về thư mục của exe đang chạy sau khi phân giải symbolic link.
func exeDir() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	if exe, err = filepath.EvalSymlinks(exe); err != nil {
		return "", err
	}
	return filepath.Dir(exe), nil
}

// createFile tạo thư mục tạm và file mới bên trong. Trên Windows, các bit mode bị bỏ qua; quyền bảo vệ đến từ ACL
// theo người dùng của %TEMP%, còn bước kiểm tra sha256 trong install giúp phát hiện thay đổi từ chương trình khác.
func createFile(dir, path string) (*os.File, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	return os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
}

// fileSum trả về SHA-256 của file.
func fileSum(path string) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer func() { _ = file.Close() }() // read-only
	hash := sha256.New()
	if _, err = io.Copy(hash, file); err != nil {
		return nil, err
	}
	return hash.Sum(nil), nil
}
