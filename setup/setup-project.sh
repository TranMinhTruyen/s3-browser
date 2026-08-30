#!/usr/bin/env bash

set -euo pipefail

# Project root = parent of the folder holding this script (setup/),
# so the script works no matter which directory you run it from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

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

require_go() {
  if ! command -v go >/dev/null 2>&1; then
    echo "ERROR: Go is not installed. Install Go first: https://go.dev/dl/"
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
# 1. Install Wails CLI (needs Go already installed)
# ---------------------------------------------------------------------------
install_wails_cli() {
  if command -v wails >/dev/null 2>&1; then
    echo "==> Wails CLI already installed: $(wails version)"
    return
  fi

  require_go

  echo "==> Installing Wails CLI..."
  go install github.com/wailsapp/wails/v2/cmd/wails@latest
  ensure_gobin_path
}

# ---------------------------------------------------------------------------
# 2. Install sqlc CLI (needs Go already installed)
# ---------------------------------------------------------------------------
SQLC_VERSION="${SQLC_VERSION:-latest}"

install_sqlc() {
  # Pull GOBIN onto PATH first: sqlc may already be installed from an earlier
  # run but invisible in a fresh shell.
  if command -v go >/dev/null 2>&1; then
    ensure_gobin_path
  fi

  if command -v sqlc >/dev/null 2>&1; then
    echo "==> sqlc already installed: $(sqlc version)"
    return
  fi

  require_go

  echo "==> Installing sqlc ($SQLC_VERSION)..."
  # CGO-free build works on every OS without a C toolchain.
  CGO_ENABLED=0 go install "github.com/sqlc-dev/sqlc/cmd/sqlc@$SQLC_VERSION"
  ensure_gobin_path

  if command -v sqlc >/dev/null 2>&1; then
    echo "==> sqlc installed: $(sqlc version)"
  else
    echo "ERROR: sqlc was installed but is not on PATH. Check 'go env GOBIN'."
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# 3. Install webview runtime dependency per OS
# ---------------------------------------------------------------------------
install_webview_windows() {
  # WebView2 Runtime ships pre-installed on modern Win10/11, but check anyway.
  local reg_path="HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
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
  local installer="/tmp/MicrosoftEdgeWebview2Setup.exe"
  curl -fsSL "https://go.microsoft.com/fwlink/p/?LinkId=2124703" -o "$installer"
  echo "==> Installing WebView2 Runtime (silent)..."
  # Runs a Windows exe; needs to be executed via cmd/powershell if under WSL/MSYS
  if command -v cmd.exe >/dev/null 2>&1; then
    cmd.exe /c "$(wslpath -w "$installer" 2>/dev/null || echo "$installer")" /silent /install
  else
    "$installer" /silent /install
  fi
}

install_webview_linux() {
  local pkg_mgr
  pkg_mgr="$(detect_linux_pkg_mgr)"

  case "$pkg_mgr" in
    apt)
      if dpkg -s libwebkit2gtk-4.0-dev >/dev/null 2>&1; then
        echo "==> libwebkit2gtk already installed."
      else
        echo "==> Installing webkit2gtk + build deps (apt, needs sudo)..."
        sudo apt-get update
        sudo apt-get install -y build-essential libgtk-3-dev libwebkit2gtk-4.0-dev pkg-config
      fi
      ;;
    dnf)
      if rpm -q webkit2gtk3-devel >/dev/null 2>&1; then
        echo "==> webkit2gtk3-devel already installed."
      else
        echo "==> Installing webkit2gtk + build deps (dnf, needs sudo)..."
        sudo dnf install -y gtk3-devel webkit2gtk3-devel pkgconf-pkg-config
      fi
      ;;
    pacman)
      if pacman -Qi webkit2gtk >/dev/null 2>&1; then
        echo "==> webkit2gtk already installed."
      else
        echo "==> Installing webkit2gtk + build deps (pacman, needs sudo)..."
        sudo pacman -S --noconfirm gtk3 webkit2gtk pkgconf
      fi
      ;;
    *)
      echo "WARNING: unknown Linux package manager. Please install libwebkit2gtk manually."
      ;;
  esac
}

install_webview() {
  local os
  os="$(detect_os)"
  case "$os" in
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
install_webview

cd "$PROJECT_ROOT"

echo
echo "==> Running 'wails doctor' to verify environment..."
wails doctor || true

echo
echo "==> Checking outdated Go modules..."
go list -u -m all || true

echo
echo "==> Updating dependencies..."
go get -u -t ./...

echo
echo "==> Tidying modules..."
go mod tidy

echo
echo "==> Update complete. Please review go.mod/go.sum manually."

echo
echo "==> Build runtime env"
wails build

echo
echo "==> Build runtime env complete"

echo
echo "==> Install and build react dependencies..."
cd "$PROJECT_ROOT/frontend"
if ! command -v bun >/dev/null 2>&1; then
  echo "==> bun not found, installing..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi
bun install
bun run build

echo
echo "==> Setup complete"
