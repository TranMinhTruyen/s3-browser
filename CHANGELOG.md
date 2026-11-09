# Changelog

**English** | [Tiếng Việt](CHANGELOG.vi.md) | [日本語](CHANGELOG.ja.md) | [简体中文](CHANGELOG.zh-CN.md) | [繁體中文](CHANGELOG.zh-TW.md) | [Русский](CHANGELOG.ru.md) | [Deutsch](CHANGELOG.de.md)

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.1.0] - Unreleased

### Added

- Settings dialog (button left of Download history): theme (light / dark / follow system), font (Nunito, System UI, Segoe UI, Arial, Roboto, Be Vietnam Pro, Verdana, Meiryo UI, Monospace, JetBrains Mono), language and launch on Windows startup (installed Windows build only).
- Settings are saved in `settings.json` next to `data.db` and loaded before the UI appears, so the language is now remembered.
- Changes are previewed immediately. **Apply** keeps them until the app closes, **Save** writes them to the file, **Reset to default** restores the defaults in the form.
- Dark theme.
- Bundled JetBrains Mono, Roboto and Be Vietnam Pro fonts.
- Drag and drop to reorder tabs. The app remembers the number, order and profile of the open tabs when it is closed.
- Several authentication methods per connection profile, chosen in the connection dialog:
  - AWS S3: access key (with an optional session token), AWS CLI profile, assume role (with optional MFA), AWS SSO, default chain, and anonymous access to the buckets you enter.
  - MinIO: access key, MinIO STS, LDAP / Active Directory, OpenID Connect (sign in with the system browser, authorization code with PKCE), TLS client certificate (mTLS) and anonymous access.
  - Optional CA file for MinIO servers whose certificate comes from a private certificate authority.
  - Temporary credentials are refreshed automatically before they expire, and a warning appears when they are about to expire during a transfer.
  - Secrets (including LDAP passwords and key passphrases) are stored encrypted. The OIDC login stays in memory only; the app never stores the token.
- Create a bucket (AWS S3 with a region, MinIO), with an optional access mode set at creation.
- Bucket permission: private (no bucket policy), public read-only, or a custom policy edited as JSON, with a warning when Block Public Access would reject a public policy.
- Bucket details drawer.
- Delete a bucket after typing its name. A bucket that is not empty is emptied first, including all versions and delete markers. A non-empty bucket with Object Lock cannot be deleted.
- Bucket rows show a badge with the policy type (Private / Public / Custom), loaded lazily for the visible rows only.
- Buckets that cannot be accessed, or are read-only for the current account, are flagged in the list.
- Result dialog after deleting several objects, listing what could not be deleted.
- Update check and install from GitHub Releases: a setting to check for and download updates automatically, a download progress bar, SHA-256 verification of the downloaded file, and a confirmation before the app closes to run the installer. A beta switch lets you receive pre-release versions.
- Interface in Simplified Chinese, Traditional Chinese, Russian and German, in addition to English, Vietnamese and Japanese (7 languages in total). Languages are loaded on demand.

### Changed

- The EN / VI / JA switch in the header moved into the Settings dialog.
- Colors use theme variables so every screen works in light and dark theme. The connection status of a profile uses light green / light red.
- Dialog buttons: Cancel is on the left, actions on the right (confirm, upload, history, settings).
- The window background follows the saved theme at start-up.
- Smoother scrolling of long object lists and of the connection profile list.
- Upload and download progress events are batched, so the interface stays responsive during large transfers.
- Switching language or font no longer freezes the interface, and the tab layout is saved only when it changes.
- Notifications disappear after 10 seconds.
- The database file is backed up before a migration runs.
- Internal cleanup of the backend and frontend (shared helpers, removal of dead code), with more unit tests.

### Removed

- macOS and Linux builds. S3Browser is now released for Windows 10/11 (x64) only.

### Known issues

- Deleting files or folders in a bucket with versioning only adds delete markers; older versions stay in the bucket. Deleting the bucket itself removes every version.
- A public read-only bucket policy whose statements are in a different order (for example written by another tool) is shown as Custom.
- At most 50 files per folder are ticked in one upload (4 large files, 1,000 files in total); files picked with the file dialog count as one folder.
- File sizes are computed in units of 1,024 but labelled KB / MB / GB.

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
