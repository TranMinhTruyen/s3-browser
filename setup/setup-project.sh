#!/usr/bin/env bash

set -euo pipefail

# Project root = parent of the folder holding this script (setup/),
# so the script works no matter which directory you run it from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Minimum Go version required by go.mod.
GO_MIN_VERSION="1.27"
WAILS3_VERSION="${WAILS3_VERSION:-latest}"
SQLC_VERSION="${SQLC_VERSION:-latest}"
PACKAGE_MANAGER="${PACKAGE_MANAGER:-bun}"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
detect_os() {
  case "$(uname -s)" in
    Linux*)   echo "linux" ;;
    Darwin*)  echo "macos" ;;
    MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
    *)        echo "unknown" ;;
  esac
}

detect_linux_pkg_mgr() {
  if command -v apt-get >/dev/null 2>&1; then echo "apt"
  elif command -v dnf >/dev/null 2>&1; then echo "dnf"
  elif command -v pacman >/dev/null 2>&1; then echo "pacman"
  else echo "unknown"
  fi
}

# Compare two dotted versions: returns 0 if $1 >= $2.
version_ge() {
  [[ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" == "$2" ]]
}

require_go() {
  if ! command -v go >/dev/null 2>&1; then
    echo "ERROR: Go is not installed. Install Go $GO_MIN_VERSION+ first: https://go.dev/dl/"
    exit 1
  fi

  local current
  current="$(go env GOVERSION)"   # e.g. go1.27.0
  current="${current#go}"

  if ! version_ge "$current" "$GO_MIN_VERSION"; then
    echo "ERROR: Go $current found, but this project (go.mod) requires Go $GO_MIN_VERSION+."
    exit 1
  fi
}

# Make sure $GOBIN (or $GOPATH/bin) is on PATH for this session, so tools
# installed with `go install` are callable right away.
ensure_gobin_path() {
  local gobin
  gobin="$(go env GOBIN)"
  [[ -z "$gobin" ]] && gobin="$(go env GOPATH)/bin"

  if [[ ":$PATH:" != *":$gobin:"* ]]; then
    export PATH="$gobin:$PATH"
    echo "NOTE: added $gobin to PATH for this session."
    echo "      Add it permanently to your shell profile (.bashrc / .zshrc / PowerShell profile)."
  fi
}

# ---------------------------------------------------------------------------
# 1. Wails v3 CLI (wails3) - also provides the built-in Task runner
# ---------------------------------------------------------------------------
install_wails_cli() {
  require_go
  ensure_gobin_path

  if command -v wails3 >/dev/null 2>&1; then
    echo "==> wails3 CLI already installed: $(wails3 version 2>/dev/null || echo unknown)"
    return
  fi

  echo "==> Installing wails3 CLI ($WAILS3_VERSION)..."
  go install "github.com/wailsapp/wails/v3/cmd/wails3@$WAILS3_VERSION"
  ensure_gobin_path

  if ! command -v wails3 >/dev/null 2>&1; then
    echo "ERROR: wails3 was installed but is not on PATH. Check 'go env GOBIN'."
    exit 1
  fi
  echo "==> wails3 installed: $(wails3 version 2>/dev/null || echo unknown)"
}

# ---------------------------------------------------------------------------
# 2. sqlc CLI (generates internal/modules/*/sqlc from queries + schemas)
# ---------------------------------------------------------------------------
install_sqlc() {
  ensure_gobin_path

  if command -v sqlc >/dev/null 2>&1; then
    echo "==> sqlc already installed: $(sqlc version)"
    return
  fi

  echo "==> Installing sqlc ($SQLC_VERSION)..."
  # CGO-free build works on every OS without a C toolchain.
  CGO_ENABLED=0 go install "github.com/sqlc-dev/sqlc/cmd/sqlc@$SQLC_VERSION"
  ensure_gobin_path

  if ! command -v sqlc >/dev/null 2>&1; then
    echo "ERROR: sqlc was installed but is not on PATH. Check 'go env GOBIN'."
    exit 1
  fi
  echo "==> sqlc installed: $(sqlc version)"
}

# ---------------------------------------------------------------------------
# 3. bun (frontend package manager - see frontend/package.json packageManager)
# ---------------------------------------------------------------------------
install_bun() {
  [[ "$PACKAGE_MANAGER" != "bun" ]] && return 0

  if [[ -x "$HOME/.bun/bin/bun" ]] && ! command -v bun >/dev/null 2>&1; then
    export PATH="$HOME/.bun/bin:$PATH"
  fi

  if command -v bun >/dev/null 2>&1; then
    echo "==> bun already installed: $(bun --version)"
    return
  fi

  echo "==> bun not found, installing..."
  if [[ "$(detect_os)" == "windows" ]] && command -v powershell.exe >/dev/null 2>&1; then
    powershell.exe -NoProfile -Command "irm bun.sh/install.ps1 | iex"
    export PATH="${USERPROFILE:-$HOME}/.bun/bin:$HOME/.bun/bin:$PATH"
  else
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
  fi

  if ! command -v bun >/dev/null 2>&1; then
    echo "ERROR: bun installed but not on PATH. Open a new shell and re-run this script."
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# 4. Webview runtime dependency per OS
# ---------------------------------------------------------------------------
install_webview_windows() {
  # WebView2 Runtime ships pre-installed on modern Win10/11, but check anyway.
  local client_id="{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
  local reg_path="HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\$client_id"
  local installed="0"

  if command -v powershell.exe >/dev/null 2>&1; then
    if powershell.exe -NoProfile -Command \
      "if (Test-Path '$reg_path') { exit 0 } else { exit 1 }" >/dev/null 2>&1; then
      installed="1"
    fi
  fi

  if [[ "$installed" == "1" ]]; then
    echo "==> WebView2 Runtime already installed."
    return
  fi

  echo "==> WebView2 Runtime not found. Downloading bootstrapper..."
  local installer="${TEMP:-/tmp}/MicrosoftEdgeWebview2Setup.exe"
  curl -fsSL "https://go.microsoft.com/fwlink/p/?LinkId=2124703" -o "$installer"
  echo "==> Installing WebView2 Runtime (silent)..."
  if command -v cmd.exe >/dev/null 2>&1; then
    cmd.exe /c "$(wslpath -w "$installer" 2>/dev/null || echo "$installer")" /silent /install
  else
    "$installer" /silent /install
  fi
}

install_webview_linux() {
  # Wails v3 targets GTK3 + WebKitGTK 4.1 (4.0 only on older distros).
  local pkg_mgr
  pkg_mgr="$(detect_linux_pkg_mgr)"

  case "$pkg_mgr" in
    apt)
      if dpkg -s libwebkit2gtk-4.1-dev >/dev/null 2>&1 || dpkg -s libwebkit2gtk-4.0-dev >/dev/null 2>&1; then
        echo "==> libwebkit2gtk already installed."
      else
        echo "==> Installing webkit2gtk + build deps (apt, needs sudo)..."
        sudo apt-get update
        sudo apt-get install -y build-essential pkg-config libgtk-3-dev
        sudo apt-get install -y libwebkit2gtk-4.1-dev \
          || sudo apt-get install -y libwebkit2gtk-4.0-dev
      fi
      ;;
    dnf)
      if rpm -q webkit2gtk4.1-devel >/dev/null 2>&1 || rpm -q webkit2gtk3-devel >/dev/null 2>&1; then
        echo "==> webkit2gtk devel package already installed."
      else
        echo "==> Installing webkit2gtk + build deps (dnf, needs sudo)..."
        sudo dnf install -y gcc gtk3-devel pkgconf-pkg-config
        sudo dnf install -y webkit2gtk4.1-devel || sudo dnf install -y webkit2gtk3-devel
      fi
      ;;
    pacman)
      if pacman -Qi webkit2gtk-4.1 >/dev/null 2>&1 || pacman -Qi webkit2gtk >/dev/null 2>&1; then
        echo "==> webkit2gtk already installed."
      else
        echo "==> Installing webkit2gtk + build deps (pacman, needs sudo)..."
        sudo pacman -S --noconfirm base-devel gtk3 pkgconf
        sudo pacman -S --noconfirm webkit2gtk-4.1 || sudo pacman -S --noconfirm webkit2gtk
      fi
      ;;
    *)
      echo "WARNING: unknown Linux package manager. Please install gtk3 + webkit2gtk-4.1 manually."
      ;;
  esac
}

install_webview() {
  case "$(detect_os)" in
    windows) install_webview_windows ;;
    linux)   install_webview_linux ;;
    macos)   echo "==> macOS uses built-in WKWebView, nothing to install." ;;
    *)       echo "WARNING: unknown OS, skipping webview install." ;;
  esac
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
echo "==> Project root: $PROJECT_ROOT"
echo "==> Detected OS: $(detect_os)"

install_wails_cli
install_sqlc
install_bun
install_webview

cd "$PROJECT_ROOT"

echo
echo "==> Running 'wails3 doctor' to verify environment..."
wails3 doctor || true

echo
echo "==> Downloading Go modules..."
go mod download

echo
echo "==> Tidying modules..."
go mod tidy

echo
echo "==> Generating sqlc queries (sqlc.yaml)..."
sqlc generate

echo
echo "==> Installing frontend dependencies ($PACKAGE_MANAGER)..."
wails3 task common:install:frontend:deps PACKAGE_MANAGER="$PACKAGE_MANAGER"

echo
echo "==> Generating TypeScript IPC bindings..."
wails3 generate bindings -clean=true -ts

echo
echo "==> Building the application (frontend + Go binary)..."
# `wails3 task build` re-runs the frontend build and binding generation as deps.
wails3 task build PACKAGE_MANAGER="$PACKAGE_MANAGER"

echo
echo "==> Setup complete."
echo "    Dev mode : wails3 task dev"
echo "    Build    : wails3 task build"
echo "    Package  : wails3 task package   (add INSTALL_SCOPE=user for non-admin)"
