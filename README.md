# S3Browser

**English** | [Tiếng Việt](README.vi.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [Русский](README.ru.md) | [Deutsch](README.de.md)

![Version](https://img.shields.io/github/v/release/TranMinhTruyen/s3-browser?include_prereleases&label=version)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-Windows-lightgrey)

S3Browser is a desktop application built with **Wails v3** (Go backend, React + TypeScript frontend) to browse and manage buckets and objects on **AWS S3** and S3-compatible servers such as **MinIO**.

![Main window](docs/user-guide/en/images/01-main-window.png)

## Features

- Save connection profiles (secrets are stored encrypted) and connect to several accounts at once, one tab per connection. Tabs can be reordered by drag and drop and are remembered between sessions.
- AWS S3 and MinIO (custom endpoint, region, path style), with many authentication methods: access key, AWS CLI profile, assume role (with MFA), AWS SSO, default credential chain, anonymous, MinIO STS, LDAP, OpenID Connect (OIDC) and TLS client certificate. An extra CA certificate file can be set for MinIO servers with a self-signed certificate.
- Browse buckets, folders and objects with paginated, virtualized lists; search buckets and objects.
- View the details of a bucket (region, ARN, policy, Block Public Access, versioning, encryption, Object Lock, tags) and of an object.
- Create buckets with a permission (private, public read-only or a custom JSON policy), edit the permission later, and delete buckets (including their objects and versions). A badge on each bucket shows its policy type.
- Upload files and folders from a dialog or by drag and drop, with limits and a live progress window.
- Download one or several objects with parallel ranged downloads, a progress window, cancel, and a persistent download history.
- Delete objects and folders (with confirmation).
- Settings dialog: theme (light / dark / follow system), font, language and launch on Windows startup; saved in `settings.json` and loaded before the UI appears.
- Interface in English, Vietnamese, Japanese, Simplified Chinese, Traditional Chinese, Russian and German.
- Automatic updates from GitHub Releases (installed Windows build), with an optional beta channel.
- Portable build that runs without installation.

| Objects | Upload |
| --- | --- |
| ![Object list](docs/user-guide/en/images/08-object-list.png) | ![Upload](docs/user-guide/en/images/13-upload-modal.png) |

| Create a bucket with a permission | Bucket details |
| --- | --- |
| ![Create bucket](docs/user-guide/en/images/31-bucket-create.png) | ![Bucket details](docs/user-guide/en/images/30-bucket-detail.png) |

## System requirements

- Windows 10/11 (x64) with the [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/). The portable build ships its own WebView2.

## Installation

Download the installer from the [GitHub Releases](https://github.com/TranMinhTruyen/s3-browser/releases) page:

- **Latest** release: the stable version, built from `master`.
- **Pre-release**: the beta version, built from `staging`.

Run `S3Browser-<version>-windows-amd64-installer.exe` and follow the steps. The release also has `checksums.txt` (SHA-256) to verify the download. The installed application checks for updates by itself and can be switched to the beta channel in Settings.

The portable build is not published: build it from source (see [Build from source](#build-from-source)).

- **Installer (NSIS)**: `go tool wails3 task package` creates `build/bin/S3Browser-amd64-installer.exe`.
- **Portable**: `go tool wails3 task build:portable WEBVIEW2_DIR=<folder>` creates the folder `build/bin/S3Browser-portable` containing `S3Browser.exe`, `data/` and `webview2/`. Copy the folder anywhere and run `S3Browser.exe`. All data stays in `data/` next to the exe, and the WebView2 Fixed Version runtime in `webview2/` is used. Do not move these folders away from the exe. The portable build does not update itself.

## Build from source

Prerequisites:

- [Go](https://go.dev/dl/) 1.27 or later (see `go.mod`). Wails, sqlc and golangci-lint are declared as Go tools in `go.mod`, so there is nothing else to install for them.
- [bun](https://bun.sh/) for the frontend.
- [NSIS](https://nsis.sourceforge.io/) (`makensis`) to build the installer.
- The WebView2 Fixed Version (extracted CAB from Microsoft) to build the portable package.
- [Node.js](https://nodejs.org/) only to generate the docs.

Commands, run at the repo root unless noted:

```bash
# Install frontend dependencies
bun install --cwd frontend

# Generate the TypeScript bindings (after changing Go handlers or models)
go tool wails3 generate bindings -clean=true -ts

# Run in development mode
go tool wails3 task dev

# Build the Windows installer
go tool wails3 task package

# Build the portable package (WEBVIEW2_DIR contains msedgewebview2.exe)
go tool wails3 task build:portable WEBVIEW2_DIR=C:/path/to/webview2
```

Lint and test (run in `frontend/`; on Windows use `.exe`, for example `node_modules/.bin/biome.exe`):

```bash
node_modules/.bin/biome check src
npx oxlint src
node_modules/.bin/tsc --noEmit
node_modules/.bin/vitest run
```

Backend (in the project root):

```bash
go build ./...
go vet ./...
go tool golangci-lint run ./...
```

Generate the user guide PDFs (one per language that has a `user-guide.md`):

```bash
bun install --cwd docs
(cd docs && bunx playwright install chromium)
bun run --cwd docs build:pdf
```

## Project structure

```
main.go            Wails app entry, registers services
internal/          Go backend: handlers, modules (bucket, profile, master, global, setting, update), pkg (db, logger, portable...)
models/            Input/output models shared with the frontend
frontend/          React 19 + TypeScript UI (src/pages/tab holds the tab page with the bucket and object views, bindings generated by Wails)
build/             Wails build assets and platform Taskfiles (windows)
docs/              Architecture notes, user guide, tools to build the PDFs and take the screenshots
sprints/           Requirements and plans per sprint
```

- Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- User guide (PDF): [docs/user-guide/en/S3Browser-user-guide.en.pdf](docs/user-guide/en/S3Browser-user-guide.en.pdf), source [user-guide.md](docs/user-guide/en/user-guide.md)
- [Changelog](CHANGELOG.md)

## Contributing

Open an issue to discuss a bug or an idea, then send a pull request. Before sending, run the lint and test commands above and make sure they pass. Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages (for example `feat(bucket): add object search`). See [CLAUDE.md](CLAUDE.md) for the code conventions.

## License

[MIT](LICENSE) (c) 2026 minh-truyen
