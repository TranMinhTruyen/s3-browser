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
# Set to 0 to skip the knowledge graph (graphify-out/), the Docker test containers (test-env/)
# or the Playwright E2E setup (browser + server-mode build used by `bun run e2e`).
SETUP_GRAPHIFY="${SETUP_GRAPHIFY:-1}"
SETUP_TEST_ENV="${SETUP_TEST_ENV:-1}"
SETUP_E2E="${SETUP_E2E:-1}"

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

# Install a package with winget (Windows). Extra args are passed through.
winget_install() {
  local id="$1"; shift
  if ! command -v winget >/dev/null 2>&1; then
    echo "ERROR: winget not found, cannot install $id. Install 'App Installer' from the Microsoft Store."
    exit 1
  fi
  echo "==> Installing $id (winget)..."
  winget install --id "$id" -e --accept-source-agreements --accept-package-agreements "$@"
}

require_go() {
  # Default install folder of the Go MSI; not on PATH of this shell right after install.
  [[ "$(detect_os)" == "windows" ]] && export PATH="/c/Program Files/Go/bin:$PATH"

  if ! command -v go >/dev/null 2>&1; then
    if [[ "$(detect_os)" != "windows" ]]; then
      echo "ERROR: Go is not installed. Install Go $GO_MIN_VERSION+ first: https://go.dev/dl/"
      exit 1
    fi
    winget_install GoLang.Go
  fi

  local current
  current="$(go env GOVERSION)"   # e.g. go1.27.0
  current="${current#go}"

  if ! version_ge "$current" "$GO_MIN_VERSION" && [[ "$(detect_os)" == "windows" ]]; then
    echo "==> Go $current is older than $GO_MIN_VERSION, upgrading..."
    winget upgrade --id GoLang.Go -e --accept-source-agreements --accept-package-agreements || true
    current="$(go env GOVERSION)"; current="${current#go}"
  fi

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
# 5. Rust toolchain for the native DB library (rust/ -> s3b_db.dll, Windows only)
# ---------------------------------------------------------------------------
# The MSVC target links with link.exe from the VS Build Tools (C++ workload).
has_msvc_build_tools() {
  local vswhere="/c/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe"
  [[ -x "$vswhere" ]] && [[ -n "$("$vswhere" -latest -products '*' \
    -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>/dev/null)" ]]
}

install_msvc_build_tools() {
  if has_msvc_build_tools; then
    echo "==> MSVC C++ build tools already installed."
    return
  fi

  # C++ workload = MSVC compiler/linker + Windows SDK. Takes a while; UAC prompt asks for admin.
  winget_install Microsoft.VisualStudio.BuildTools \
    --override "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"

  if ! has_msvc_build_tools; then
    echo "ERROR: MSVC C++ build tools still not found. Install 'Visual Studio Build Tools'"
    echo "       with the 'Desktop development with C++' workload, then re-run this script."
    exit 1
  fi
  echo "==> MSVC C++ build tools installed."
}

setup_rust() {
  if [[ "$(detect_os)" != "windows" ]]; then
    echo "==> Skipping Rust: s3b_db.dll is only built for Windows (x86_64-pc-windows-msvc)."
    return 0
  fi

  install_msvc_build_tools

  # rustup installs cargo here, but it is not always on PATH (e.g. Git Bash).
  export PATH="$HOME/.cargo/bin:$PATH"
  if ! command -v rustup >/dev/null 2>&1; then
    echo "==> rustup not found, installing..."
    if command -v winget >/dev/null 2>&1; then
      winget_install Rustlang.Rustup
    else
      local installer="${TMPDIR:-/tmp}/rustup-init.exe"
      curl -fsSL "https://win.rustup.rs/x86_64" -o "$installer"
      "$installer" -y --default-toolchain none
    fi
  fi

  if ! command -v rustup >/dev/null 2>&1; then
    echo "ERROR: rustup installed but not on PATH. Open a new shell and re-run this script."
    exit 1
  fi

  # Installs the channel + target pinned in rust/rust-toolchain.toml, then downloads crates (Cargo.lock).
  echo "==> Installing Rust toolchain from rust/rust-toolchain.toml..."
  (cd "$PROJECT_ROOT/rust" && rustup toolchain install && cargo --version && cargo fetch)
}

# ---------------------------------------------------------------------------
# 6. graphify knowledge graph (graphify-out/, AST only, no LLM / API cost)
# ---------------------------------------------------------------------------
setup_graphify() {
  if ! command -v graphify >/dev/null 2>&1; then
    echo "==> graphify not found, installing (Python package graphifyy)..."
    # Windows: prefer uv (installed via winget, brings its own Python). A bare "python"
    # there may be the Microsoft Store stub, which fails instead of installing.
    if [[ "$(detect_os)" == "windows" ]] && ! command -v uv >/dev/null 2>&1 && command -v winget >/dev/null 2>&1; then
      winget_install astral-sh.uv
      export PATH="$HOME/AppData/Local/Microsoft/WinGet/Links:$PATH"
    fi
    # uv tool / pipx put the graphify command here.
    export PATH="$HOME/.local/bin:$PATH"

    if command -v uv >/dev/null 2>&1; then
      uv tool install graphifyy
    elif command -v pipx >/dev/null 2>&1; then
      pipx install graphifyy
    elif command -v python3 >/dev/null 2>&1 || command -v python >/dev/null 2>&1; then
      "$(command -v python3 || command -v python)" -m pip install --user graphifyy
    else
      echo "WARNING: Python not found, skipping graphify. Install Python 3 and run: pip install graphifyy"
      return 0
    fi
  fi

  if ! command -v graphify >/dev/null 2>&1; then
    echo "WARNING: graphify installed but not on PATH (check the Python user Scripts/bin dir). Skipping."
    return 0
  fi

  echo "==> Building knowledge graph into graphify-out/..."
  graphify update "$PROJECT_ROOT"
}

# ---------------------------------------------------------------------------
# 7. Docker test containers (see test-env/README.txt)
# ---------------------------------------------------------------------------
# Docker Desktop on Windows (winget); other OS: install Docker yourself. Starts the engine and waits for it.
ensure_docker() {
  if [[ "$(detect_os)" == "windows" ]]; then
    export PATH="/c/Program Files/Docker/Docker/resources/bin:$PATH"
    if ! command -v docker >/dev/null 2>&1; then
      # Needs WSL2; Windows may ask for a restart before the engine can run.
      winget_install Docker.DockerDesktop || return 1
    fi
    if ! docker info >/dev/null 2>&1; then
      local desktop="/c/Program Files/Docker/Docker/Docker Desktop.exe" i
      [[ -x "$desktop" ]] && { echo "==> Starting Docker Desktop..."; "$desktop" >/dev/null 2>&1 & }
      echo "    waiting for the Docker engine (up to 3 minutes)..."
      for i in $(seq 1 60); do
        docker info >/dev/null 2>&1 && break
        sleep 3
      done
    fi
  fi
  command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1
}

# Wait until a one-shot init container exits; fail if it exits non-zero.
wait_init() {
  local name="$1" code
  echo "    waiting for $name..."
  code="$(docker wait "$name")"
  if [[ "$code" != "0" ]]; then
    echo "WARNING: $name exited with code $code. Check: docker logs $name"
    return 1
  fi
}

setup_test_env() {
  local env_dir="$PROJECT_ROOT/test-env"

  if ! ensure_docker; then
    echo "WARNING: Docker is not installed or not running, skipping test-env."
    echo "         Start Docker Desktop and re-run with SETUP_TEST_ENV=1, or follow test-env/README.txt."
    return 0
  fi

  cd "$env_dir"

  # One command for every S3 server and database: certificates if missing (needs openssl), then
  # `docker compose up -d --wait`. Without openssl only the stacks that do not mount certs/ are started.
  if [[ -f certs/ca.pem ]] || command -v openssl >/dev/null 2>&1; then
    echo "==> Starting the test environment (S3 servers + databases, the first pull takes a few minutes)..."
    sh scripts/test-env.sh up || echo "WARNING: some test containers did not start, see: docker compose ps -a"
  else
    echo "==> Starting MinIO + LDAP and Floci (openssl not found, no certificates: skipping Keycloak/MinIO TLS and the databases)..."
    docker compose up -d minio-init floci-init
    wait_init s3b-test-minio-init || true
    wait_init s3b-test-floci-init || true
  fi

  cd "$PROJECT_ROOT"
  echo "==> Test containers are up. Profiles to create in the app: test-env/test-profiles.txt"
  echo "    Floci keys: test-env/generated/floci-config, floci-credentials (copy to ~/.aws, see README)."
}

# ---------------------------------------------------------------------------
# 8. Playwright E2E (frontend/e2e, see README "End-to-end tests")
# ---------------------------------------------------------------------------
setup_e2e() {
  if [[ "$(detect_os)" != "windows" ]]; then
    echo "==> Skipping E2E: the server-mode build needs s3b_db.dll (Windows only)."
    return 0
  fi
  # Node runs the docs scripts that test-env/mem-bench.ps1 calls (node scripts/mem-ui.mjs).
  export PATH="/c/Program Files/nodejs:$PATH"
  if ! command -v node >/dev/null 2>&1; then
    # winget_install exits the script when winget is missing, so check first: Node is optional here.
    if command -v winget >/dev/null 2>&1; then
      winget_install OpenJS.NodeJS.LTS || echo "WARNING: Node.js install failed (needed by mem-bench)."
    else
      echo "WARNING: Node.js not found and no winget: install Node.js LTS for mem-bench."
    fi
  fi
  # One Chromium for frontend/ and docs/ (same Playwright version): e2e, qa evidence, shots.mjs, mem-bench.
  echo "==> Installing Chromium for Playwright..."
  (cd "$PROJECT_ROOT/frontend" && node_modules/.bin/playwright install chromium)
  echo "==> Building the server-mode app for E2E (bun run e2e:build)..."
  (cd "$PROJECT_ROOT/frontend" && bun run e2e:build)
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
setup_rust

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
echo "==> Installing docs dependencies (user guide PDF, screenshots, evidence/architecture Excel)..."
(cd docs && bun install)

echo
echo "==> Generating TypeScript IPC bindings..."
# -tags=wailsgen is required: without it result models in models/db become `any`.
wails3 generate bindings -f "-tags=wailsgen" -clean=true -ts

echo
echo "==> Building the application (frontend + Go binary)..."
# `wails3 task build` re-runs the frontend build and binding generation as deps.
wails3 task build PACKAGE_MANAGER="$PACKAGE_MANAGER"

if [[ "$SETUP_GRAPHIFY" == "1" ]]; then
  echo
  setup_graphify
fi

if [[ "$SETUP_E2E" == "1" ]]; then
  echo
  setup_e2e || echo "WARNING: E2E setup did not finish. Later: cd frontend && bun run e2e:build"
fi

if [[ "$SETUP_TEST_ENV" == "1" ]]; then
  echo
  # A failing stack (e.g. port already in use) must not fail the whole setup.
  setup_test_env || echo "WARNING: test-env setup did not finish, see test-env/README.txt."
fi

echo
echo "==> Setup complete."
echo "    Dev mode : wails3 task dev"
echo "    Build    : wails3 task build"
echo "    Package  : wails3 task package   (add INSTALL_SCOPE=user for non-admin)"
echo "    Unit test: cd frontend && bun run test   |   cd rust && cargo test --target x86_64-pc-windows-msvc"
echo "    E2E test : cd frontend && bun run e2e    (S3 specs need E2E_S3_ENDPOINT, E2E_S3_ACCESS_KEY, E2E_S3_SECRET_KEY)"
echo "    Test env : cd test-env && sh scripts/test-env.sh up   |   docker compose stop   (test-env/README.txt)"
echo "    RAM bench: powershell -ExecutionPolicy Bypass -File test-env/mem-bench-all.ps1 -Runs 3   (~5 hours, idle machine)"
