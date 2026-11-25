# S3Browser Architecture

[English](ARCHITECTURE.md) | [Tiếng Việt](ARCHITECTURE.vi.md) | [日本語](ARCHITECTURE.ja.md) | [简体中文](ARCHITECTURE.zh-CN.md) | [繁體中文](ARCHITECTURE.zh-TW.md) | [Русский](ARCHITECTURE.ru.md) | [Deutsch](ARCHITECTURE.de.md)

A short tour of the code for new developers. Conventions live in `CLAUDE.md`; this file explains how the pieces fit together.

## 1. Stack

- Desktop app on **Wails v3**: Go backend + React 19 / TypeScript frontend in a WebView. Windows only.
- Backend: AWS SDK v2 (S3), `madmin-go` (MinIO admin), SQLite (modernc) + goose migrations + sqlc, `slog`.
- Native DB library: **Rust** `s3b_db.dll` (tokio + one low-level driver per database), loaded by Go **without cgo**. It does all the work of the SQL mode on the user's databases (section 2.11).
- Frontend: Mantine 9, zustand 5 + immer, NiceModal, i18next (7 languages: en / vi / ja / zh-CN / zh-TW / ru / de), sonner (toast), `@tanstack/react-virtual`, zod, dayjs. Package manager: **bun**.

```
s3-browser
├── main.go                 entry: logger, Wails app, services, main window
├── internal/
│   ├── app.go              builds DB, modules and handlers; Shutdown
│   ├── handlers/           thin Wails services (bound to the frontend)
│   ├── modules/
│   │   ├── global/         shared connection container and access cache
│   │   ├── profile/        connection profiles (encrypted secrets)
│   │   ├── master/         master data (regions...)
│   │   ├── bucket/         connect, buckets, bucket policy, objects, upload, download, search
│   │   ├── db/             SQL mode: DB profiles, connections, queries -> calls s3b_db.dll
│   │   ├── setting/        app settings (settings.json), remembered tabs (tabs.json), autostart
│   │   └── update/         self-update from GitHub Releases
│   └── pkg/                cnst, db (schemas, queries, sqlc), logger, memprobe, portable, utils
├── models/                 input/output models + alias.go
├── rust/                   Cargo workspace of s3b_db.dll: src/{ffi,dispatch,registry,runtime}.rs, protocol/, drivers/, tests/
├── frontend/
│   ├── bindings/           GENERATED Wails bindings (do not edit)
│   └── src/                common, components, pages (pages/s3, pages/sql), locales, test
├── build/                  platform packaging (Windows NSIS, portable, ...) and Taskfiles (build:dll, copy:dll)
├── test-env/               Docker test servers (MinIO, Keycloak, LDAP, 6 databases), bench scripts
└── docs/                   this documentation + PDF tooling
```

## 2. Backend

### 2.1 Layers

```mermaid
flowchart LR
  main[main.go] --> app[internal/app.go]
  app --> H[handlers]
  H --> M[modules/*/module.go]
  M --> S[submodule_*_mng.go]
  S --> G[(modules/global)]
  S --> DB[(SQLite via sqlc)]
  S --> S3[(S3 / MinIO)]
  S --> DLL[[s3b_db.dll - Rust]]
  DLL --> UDB[(user databases)]
```

- `main.go` creates the logger and the Wails app, registers the six handlers (bucket, db, master, profile, setting, update) with `application.NewService`, and creates the main window (`EnableFileDrop: true`).
- `internal/app.go` (`NewApp`) opens and migrates the database, creates the `KeyManager` (secret encryption), builds the modules, then the handlers on top. `Shutdown` cancels transfers, disconnects everything and closes the DB.
- **Handlers** (`internal/handlers/*_handler.go`) are thin: they only call the module. Their public methods become the TypeScript bindings.
- **Modules** (`internal/modules/<name>/module.go`) expose the documented public API. Work is split into unexported submodules (`submoduleXxxMng`, constructor `newSubmoduleXxxMng`) in `submodule_<x>_mng.go`.

### 2.2 Output and message codes

Every handler returns `models.Output[T]` (`Result`, `MessageList`, `Body`).

```go
output := models.NewOutput[T]()
output.AddMessage(msg)             // keep Result = true
return output.ThrowError(msg)      // Result = false + message
```

- A message is built with `models.NewMessage` / `models.NewParamsMessage(type, module, CODE, errorDetail, params)`. Types: `S` success, `E` error, `W` warn, `I` info (`internal/pkg/cnst`).
- Codes are `var`s at the top of each `module.go`, format `<PREFIX><S|E|W><NNN>` (`S3E006`, `PFE001`, `MTE001`, `UPE004`).
- The frontend translates a message with the key `ipcMessage:<moduleName>.<CODE>`, so **every new code needs a key in `frontend/src/locales/{en,vi,ja,zh-CN,zh-TW,ru,de}/messages/ipcMessage.json`**.
- New models go under `models/<domain>/` (`*_input.go`, `*_output.go`, camelCase json tags) and must be re-exported in `models/alias.go`.

### 2.3 Connection container and access cache (`modules/global`)

`global.Module` holds `connContainer`, a `map[id]*S3Conn` guarded by `sync.RWMutex`. `S3Conn` bundles the S3 client, presign client, optional MinIO admin client, the `http.Transport` and the credentials (`Creds`, `CredInfo`). `profile` registers connections, `bucket` reads them (`GetConnContainer`). `RemoveConn` / `ReplaceConn` return the old connection and **never close it**: the caller closes it after the lock is released, because closing does network I/O.

Each connection also owns an `AccessCache` (`access_cache.go`): per bucket name it remembers whether read, write and delete access is denied, and the bucket policy mode shown as a badge. Entries expire after `accessTTL` (5 minutes). `Reset` bumps a generation, so a probe that started before a reset (with old credentials) cannot write its result. The bucket list uses it to flag inaccessible / read-only buckets without probing every bucket again.

### 2.4 Context and cancellation

- Handlers that take `ctx` get the Wails call context, which ends when the frontend cancels the call but is detached from the app lifetime.
- `withCallContext(ctx, appCtx, timeout)` (`modules/bucket/call_helper.go`) derives the context for one call: it stops on frontend cancel, on app shutdown (`context.AfterFunc`) and on timeout. Always `defer` the returned cancel.
- `isCallCanceled(ctx)`: a canceled call returns `Result=false` **silently** (nobody waits); a timeout is still reported.
- Concurrency uses `errgroup` with `SetLimit`. Code inside `g.Go` must not panic: Wails does not recover panics of extra goroutines.

### 2.5 Events

Backend-to-frontend events are constants in `modules/<x>/events.go`, named `domain:kebab-name`, for example `uploader:upload-progress-batch`, `downloader:download-progress-batch`, `uploader:files-dropped`, `bucket:credential-expiring` and `update:state-changed`. They are registered in `init()` with `application.RegisterEvent[PayloadType](name)`; it must be called directly from `init` so the binding generator emits the payload type. Progress events are batched: one shared 200 ms ticker (`utils.BatchReporter`) sends a single event holding the progress of every running job (`{items: [...]}`). Dropped files come from `main.go` (`WindowFilesDropped` -> `BucketHandler.FilesDropped`) and are re-emitted as `uploader:files-dropped` / `uploader:picker-files-dropped`.

### 2.6 Database

SQLite file `data.db` in the app data dir (see `internal/pkg/portable`; WAL, foreign keys on, backed up on start).

- Migrations: goose, `internal/pkg/db/schemas/NNNNNN_name.sql`, run by `db.RunMigrations`.
- Queries: `internal/pkg/db/queries/<domain>/<snake_name>.sql` with `-- name: PascalName :one|many|exec`; SQL uses leading commas.
- Code: `go tool sqlc generate` writes `internal/pkg/db/sqlc` (generated, never edit).

### 2.7 App settings and remembered tabs (`modules/setting`)

Theme, font, language, launch-on-startup and the update options (`autoUpdate`, `betaUpdate`) live in `settings.json` in the same data dir as `data.db` (not in SQLite).

- `GetSettings`, `SaveSettings`, `ResetSettings` (`SettingHandler`). Values are validated against fixed lists (`languages` in `submodule_setting_mng.go` holds the 7 language codes); a missing or corrupt file falls back to the defaults (`light`, `nunito`, `en`, auto update on), an unknown value resets only that field.
- Writes are atomic (temp file + rename) under a mutex. `ResetSettings` only returns the defaults; nothing is written until Save.
- After a successful `SaveSettings`, the handler passes `betaUpdate` and `autoUpdate` to `update.Module` (`SetBeta`, `SetAutoUpdate`).
- Launch on startup writes `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` (`autostart_windows.go`). It is not supported on the portable build or other OSes (`autostartSupported=false`). Save writes the file first, then the registry; if the registry fails the file keeps the old value and warning `STE003` is returned.
- `main.go` reads the theme once to set the window background colour before the page loads.
- Remembered tabs: `GetTabState` / `SaveTabState` (`SettingHandler`) read and write `tabs.json` (`submodule_tab_mng.go`): tab order, active tab and the profile of each tab. A missing, malformed or invalid file yields an empty state.

### 2.8 Authentication and connections (`modules/profile`, `modules/bucket`)

A profile has a `provider` (`aws` or `minio`) and an `authType` (`internal/pkg/cnst/auth.go`). `cnst.IsAuthTypeValid` checks the pair; the list must match the CHECK of the `000002_auth_methods.sql` migration and `authMethods.ts` in the frontend.

| Provider | Auth types |
|---|---|
| `aws` | `static`, `sharedProfile`, `assumeRole`, `sso`, `defaultChain`, `anonymous` |
| `minio` | `static`, `minioAssumeRole`, `minioLdap`, `minioOidc`, `minioCert`, `anonymous` |

- Profiles are stored in SQLite: the non-secret options are a JSON column (`auth_config`), the secrets are encrypted with `KeyManager` (`auth_secret`).
- `buildCredentials` (`submodule_cfg_credentials.go`) resolves the credentials of the auth type and **retrieves them once**, so a wrong profile, an expired SSO session or a rejected role fails at connect time with its own message (`S3E030` - `S3E038`, `PFE009`) instead of at the first request.
  - AWS CLI based types (`sharedProfile`, `sso`, `assumeRole`, `defaultChain`) use the SDK config files. `assumeRole` with an MFA serial uses the one-time code once, so it cannot renew without a new code.
  - `minioAssumeRole` (access key + secret) and `minioLdap` (LDAP user + password) ask the MinIO STS endpoint (the S3 endpoint). The credentials renew **by themselves** before they expire, because the secrets stay in memory inside the provider (never logged).
  - `minioCert` asks MinIO STS with a TLS client certificate (mTLS, `AssumeRoleWithCertificate`, needs https). The PEM key may be PKCS#8 encrypted (`submodule_cert_loader.go`).
  - `minioOidc` exchanges the tokens of an OpenID Connect sign-in for MinIO credentials (`AssumeRoleWithWebIdentity`).
  - `anonymous` sends unsigned requests; the buckets must be entered by the user because an anonymous client cannot list buckets.
- **OIDC** (`submodule_oidc_login.go`): authorization code flow with **PKCE**, public client only. The system browser opens the IdP page, a local server on `127.0.0.1` receives the redirect and is shut down right after. The sign-in times out after 5 minutes (`oidcLoginTimeout`). The session (tokens) lives **only in backend memory**, is reused for at most 10 minutes (`oidcSessionTTL`, also capped by the token expiry) and is single use per connect; the frontend only holds a `sessionId` and never sees a token. When the session was already used, a new sign-in is needed (`S3E030`). OIDC profiles never auto-connect (`cnst.IsAutoConnectAllowed`), and neither do `assumeRole` profiles with an MFA serial.
- **URL safety**: every URL that comes from the IdP (issuer, endpoints of the discovery document) must pass `utils.IsSecureUrl` (`internal/pkg/utils/url.go`): `https`, or `http` only for a loopback host. The profile form is checked the same way (`profile/submodule_auth_mng.go`).
- **Custom CA**: any MinIO auth type can add a CA file (`AuthConfig.CaFile`). `newTransport` adds it to the system pool (`S3E049` if it cannot be loaded) and it applies only to the MinIO transport (S3 and STS); the IdP is reached with the OS trust store. `newTransport` always sets a `TLSClientConfig` because minio-go writes into it for mTLS. `ChooseAuthFile` opens the native dialog for the certificate, key and CA files; cancelling the dialog is not an error (`utils.IsDialogCancelled`).
- **Reauth**: `ReauthConnection` renews the credentials of a live connection without dropping it (the provider behind `SwapCreds` is replaced, `madmin` reads through the same provider), so running transfers continue. Secrets that the profile does not save (`mfaCode`, `secretKey`, `ldapPassword`) come from the frontend for that call only.
- **Expiry warning**: when credentials cannot renew without the user (`CredInfo.Refreshable=false`), the backend emits `bucket:credential-expiring` (`CredentialExpiringOutput`) before they expire; the frontend (`useCredentialExpiring`) shows a toast.

### 2.9 Bucket management and bucket policy (`modules/bucket`)

- `CreateBucket`, `GetBucketDetail`, `GetBucketDeleteInfo`, `DeleteBucket`, `GetBucketPolicy`, `PutBucketPolicy` and `CheckBucketAccess` are in `module.go`; the work is in `submodule_bucket_mng.go`, `submodule_bucket_detail.go`, `submodule_bucket_delete.go`, `submodule_bucket_edit_mng.go` and `submodule_bucket_policy.go`.
- **Access modes** of a bucket: `private` (no policy), `public` read-only (`GetObject`, `ListBucket`, `GetBucketLocation` for `*`) and `custom` (JSON). There is no ACL. Policies are compared by meaning (`samePolicy`), because MinIO returns a normalized policy. On real AWS the policy requests go to the region of the bucket (`policyOptFns`), and Block Public Access is only read and shown as a warning (`S3E058` when saving a public policy it blocks).
- Creating a bucket can set the access mode in the same call. If the bucket was created but the policy failed, the bucket is kept, `Result` stays true and a warning is returned (`S3W011`, or `S3W012` for Block Public Access).
- **Badge**: the bucket list shows the policy mode of each bucket (`PolicyBadge`). `GetListBucket` fills `PolicyMode` from the `AccessCache`, reads the missing ones in parallel, and caches only definite answers (`isSurePolicyError`) so a timeout is retried. Anonymous connections are skipped.
- **Delete**: the user types the bucket name. A non-empty bucket is emptied first (all versions and delete markers through the shared `batchDeleter`), then `DeleteBucket` runs (timeout 30 minutes). A non-empty bucket with Object Lock is refused before any object is deleted (`S3E063`). There is no progress event and no cancel button; closing the app stops it silently. The Delete menu item is hidden only when the account is known to be denied `s3:DeleteBucket` (`AccessDelete`).
- Anonymous connections cannot create, change or delete buckets (`S3E054`) but can open the detail drawer.

### 2.10 Auto update (`modules/update`)

`update.Module` checks **GitHub Releases** of `TranMinhTruyen/s3-browser` for a newer version, downloads the NSIS installer and runs it. `UpdateHandler` exposes `GetUpdateState`, `CheckUpdate`, `DownloadUpdate` and `InstallUpdate`.

- **Supported builds**: only a Windows build from the NSIS installer (it writes `uninstall.exe` next to the exe; `installSupported`). Portable and unpacked builds, and other OSes, are not supported and the frontend hides the feature (`supported=false`). Dev mode keeps it on for testing. The version comes from `build/config.yml` (embedded in `main.go`).
- **Channels**: one GitHub provider for stable releases and one that also includes pre-releases; the option `betaUpdate` picks the channel (`SetBeta`). With beta on, only a newer pre-release counts.
- **Check**: `CheckUpdate` runs when the user asks. When `autoUpdate` is on, a loop checks 10 seconds after start and then every 6 hours (`checkInterval`), and a new release starts downloading by itself; failures of the loop are only logged.
- **Checksum**: the release asset `checksums.txt` must give a SHA-256 for the installer `S3Browser-<version>-windows-<arch>-installer.exe`. The file is hashed while it is downloaded to the temp dir and deleted if the hash does not match (`UPE004`). `InstallUpdate` verifies it again before running, because the temp dir is writable by other programs. Downloads only go to GitHub hosts.
- **Install**: the installer runs silently through `ShellExecute` (UAC prompt, `/S /relaunch /D=<install dir>`), then the app quits and the installer starts the new version. If the installer cannot run, the app keeps running (`UPE005`). The downloaded installer is cleaned up after the next start.
- **State**: `UpdateStateOutput` (`supported`, `state`, `currentVersion`, `version`, `releaseUrl`, `written`, `total`, `errorCode`, the `UPE...` code when `state` is `error`). `state` is `idle`, `checking`, `upToDate`, `available`, `downloading`, `ready` or `error`. Every change, and every 200 ms while downloading, is sent with the event `update:state-changed`.
- **Messages**: `UPS001` (latest version), `UPE001` (cannot check), `UPE002` (GitHub rate limit), `UPE003` (cannot download), `UPE004` (checksum), `UPE005` (cannot run the installer), `UPE006` (no installer for this machine).

### 2.11 SQL mode: how Go calls Rust (`modules/db` -> `s3b_db.dll`)

**All the work on a database the user connects to is done in Rust**: opening the connection, running SQL, splitting statements, the object tree, paging, converting values and cancelling. Go is only the bridge: it checks the input, sends a request, maps errors to messages and passes the result on. The frontend does not know Rust exists; it calls `DbHandler` like any other binding. The app's own SQLite (profiles, settings) stays in Go.

```mermaid
sequenceDiagram
  participant FE as React (callIPC)
  participant M as DbHandler + modules/db
  participant N as submoduleNativeMng
  participant F as ffi.rs
  participant D as dispatch.rs
  participant A as driver actor
  FE->>M: ExecuteSql(input) (binding)
  M->>N: callNativeRaw(ctx, "execute", params)
  N->>F: s3b_call(request JSON), syscall without cgo
  F->>D: dispatch::call (tokio, block_on)
  D->>A: Cmd::Execute (mpsc channel)
  A-->>D: ExecuteResult (oneshot channel)
  D-->>F: {"ok":true,"result":{...}}
  F-->>N: out_ptr / out_len (Rust buffer)
  N->>F: s3b_free(ptr, len) after copying
  N-->>M: result bytes, not decoded
  M-->>FE: Output.Body = the same JSON
```

**Loading the DLL** (`internal/modules/db/native_windows.go`)

- The app is built with `CGO_ENABLED=0`. Go loads the DLL with `golang.org/x/sys/windows`: `LoadLibraryEx(<exe folder>\s3b_db.dll, LOAD_LIBRARY_SEARCH_APPLICATION_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32)`. The path is absolute, so no folder on the search path can substitute the DLL.
- `GetProcAddress` finds the four exports, then `s3b_init` runs once. Every call goes through `syscall.SyscallN`.
- The DLL is loaded by the first call (usually Connect), not at app start. A failed load is retried by the next call and reported as `DBE009`. On other operating systems `native_other.go` only returns an error.
- The DLL is linked with `+crt-static` (`rust/.cargo/config.toml`), so it does not need `VCRUNTIME140.dll`.

**FFI contract** (`rust/src/ffi.rs`)

| Export | Signature | Role |
|---|---|---|
| `s3b_init` | `() -> i32` | Creates the single tokio runtime and the TLS provider. |
| `s3b_call` | `(req_ptr, req_len, *out_ptr, *out_len) -> i32` | One JSON request; blocks until the JSON response is ready and returns a buffer owned by Rust. |
| `s3b_cancel` | `(id: u64)` | Asks to interrupt request `id`. |
| `s3b_free` | `(ptr, len)` | Frees a buffer returned by `s3b_call`. |

- The return value only reports a failed call: `0` ok, `1` bad argument, `2` init failed, `-1` panic. Errors of the work itself (bad SQL, closed connection...) come back inside the JSON.
- Every export is wrapped in `catch_unwind` and the release profile keeps `panic = "unwind"`, so a Rust panic never crosses into Go. `unwrap`/`expect` are not used outside tests.
- Memory: Rust copies the request and keeps no pointer to Go memory after it returns. Go copies the response and always calls `s3b_free`: a buffer allocated by Rust is freed only by Rust.

**Protocol** (`rust/src/protocol/mod.rs`, camelCase JSON)

```jsonc
// request: id is unique per call (atomic counter in Go) and is also the key of s3b_cancel
{"id": 7, "method": "execute", "params": {"connId": 1, "sql": "select 1", "pageSize": 10000, "maxPageBytes": 16777216}}
// success
{"ok": true, "result": {...}}
// failure
{"ok": false, "error": {"code": "sqlError", "message": "no such table: t"}}
```

- Methods: `open`, `close`, `execute`, `fetch`, `schemaTree`, `tableInfo`, `tableRows`.
- Error codes are stable and mapped by `errorCodeMessage` (`submodule_native_mng.go`): `invalidRequest` `DBE001`, `openFailed` `DBE002`, `notADatabase` `DBE003`, `connNotFound` `DBE004`, `cursorNotFound` `DBE005`, `sqlError` `DBE006` (shown with the statement, not as a toast), `tableNotFound` `DBE007`, any other code `DBE008`. `cancelled` returns `Result=false` silently. A failed load is `DBE009`, a Go timeout `DBE015`. New codes need keys in the 7 `ipcMessage.json` files.

**Inside Rust**: `ffi.rs` -> `dispatch.rs` -> `drivers/<db>/`

- `dispatch::call` runs each request as a task on the single multi-thread tokio runtime (`runtime.rs`) and waits for it with `block_on`, because `s3b_call` is synchronous for Go. A panic inside the task becomes the error `internal`.
- `dispatch` parses the request and routes it by `method`. Parse errors never repeat the bad value, so a password cannot leak into a message.
- Each connection is an **actor**: one tokio task that alone owns the connection. It receives commands (`Cmd::Execute`, `Fetch`, `TableRows`, `SchemaTree`, `TableInfo`, `Close`) on an `mpsc` channel and answers on a `oneshot` channel, so no lock is needed around the connection (like a goroutine with a channel in Go).
- `registry.rs` maps `connId` to the channel of its actor, and a request `id` to its connection and `CancelSignal`.
- Each database uses its lowest-level driver, which writes the rows straight to JSON text with capacity allocated up front:

| Database | Rust driver |
|---|---|
| SQLite | `libsqlite3-sys` (C API, bundled); `sqlx` only to open the connection |
| PostgreSQL | `tokio-postgres` |
| MySQL / MariaDB | `mysql_async` |
| SQL Server | `tiberius` |
| MongoDB | `mongodb` (raw BSON) |
| Redis | `redis` |

**Results are not decoded in Go**

`callNativeRaw` checks that the response starts with `{"ok":true,"result":` and slices out the result bytes without parsing them. `StatementResult`, `ExecuteSqlOutput` and `FetchRowsOutput` (`models/db`) keep these bytes, and their `MarshalJSON` (`query_output_json.go`, build tag `!wailsgen`) writes them unchanged into the Wails response, so a page of 10,000 rows is never decoded and encoded again. The bindings generator renders a type with `MarshalJSON` as `any`, so bindings are generated with `-tags=wailsgen` (section 4). Small results (`open`, `schemaTree`, `tableInfo`) are decoded normally with `callNative[T]`.

**Cancel and timeouts**

- The Go context of a call ends when the frontend aborts it (`AbortController`), when the app shuts down, or at the timeout: 5 minutes for `ExecuteSql`, `OpenTableRows` and `FetchRows` (`queryTimeout`), 30 seconds to connect and read metadata (`metaTimeout`). `FetchRows` with `All` has no page limit and no timeout.
- When the context ends, a goroutine in `callNativeRaw` calls `s3b_cancel(id)` every 100 ms until `s3b_call` returns, because the first cancel can arrive before Rust has registered the request.
- Rust sets the `CancelSignal`, interrupts the running statement and answers `cancelled`. Go returns `Result=false` silently when the frontend canceled, and `DBE015` on timeout.

**Connections and paging**

- One **main connection** per profile (`ConnectDb`), used for the object tree and table info, and **one connection per SQL tab**, opened at the first run in that tab. `CloseDbTab` closes the connection of a tab, `DisconnectDb` closes every connection of the profile, and `Close` (shutdown) closes them all.
- Results are paged: the first page and each next page hold at most 10,000 rows or 16 MiB (`pageSize`, `maxPageBytes`). The rest stays in a cursor on the Rust side (`cursorId`); the whole result is never read into memory.

**Current status**

- Rust has drivers for SQLite, PostgreSQL, MySQL, MariaDB, SQL Server, MongoDB and Redis, tested against real servers.
- Go opens only **SQLite** for now (`openParams{"sqlite", path, readOnly}` in `submodule_conn_mng.go`).
- PostgreSQL profiles can be saved (`db_profiles`), but their connect, object tree and rows in the frontend are still mocks (`frontend/src/pages/sql/mock`). The other network databases are not in the UI yet.

**Adding a capability**

1. Rust: params and result types in `protocol`, a branch in `dispatch::route`, a `Cmd` variant, the work in each driver, tests with `cargo test`.
2. Go: a params struct and a call with `callNative[T]` (small result) or `callNativeRaw` (rows), new error codes mapped to `DBE...` with keys in the 7 languages, then the module method, the handler and regenerated bindings.
3. Never do the work in Go as a shortcut: Go stays a bridge.

## 3. Frontend

### 3.1 Calling the backend: `callIPC`

All backend calls go through `callIPC` (`frontend/src/common/utils/ipcUtils.ts`), never the binding directly:

```ts
const body = await callIPC(GetListObject, [input], { scope: `${SCOPE}/load`, signal });
```

- Shows the messages of `Output` as toasts (`showMessage`, default on) using `ipcMessage:<module>.<CODE>`.
- Returns the `body` on success, `null` on failure, cancel or stale result.
- `scope`: a newer call with the same scope makes the older result be dropped. `signal` (an `AbortController`) cancels the call, which also cancels the Go context.
- Bindings are imported from `@wails/...` (`frontend/bindings`, generated).

### 3.2 Stores

Stores are created with `createAppStore(creator, name)` (zustand + immer + devtools in dev; in dev they are also on `window.__stores`).

- Each store has `State`, `Action` and a `SCOPE` constant; every `set` is named: ``set(update, undefined, `${SCOPE}/actionName`)``.
- `reset()` calls `invalidateLoads(SCOPE)` so in-flight results of that store are dropped.
- Use narrow selectors or `useShallow`; never select a whole object.

### 3.3 Modals

Modals are NiceModal components wrapped by `createMantineModal` (`common/utils/modalUtils.ts`), with z-index managed by `modalStackStore`. Heavy modals are loaded on demand in `components/modals/lazyModals.ts` (`showConnectModal`, `showHistoryModal`, `showSettingModal`), so they stay out of the main bundle. Use the wrappers in `components/buttons|inputs|modals` instead of raw Mantine components. Modal footer: Cancel on the left, actions on the right (`<Group justify="space-between" wrap="nowrap">`); a main content area goes in `<Paper withBorder>`.

### 3.4 i18n

`locales/i18n.ts` supports **7 languages**: `en`, `vi`, `ja`, `zh-CN`, `zh-TW`, `ru`, `de` (`LANGUAGES` and the native names `LANGUAGE_LABELS` are in `common/cnst/settingConst.ts`). Only `en` is imported statically; the others are loaded with a dynamic `import()` (`RESOURCE_LOADERS`) through `loadLanguage` before `changeLanguage`. Each language has a `resource.ts` registering one namespace per component/page (`locales/<lang>/components|pages|messages`). No hard-coded UI strings: add keys to **all seven** languages (same keys and `{{x}}` placeholders as `en`) and register new namespaces in all seven `resource.ts`. The CJK languages get their own font fallback in `getFontFamily`.

### 3.5 Events

Backend events are consumed with `Events.On(name, handler)` from `@wailsio/runtime` inside `useEffect`, and the returned unsubscribe function is called in the cleanup (see `UploaderWindow`, `DownloaderWindow`, `useFilesDroppedUpload`, `useAppUpdate`).

### 3.6 Lists and performance

Large lists (objects, buckets, uploader, history, file lists) are virtualized with `@tanstack/react-virtual`. Object lists page with a cursor (`useObjectPaging`, first page `FIRST_PAGE_SIZE = 200`, next pages `NEXT_PAGE_SIZE = 1000`). List items are `memo`; every function in a component is wrapped in `useCallback`; handlers are named `on<Event><Target>` (`onClickConnect`).

### 3.7 Layout and tabs

`App.tsx` -> `MainLayout` (mode switch, uploader/downloader windows) -> `S3Workspace` or `SqlWorkspace` (lazy in `MainLayout`, loaded on the first visit of the mode; each has its navbar and tab page) -> `S3TabPage` (imported statically by `S3Workspace`, `pages/s3/S3TabPage.tsx`). `S3TabPage` holds the tab bar (`TabStrip` and `SortableTab` in `components/tabs`, drag and drop with dnd-kit, keyboard reorder with Ctrl+Shift+Left/Right) and renders `TabDetail`, which shows `pages/s3/bucket` (`BucketListView`, `BucketItem`) or `pages/s3/object` (`ObjectListView`, `ObjectItem`). Shared pieces are in `pages/s3/components` (`BucketDetailDrawer`, `ObjectDetailDrawer`, `TabActionBar`, `TabBreadcrumb`). Each mode has its own folder `pages/<mode>` (`s3`, `sql`) with subfolders such as `stores`, `hooks`, `utils`, `modals`, `navbar`, `components` and `transfer`. S3 state lives in `pages/s3/stores` (`profileStore`, `tabListStore`, `uploaderStore`, `downloaderStore`, `masterDataStore`); app-wide state lives in `common/stores` (`settingStore`, `updateStore`).

**Remembered tabs**: `useTabPersistence` (called in `App.tsx`) saves the tab order, active tab and profile of each tab to `tabs.json` through `SaveTabState` 500 ms after they stop changing and on `pagehide`. At start `restoreTabsFromDisk` (`pages/s3/utils/tabPersistence.ts`) loads them with `GetTabState`. If the load fails, saving is disabled for the session so `tabs.json` is never overwritten. A tab whose profile was deleted keeps its place but loses the profile (`normalizeTabProfiles`).

### 3.8 SQL mode

`SqlWorkspace` (`pages/sql`) has the profile navbar with the object tree (`dbTreeStore`) and `SqlTabPage` with the SQL tabs (`sqlTabStore`): a CodeMirror editor, Run (Ctrl+E) and Cancel, Find/Replace, and the result panel (one tab per SELECT plus Messages, rows in the virtualized `DataGrid`). `useSqlRunner` calls `ExecuteSql`, loads the next pages with `FetchRows` while scrolling, and calls `CloseDbTab` when a tab is closed or changes profile. Opening a table shows its structure and its data (`useTableRows`, `OpenTableRows`). Profiles are in `dbProfileStore` (`sqlite` or `postgres`).

### 3.9 Settings, theme and updates

`main.tsx` awaits `loadStartupData()` before rendering (loads the settings and `restoreTabsFromDisk()` in parallel), so theme, font, language and saved tabs are ready first (defaults on failure). `settingStore` keeps `saved` (file), `applied` (current session, changed by Apply) and `draft` (form, previewed live); closing the modal reverts to `applied`. `applySettings` sets the Mantine color scheme (in-memory `settingColorSchemeManager`, no localStorage), the `--mantine-font-family` variable and the i18n language.

`AppUpdateToast` mounts `useAppUpdate` once: it loads the state with `GetUpdateState`, follows `update:state-changed` into `updateStore`, and keeps one toast in step (new version with a Download button when auto update is off, download progress, ready to install). Nothing is shown when `supported` is false.

Colors: use `var(--mantine-color-*)` and `light-dark(<light>, <dark>)`, never hard-coded hex/rgb (except colors stored as data, such as the profile color).

## 4. Bindings and commands

Wails bindings are generated from the Go handlers; regenerate after any change to a handler signature or model. The tag `wailsgen` is required (section 2.11):

```
go tool wails3 generate bindings -f "-tags=wailsgen" -clean=true -ts
```

The Windows build tasks first build the Rust library (`common:build:dll`: `cargo build --release --target x86_64-pc-windows-msvc` in `rust/`), then copy `s3b_db.dll` next to the exe (`common:copy:dll`). `dev`, `build`, `package` and `build:portable` do this by themselves, and the NSIS installer and the portable folder include the DLL. Stop the running app before building, otherwise the DLL cannot be replaced.

| Task | Command (run at the repo root unless noted) |
|---|---|
| Dev | `go tool wails3 task dev` |
| Build | `go tool wails3 task build` |
| Package (installer) | `go tool wails3 task package` |
| Portable (Windows) | `go tool wails3 task build:portable WEBVIEW2_DIR=<WebView2 Fixed Version folder>` |
| Go check | `go build ./...`, `go vet ./...`, `go tool golangci-lint run ./...` |
| sqlc | `go tool sqlc generate` |
| Rust check (`rust/`) | `cargo fmt --check`, `cargo clippy --target x86_64-pc-windows-msvc --all-targets -- -D warnings` |
| Rust test (`rust/`) | `cargo test`; tests that need a database server use `test-env/docker-compose.yml` and are skipped without it (`S3B_REQUIRE_DB=1` turns a skip into a failure) |
| FE type-check (`frontend/`) | `node_modules/.bin/tsc --noEmit` (`tsc.exe` on Windows) |
| FE lint / format | `npx oxlint <paths>`, `node_modules/.bin/biome check --write <paths>` |
| FE test | `bun run test` (vitest); tests live in `frontend/src/test/` mirroring `src/` |
| E2E test (`frontend/`) | `bun run e2e:build`, then `bun run e2e` (Playwright, local only): the real app in server mode with the DLL, copied into `frontend/e2e/.run/`; specs in `frontend/e2e/`; S3 specs need `E2E_S3_ENDPOINT`, `E2E_S3_ACCESS_KEY`, `E2E_S3_SECRET_KEY` and are skipped without them; any console warning or error fails the test |
| User guide PDF | `bun run --cwd docs build:pdf` (or `go tool wails3 task docs:pdf`) |

Go tools (wails3, sqlc, golangci-lint) are declared in the `tool (...)` block of `go.mod`, so no separate install is needed. Rust needs the stable toolchain with the `x86_64-pc-windows-msvc` target and the Visual Studio Build Tools (C++ workload); `setup/setup-project.sh` installs them. Go has no committed unit tests, the Rust tests are committed (`rust/tests/`), and the frontend requires at least 95% branch and line coverage per changed file.
