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

// Values of UpdateStateOutput.State.
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
)

// errBusy means a check, a download or a ready installer is in the way (or the feature is off), so nothing was done.
var errBusy = errors.New("update is busy")

// noAssetRe matches the provider error of a release without an installer for this machine.
var noAssetRe = regexp.MustCompile(`release (\S+) has no asset for`)

// updateError is a failure with the message code to show; version fills the {version} param.
type updateError struct {
	code    string
	version string
	err     error
}

func (e *updateError) Error() string { return e.err.Error() }
func (e *updateError) Unwrap() error { return e.err }

// submoduleUpdateMng owns the update state. Every state change goes through mu, and only one check or
// download runs at a time.
type submoduleUpdateMng struct {
	logger   *slog.Logger
	app      *application.App
	version  string
	provider *github.Provider
	ctx      context.Context // ends on close or app shutdown, stops the download and the periodic check
	cancel   context.CancelFunc

	mu         sync.Mutex
	st         models.UpdateStateOutput
	rel        *updater.Release // release found by the last check
	installer  string           // downloaded and verified installer
	autoUpdate bool
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
	provider, err := github.New(github.Config{
		Repository: repository,
		// A pre-release build also follows pre-releases, a stable build only follows stable releases.
		Prerelease:    strings.Contains(version, "-"),
		ChecksumAsset: checksumAsset,
		AssetMatcher:  matchInstaller,
		HTTPClient:    &http.Client{Transport: transport, CheckRedirect: checkRedirect},
	})
	if err != nil {
		m.logger.Error("create github provider failed", "error", err)
	}
	m.provider = provider
	m.st.Supported = err == nil && version != "" && !devMode && installSupported()
	m.logger.Info("update module ready", "version", version, "supported", m.st.Supported)
	return m
}

// snapshot returns a copy of the current state.
func (m *submoduleUpdateMng) snapshot() models.UpdateStateOutput {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.st
}

// emit sends the state to the frontend.
func (m *submoduleUpdateMng) emit(st models.UpdateStateOutput) {
	m.app.Event.Emit(EventStateChanged, st)
}

// update changes the state under the lock, then sends the new state.
func (m *submoduleUpdateMng) update(change func(st *models.UpdateStateOutput)) {
	m.mu.Lock()
	change(&m.st)
	st := m.st
	m.mu.Unlock()
	m.emit(st)
}

// fail puts the state in error with the code of err. A failed check also forgets the old release.
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

// setErrorLocked puts the state in error (mu must be held) and returns it. The version fills UPE006's param.
func (m *submoduleUpdateMng) setErrorLocked(err *updateError) models.UpdateStateOutput {
	m.st.State, m.st.ErrorCode = stateError, err.code
	if err.version != "" {
		m.st.Version = err.version
	}
	return m.st
}

// check looks for a newer release. With auto update on, a new release starts downloading.
func (m *submoduleUpdateMng) check(ctx context.Context) error {
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
	prev := m.st
	m.st.State = stateChecking
	m.st.ErrorCode = ""
	checking := m.st
	m.mu.Unlock()
	m.emit(checking)

	rel, checkErr := m.fetchRelease(ctx)
	if checkErr != nil {
		if errors.Is(ctx.Err(), context.Canceled) {
			m.update(func(st *models.UpdateStateOutput) { *st = prev })
			return checkErr
		}
		m.fail(checkErr, true)
		return checkErr
	}

	m.mu.Lock()
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

// fetchRelease asks GitHub for a release newer than the running version; nil means up to date.
func (m *submoduleUpdateMng) fetchRelease(ctx context.Context) (*updater.Release, *updateError) {
	ctx, cancel := context.WithTimeout(ctx, checkTimeout)
	defer cancel()
	rel, err := m.provider.Check(ctx, updater.CheckRequest{
		CurrentVersion: m.version,
		Platform:       runtime.GOOS,
		Arch:           runtime.GOARCH,
	})
	switch {
	case err != nil:
		return nil, checkError(err)
	case rel != nil && rel.Artifact.Filename != installerName(rel.Version):
		return nil, &updateError{code: UPE006, version: rel.Version, err: errors.New("no installer for this machine")}
	}
	return rel, nil
}

// checkError maps a provider failure to its message code.
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

// startDownload downloads the release found by the last check in the background. It does nothing unless the
// state is available, or error after a failed download (retry). A release without a SHA-256 checksum is refused.
func (m *submoduleUpdateMng) startDownload() *updateError {
	m.mu.Lock()
	rel := m.rel
	if rel == nil || (m.st.State != stateAvailable && m.st.State != stateError) {
		m.mu.Unlock()
		return nil
	}
	// Validate and switch to downloading in one lock hold, so two downloads never start together.
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

// validateRelease refuses a release without a SHA-256 checksum or with a download URL outside GitHub.
func validateRelease(rel *updater.Release) *updateError {
	if v := rel.Verification; v == nil || v.DigestAlgo != "sha256" || len(v.Digest) != sha256.Size {
		return &updateError{code: UPE004, err: errors.New("release has no sha256 checksum")}
	}
	if u, _ := rel.Metadata["github.asset.url"].(string); !allowedURL(u) {
		return &updateError{code: UPE003, err: fmt.Errorf("download url %q is not allowed", u)}
	}
	return nil
}

// runDownload downloads and verifies the installer, then moves the state to ready or error.
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

// download writes the installer to the temp dir while hashing it, and deletes it unless the SHA-256 matches.
func (m *submoduleUpdateMng) download(rel *updater.Release) (string, *updateError) {
	dir := filepath.Join(os.TempDir(), "S3Browser-update")
	_ = os.RemoveAll(dir) // an older installer is useless now
	path := filepath.Join(dir, filepath.Base(rel.Artifact.Filename))
	file, err := createFile(dir, path)
	if err != nil {
		return "", &updateError{code: UPE003, err: err}
	}
	hash := sha256.New()
	// The HTTP client has no body timeout, so cancel the download when it stalls or runs too long.
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

// onProgress records the bytes written and sends the state at most every progressInterval.
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

// install checks the installer against the checksum again (the temp dir is writable by other programs) and
// runs it. The caller quits the app when it returns nil.
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

// setAutoUpdate starts or stops the periodic check. Turning it on also downloads a release that is already
// found; turning it off leaves a running download alone.
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

// loop checks 10 seconds after it starts, then every checkInterval, until ctx ends. Failures are only logged.
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

// close stops the periodic check and the download.
func (m *submoduleUpdateMng) close() {
	m.cancel()
}

// installerName is the release asset of the installer for this machine.
func installerName(version string) string {
	return fmt.Sprintf("S3Browser-%s-windows-%s-installer.exe", version, runtime.GOARCH)
}

// matchInstaller picks the installer for this machine; the version in the name is checked after the match.
func matchInstaller(_ updater.CheckRequest, assets []github.ReleaseAsset) int {
	suffix := fmt.Sprintf("-windows-%s-installer.exe", runtime.GOARCH)
	for i, a := range assets {
		if strings.HasPrefix(a.Name, "S3Browser-") && strings.HasSuffix(a.Name, suffix) {
			return i
		}
	}
	return -1
}

// allowedURL accepts only https URLs on GitHub hosts.
func allowedURL(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" {
		return false
	}
	host := strings.ToLower(u.Hostname())
	return host == "api.github.com" || host == "github.com" || strings.HasSuffix(host, ".githubusercontent.com")
}

// checkRedirect keeps every hop of a request on GitHub hosts.
func checkRedirect(req *http.Request, via []*http.Request) error {
	if len(via) >= maxRedirects {
		return errors.New("stopped after too many redirects")
	}
	if !allowedURL(req.URL.String()) {
		return fmt.Errorf("redirect to %s is not allowed", req.URL.Host)
	}
	return nil
}

// releaseURL is the GitHub page of the release, or "" when the URL is not a GitHub one.
func releaseURL(rel *updater.Release) string {
	if u, _ := rel.Metadata["github.release.htmlURL"].(string); allowedURL(u) {
		return u
	}
	return ""
}

// exeDir is the folder of the running exe, with symlinks resolved.
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

// createFile makes the temp dir and a new file in it. On Windows the mode bits are ignored; the protection comes
// from the per-user ACL of %TEMP%, and the later sha256 check in install covers other programs.
func createFile(dir, path string) (*os.File, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	return os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
}

// fileSum returns the SHA-256 of a file.
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
