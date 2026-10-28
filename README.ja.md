# S3Browser

[English](README.md) | [Tiếng Việt](README.vi.md) | **日本語**

![Version](https://img.shields.io/badge/version-0.0.1--beta.1-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-Windows-lightgrey)

S3Browser は **Wails v3**（Go バックエンド、React + TypeScript フロントエンド）で作られたデスクトップアプリです。**AWS S3** と **MinIO** などの S3 互換サーバーのバケットやオブジェクトを閲覧・操作できます。

![メインウィンドウ](docs/user-guide/ja/images/01-main-window.png)

## 主な機能

- 接続プロファイルの保存（シークレットは暗号化して保存）と、複数アカウントへの同時接続（接続ごとに 1 タブ）。
- AWS S3 と MinIO に対応（カスタムエンドポイント、リージョン、パススタイル）。
- ページ分割された一覧でバケット、フォルダ、オブジェクトを閲覧。
- バケットとオブジェクトの検索（ページ分割された結果）。
- オブジェクトの詳細表示。
- ダイアログまたはドラッグ＆ドロップでのファイル・フォルダのアップロード（上限あり、リアルタイムの進捗ウィンドウ付き）。
- 1 件または複数のオブジェクトのダウンロード（分割並列取得）、進捗ウィンドウ、キャンセル、保存されるダウンロード履歴。
- オブジェクトとフォルダの削除（確認付き）。
- 英語、ベトナム語、日本語の UI。
- インストール不要のポータブル版。

| オブジェクト | アップロード |
| --- | --- |
| ![オブジェクト一覧](docs/user-guide/ja/images/08-object-list.png) | ![アップロード](docs/user-guide/ja/images/13-upload-modal.png) |

## システム要件

- Windows 10/11 (x64) と [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)。ポータブル版には専用の WebView2 が同梱されます。
- macOS と Linux: ソースからビルドしてください。これらのプラットフォームは未検証です。

## インストール

成果物は [ソースからのビルド](#ソースからのビルド) の手順で作成します。

- **インストーラー (NSIS)**: `go tool wails3 task package` で `build/windows/nsis/S3Browser-installer.exe` が作成されます。実行して画面の指示に従ってください。
- **ポータブル版**: `go tool wails3 task build:portable WEBVIEW2_DIR=<フォルダ>` で、`S3Browser.exe`、`data/`、`webview2/` を含むフォルダ `build/bin/S3Browser-portable` が作成されます。フォルダを任意の場所にコピーして `S3Browser.exe` を実行します。データはすべて exe の隣の `data/` に保存され、`webview2/` の WebView2 Fixed Version が使われます。これらのフォルダを exe から離さないでください。

## ソースからのビルド

必要なもの:

- [Go](https://go.dev/dl/) 1.27 以上（`go.mod` を参照）。Wails、sqlc、golangci-lint は `go.mod` に Go tool として宣言されているため、別途インストールは不要です。
- フロントエンド用の [bun](https://bun.sh/)。
- インストーラー作成用の [NSIS](https://nsis.sourceforge.io/) (`makensis`)。
- ポータブル版作成用の WebView2 Fixed Version（Microsoft の CAB を展開したもの）。
- ドキュメント生成のみに [Node.js](https://nodejs.org/)。

コマンド（特記なき限りプロジェクトルート `App/S3Browser` で実行）:

```bash
# フロントエンドの依存関係をインストール
bun install --cwd frontend

# TypeScript バインディングを生成（Go のハンドラーやモデルを変更した後）
go tool wails3 generate bindings -clean=true -ts

# 開発モードで実行
go tool wails3 task dev

# Windows インストーラーを作成
go tool wails3 task package

# ポータブル版を作成（WEBVIEW2_DIR には msedgewebview2.exe があるフォルダを指定）
go tool wails3 task build:portable WEBVIEW2_DIR=C:/path/to/webview2
```

Lint とテスト（`frontend/` で実行。Windows では `.exe` を付けます。例: `node_modules/.bin/biome.exe`）:

```bash
node_modules/.bin/biome check src
npx oxlint src
node_modules/.bin/tsc --noEmit
node_modules/.bin/vitest run
```

バックエンド（プロジェクトルート）:

```bash
go build ./...
go vet ./...
go tool golangci-lint run ./...
```

ユーザーガイドの PDF (en, vi, ja) を生成:

```bash
bun install --cwd docs
(cd docs && bunx playwright install chromium)
bun run --cwd docs build:pdf
```

## ディレクトリ構成

```
main.go            Wails アプリのエントリーポイント、サービス登録
internal/          Go バックエンド: handlers、modules (bucket, profile, master, global)、pkg (db, logger, portable など)
models/            フロントエンドと共有する入出力モデル
frontend/          React 19 + TypeScript の UI (src、bindings は Wails が生成)
build/             Wails のビルド資産とプラットフォーム別 Taskfile (windows, darwin)
docs/              アーキテクチャ文書、ユーザーガイド、PDF 生成ツール
sprints/           スプリントごとの要件と計画
```

- アーキテクチャ: [docs/ARCHITECTURE.ja.md](docs/ARCHITECTURE.ja.md)
- ユーザーガイド (PDF): [docs/user-guide/ja/S3Browser-user-guide.ja.pdf](docs/user-guide/ja/S3Browser-user-guide.ja.pdf)、ソース [user-guide.md](docs/user-guide/ja/user-guide.md)
- [変更履歴](CHANGELOG.ja.md)

## コントリビュート

バグやアイデアは issue で相談し、その後 pull request を送ってください。送る前に上記の lint とテストを実行し、すべて成功することを確認してください。コミットメッセージは [Conventional Commits](https://www.conventionalcommits.org/) に従います（例: `feat(bucket): add object search`）。コード規約は [CLAUDE.md](CLAUDE.md) を参照してください。

## ライセンス

[MIT](LICENSE) (c) 2026 minh-truyen
