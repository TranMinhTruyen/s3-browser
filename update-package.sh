#!/usr/bin/env bash
set -euo pipefail

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
cd ./frontend
bun update --latest
