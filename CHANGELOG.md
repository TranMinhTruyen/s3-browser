# Changelog

**English** | [Tiếng Việt](CHANGELOG.vi.md) | [日本語](CHANGELOG.ja.md)

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
