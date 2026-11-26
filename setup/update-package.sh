#!/usr/bin/env bash

set -euo pipefail

# Thư mục gốc dự án là thư mục cha của nơi chứa script này (setup/),
# nhờ đó có thể chạy script từ bất kỳ thư mục nào.
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

# Thư viện native Rust (rust/).
# `cargo update` chỉ cập nhật Cargo.lock trong phạm vi phiên bản semver của Cargo.toml,
# nhờ đó các crate đã ghim phiên bản (ví dụ libsqlite3-sys tương thích với sqlx) vẫn tương thích.
# Các phiên bản mới hơn nhưng không tương thích chỉ được báo ("available: ..."): tự tăng phiên bản
# trong Cargo.toml vì có thể cần thay đổi code.
if [ -f "$PROJECT_ROOT/rust/Cargo.toml" ]; then
  # rustup cài cargo tại đây nhưng đường dẫn này không phải lúc nào cũng có trong PATH (ví dụ Git Bash).
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
# Phiên bản runtime Wails thay đổi cùng go.mod nên cần sinh lại bindings.
# Bắt buộc dùng -tags=wailsgen: nếu không, các model kết quả trong models/db sẽ thành `any`.
go tool wails3 generate bindings -f "-tags=wailsgen" -clean=true -ts

echo
echo "==> All packages updated. Run 'go tool wails3 task build' to verify the build."
