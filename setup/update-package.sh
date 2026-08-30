#!/usr/bin/env bash

set -euo pipefail

# Project root = parent of the folder holding this script (setup/),
# so the script works no matter which directory you run it from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

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

echo
echo "==> Update react dependencies..."
cd "$PROJECT_ROOT/frontend"
if ! command -v bun >/dev/null 2>&1; then
  echo "ERROR: bun not found. Install it first: https://bun.sh"
  exit 1
fi
bun update --latest

echo
echo "==> All packages updated."
