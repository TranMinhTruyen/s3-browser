# Changelog

**English** | [Tiếng Việt](CHANGELOG.vi.md) | [日本語](CHANGELOG.ja.md)

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Settings dialog (button left of Download history): theme (light / dark / follow system), font (Nunito, System UI, Segoe UI, Arial, Monospace, JetBrains Mono), language and launch on Windows startup (installed Windows build only).
- Settings are saved in `settings.json` next to `data.db` and loaded before the UI appears, so the language is now remembered.
- Changes are previewed immediately. **Apply** keeps them until the app closes, **Save** writes them to the file, **Reset to default** restores the defaults in the form.
- Dark theme.
- Bundled JetBrains Mono font.

### Changed

- The EN / VI / JA switch in the header moved into the Settings dialog.
- Colors use theme variables so every screen works in light and dark theme. The connection status of a profile uses light green / light red.
- Dialog buttons: Cancel is on the left, actions on the right (confirm, upload, history, settings).
- The window background follows the saved theme at start-up.

## [0.0.1-beta.1] - 2026-10-28

First beta release.

### Added

- Connection profiles: create, edit, delete, auto-connect, with encrypted secrets.
- Connect to AWS S3 and MinIO (endpoint, region, path style), several connections at once in tabs.
- Browse buckets, folders and objects with paginated lists.
- Search buckets and objects with paginated results.
- Object detail drawer.
- Upload files and folders from a picker dialog or by drag and drop, with upload limits and a progress window.
- Download one or several objects in parallel chunks, with a progress window, cancel and a persistent download history.
- Delete objects and folders with a confirmation step.
- Interface in English, Vietnamese and Japanese.
- Portable Windows build that keeps its data next to the exe and ships its own WebView2.
- Documentation: architecture notes and a user guide (PDF) in three languages.

### Changed

- Faster start: heavy dialogs are loaded on demand, so the code loaded at start-up is about 24% smaller.
- Lists load 20 items per page instead of 10, which means fewer round trips when browsing large buckets.
- Selecting objects no longer redraws the whole tab.
- Internal cleanup of the backend and frontend (shared helpers, removal of dead code and unused dependencies), with more unit tests.
