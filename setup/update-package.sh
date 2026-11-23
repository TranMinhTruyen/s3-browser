#!/usr/bin/env bash

set -euo pipefail

# Project root = parent of the folder holding this script (setup/),
# so the script works no matter which directory you run it from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

PACKAGE_MANAGER="${PACKAGE_MANAGER:-bun}"

cd "$PROJECT_ROOT"

echo "==> Project root: $PROJECT_ROOT"

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

# Rust native library (rust/).
# `cargo update` only moves Cargo.lock within the semver ranges of Cargo.toml,
# so pinned crates (e.g. libsqlite3-sys matching sqlx) stay compatible.
# Newer incompatible versions are only reported ("available: ..."): bump them
# in Cargo.toml by hand, since they may need code changes.
if [ -f "$PROJECT_ROOT/rust/Cargo.toml" ]; then
  # rustup installs cargo here, but it is not always on PATH (e.g. Git Bash).
  export PATH="$HOME/.cargo/bin:$PATH"
  if ! command -v cargo >/dev/null 2>&1; then
    echo "ERROR: cargo not found. Install Rust first: https://rustup.rs"
    exit 1
  fi

  echo
  echo "==> Checking outdated Rust crates..."
  (cd "$PROJECT_ROOT/rust" && cargo update --dry-run --verbose 2>&1 | grep -E 'Updating|Adding|Removing|available' || true)

  echo
  echo "==> Updating Rust dependencies..."
  (cd "$PROJECT_ROOT/rust" && cargo update)
fi

echo
echo "==> Update react dependencies..."
cd "$PROJECT_ROOT/frontend"
if ! command -v "$PACKAGE_MANAGER" >/dev/null 2>&1; then
  echo "ERROR: $PACKAGE_MANAGER not found. Install it first: https://bun.sh"
  exit 1
fi

case "$PACKAGE_MANAGER" in
  bun)  bun update --latest ;;
  pnpm) pnpm update --latest ;;
  yarn) yarn upgrade --latest ;;
  npm)  npm update ;;
  *)    echo "ERROR: unsupported package manager '$PACKAGE_MANAGER'."; exit 1 ;;
esac

cd "$PROJECT_ROOT"

echo
echo "==> Regenerating TypeScript IPC bindings..."
# The Wails runtime version moves with go.mod, so bindings must be regenerated.
# -tags=wailsgen is required: without it result models in models/db become `any`.
go tool wails3 generate bindings -f "-tags=wailsgen" -clean=true -ts

echo
echo "==> All packages updated. Run 'go tool wails3 task build' to verify the build."
