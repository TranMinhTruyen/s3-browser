# Plan sprint-19

## 1. Tóm tắt yêu cầu
- R1: Profile DB đã Connect có Accordion trong thẻ navbar SQL chứa cây đối tượng (SQLite `main` → Tables/Views/Indexes/Triggers; PostgreSQL database → schema → nhóm). Double click table mở tab đặc biệt `TableStructure` (6 tab con Data/Column/Index/Constraint/FK/Source). SQLite lấy dữ liệu thật qua R2, PostgreSQL dùng mock.
- R2: Dựng backend đầu tiên của chế độ SQL cho SQLite: Rust `s3b_db.dll` (FFI 4 hàm, `sqlx` + tokio theo Q4 = A) + Go `internal/modules/db` (load DLL không cgo, handler Wails mới, `DBE<NNN>`), task build DLL vào exe/portable/NSIS. Profile DB (mọi loại: SQLite và PostgreSQL, xem mục 9) lưu vào SQLite của app (goose + sqlc), chọn file bằng hộp thoại native, tuỳ chọn chỉ đọc. Connect thật (chỉ SQLite); Ctrl+E/Execute chạy SQL thật (nhiều câu, dừng ở câu lỗi, autocommit, nút Huỷ, timeout 5 phút); panel kết quả Result 1..n + Messages; SELECT tải theo trang (500 row, tối đa ~16 MiB) qua `cursorId`; có lệnh đọc schema và row của table cho R1.

### Hiện trạng đã kiểm trong code
- Chưa có thư mục `rust/` (Glob `rust/**` rỗng), chưa có `internal/modules/db`, chưa có handler DB. Phải dựng mới Cargo crate.
- FE chế độ SQL (sprint-18): `pages/sql/stores/dbProfileStore.ts` giữ profile trong RAM, khởi tạo từ `mock/dbProfileMock.ts` (2 PG + 1 SQLite mock `mock-sqlite-local`); Connect chỉ đổi cờ (`DbProfiles.tsx` `onClickConnect`, `SqlTabDetail.tsx` `onClickConnect`); Execute/Ctrl+E gọi `runSql` giả trong `utils/sqlToast.ts` (toast); nút chọn file trong `DbProfileModal.tsx` và nút Connect/Import/Refresh ở `SqlHeaderButtonGroup.tsx`, mục Export ở menu gọi `notifyNoBackend`; autocomplete dùng `mock/dbSchemaMock.ts` theo profileId.
- `DbProfiles.tsx` là danh sách virtualize với chiều cao thẻ cố định `CARD_HEIGHT` (không measure) — Q2 = A gộp thẻ và node cây thành một danh sách phẳng.
- `TabStrip` (`components/tabs/TabStrip.tsx`) dùng chung S3/SQL, nhận `renderLabel`/`renderDetail` theo `tabId`, `tabList` là opaque → tab `TableStructure` chỉ cần đổi `sqlTabStore` + `SqlTabPage`, không sửa `TabStrip`.
- Mantine đã cài `^9.8.1`, có `Tree`, `useTree`, `flattenTreeData`, `onLoadChildren` (kiểm trong `node_modules/@mantine/core/lib/components/Tree`); `Splitter` có `orientation: 'vertical'`.
- Go: `golang.org/x/sys v0.50.0` đã có trong `go.mod` (không cần đổi `go.mod`). Hộp thoại chọn file mẫu: `bucket/submodule_auth_files.go` (`Dialog.OpenFile`, `AddFilter`, `AttachToWindow`, `utils.IsDialogCancelled`). Handler nhận `ctx` + huỷ qua `CancellablePromise` trong `callIPC` đã có sẵn (bucket handler) → không cần API Wails mới. Docs https://v3.wails.io/ trả 403: **chưa xác minh** lại, chỉ dùng API đã có trong code.
- Build: `build/windows/Taskfile.yml` đã có task **`build:native` (build Go)** → tên `build:native` cho Rust trong `CLAUDE.md` mục 8 bị trùng nghĩa; plan đặt task Rust là `common:build:dll` trong `build/Taskfile.yml`. NSIS copy file qua macro `wails.files` (chỉ exe) → thêm `File` cho DLL trong `project.nsi`. Workflow `release.yml`/`pre-release.yml` build bằng `go tool wails3 task windows:package`, chưa cài Rust. `build/config.yml` `dev_mode.ignore.dir` chưa bỏ qua `rust`.
- Message FE hiển thị theo key `ipcMessage:<moduleName>.<code>` (`ipcUtils.ts` `showMessages`) → cần `cnst.Db = "db"` và mục `"db"` trong `ipcMessage.json` 7 ngôn ngữ.

### Lệch `CLAUDE.md` cần người dùng cập nhật (luật 7, agent không tự sửa)
- Mục 8 "Lệnh": tên task `build:native` → `common:build:dll` (vì `build:native` đã là task build Go). Driver (`sqlx`) và runtime (`tokio`) đúng `CLAUDE.md`.

### Giả định (planner chọn, reviewer/người dùng có thể phản biện)
- Mỗi profile SQLite đã Connect có **1 connection "chính"** (Go map `profileId → connId`) dùng cho cây và metadata (schema, cột, index, FK, DDL). Mỗi tab (SQL hoặc `TableStructure`) có **connection riêng**, mở lười ở lần chạy đầu, key `tabId`; đổi profile của tab thì đóng connection cũ (FE gọi `CloseDbTab` ngay khi đổi, xem mục 9 P1). Đóng tab → `CloseDbTab`; Disconnect → đóng connection chính và mọi connection tab của profile.
- Một connection tab chỉ có cursor của lần Execute gần nhất; Execute mới tự đóng cursor cũ.
- Lỗi của **từng câu SQL** (cú pháp, ràng buộc, ghi vào DB chỉ đọc) hiện ở tab Messages, **không** toast. Lỗi connection/hệ thống (file không có, không phải SQLite, DLL không load được, timeout) mới toast qua `callIPC`.
- Backend DB không trả message thành công cho CRUD profile / Connect / Disconnect; FE giữ toast hiện có (`sqlNavbar:toast.connected`...) cho cả SQLite và PG mock để một đường code.
- ~~Bảng `db_profiles` không CHECK `db_type`~~ — **thay bằng mục 9 (B3)**: bảng `db_profiles` lưu mọi loại DB, cột `provider` + `config` (JSON) + `secret` (mã hoá); không có cột `version` (optimistic lock) và không CHECK `provider` ở SQL (Go kiểm danh sách hỗ trợ `sqlite`, `postgres`), thêm loại DB mới không cần migration.
- Profile đang Connect: modal sửa khoá ô loại DB, `filePath`, `readOnly` (mục 9 B2); không tự đóng connection.
- Cây SQLite bỏ đối tượng nội bộ `sqlite_%` (vd. `sqlite_autoindex_*`, `sqlite_sequence`).
- Lưới dữ liệu chỉ xem, chiều rộng cột cố định (đề xuất `10rem`), chưa kéo đổi rộng cột.
- Tab Source hiển thị DDL bằng `Code block` của Mantine (không highlight), không sửa `SqlEditor`.
- Timeout (Q10 = B) tính **cho từng lời gọi**: `ExecuteSql`, `OpenTableRows`, `FetchRows` mỗi lần tối đa 5 phút; cursor còn mở giữa các lần tải trang không bị tính giờ. Lệnh metadata (`ConnectDb`, `GetSchemaTree`, `GetTableInfo`) 30 giây. Hai mức không mâu thuẫn vì metadata dùng connection chính, Execute dùng connection tab.
- Giới hạn trang (Q12 = A): `maxPageBytes` = 16 MiB (hằng ở Go, gửi xuống Rust), tính theo tổng độ dài chuỗi ô đã dựng.
- Giữ cursor qua nhiều lời gọi (sqlx): mỗi connection là một **actor tokio** sở hữu `SqliteConnection`; khi câu cuối là SELECT còn dòng, actor giữ stream `fetch` của sqlx ngay trong hàm async của nó (stream mượn connection trong cùng scope, không tự tham chiếu, không `unsafe`) và chờ lệnh `fetch`/`close` qua kênh; lệnh khác tới thì drop stream rồi xử lý. Không còn phương án khác ngang hàng nên không đặt câu hỏi.

## 2. Câu hỏi chưa rõ
| # | Câu hỏi | Phương án | Đề xuất | Trả lời |
|---|---|---|---|---|
| Q1 | Chia branch R1/R2 | A: 2 branch, R2 trước, merge xong mới tách R1<br>B: gộp một branch<br>C: tách sprint | A | **Đã chốt: A** (2026-11-17) |
| Q2 | Dựng Accordion + cây trong danh sách profile | A: danh sách phẳng virtualize (`useTree` + `flattenTreeData`), chevron trên thẻ làm Accordion<br>B: `Accordion` + `<Tree>` đo chiều cao động<br>C: panel cao cố định cuộn lồng | A | **Đã chốt: A** |
| Q3 | Nhiều câu SELECT: Result nào tải tiếp | A: chỉ Result câu cuối (nếu SELECT) giữ cursor; Result trước bị cắt + ghi chú<br>B: mọi Result giữ cursor | A | **Đã chốt: A** |
| Q4 | Driver SQLite trong Rust | A: `sqlx` + raw handle `sqlite3*` (`lock_handle().as_raw_handle()`) + `libsqlite3-sys` cho interrupt và prepare-tail<br>B: rusqlite | A | **Đã chốt: A** (người dùng đổi từ B sang A, 2026-11-17) — đúng `CLAUDE.md` mục 8 |
| Q5 | Lấy CHECK constraint | A: crate `sqlparser`, parse lỗi thì bỏ CHECK<br>B: bộ quét tự viết<br>C: chỉ PK/UNIQUE | A | **Đã chốt: A** |
| Q6 | Ô BLOB hiển thị gì | A: `[BLOB n B]`<br>B: hex 32 byte đầu<br>C: toàn bộ hex | A | **Đã chốt: C** (giới hạn trang theo Q12) |
| Q7 | Execute ở tab chưa Connect | A: tự Connect rồi chạy<br>B: cảnh báo, disable nút | A | **Đã chốt: A** |
| Q8 | Nút Connect/Refresh đầu navbar | A: Refresh nạp lại từ backend; Connect/Import vẫn toast "chưa có backend"<br>B: Connect mở modal kết nối nhanh<br>C: giữ như sprint-18 | A | **Đã chốt: A** |
| Q9 | Autocomplete cho SQLite thật | A: tên table/view từ cây đã nạp<br>B: không autocomplete | A | **Đã chốt: A** |
| Q10 | Timeout Execute / tải trang | A: không timeout, metadata 30s<br>B: Execute timeout 5 phút, quá hạn báo lỗi DBE | A | **Đã chốt: B** — Execute/OpenTableRows/FetchRows 5 phút mỗi lời gọi, metadata 30 giây, quá hạn báo `DBE015` |
| Q11 | Chạy connection rusqlite (đồng bộ) thế nào | — | — | **Không áp dụng do Q4 = A** (tokio vẫn là runtime) |
| Q12 | Giới hạn cứng cho trang có BLOB hex lớn | A: giới hạn byte theo trang ~16 MiB, luôn ≥ 1 dòng, phần còn lại tải khi cuộn<br>B: không giới hạn<br>C: cắt mỗi ô 1 MB | A | **Đã chốt: A** |

Q13, Q14: ĐÃ CHỐT (2026-11-17), xem mục 9.6.

## 3a. Task native (rust-native)
| # | Task | Yêu cầu | File sửa / tạo | Phụ thuộc |
|---|---|---|---|---|
| N1 | Dựng crate `s3b_db` (cdylib + rlib để test), toolchain, FFI 4 hàm bọc `catch_unwind`, runtime tokio dùng chung (tạo một lần ở `s3b_init`, `s3b_call` chạy `block_on` trên runtime đó), protocol JSON, dispatch theo `method`, registry connection (`connId` → kênh gửi lệnh tới actor + raw handle cho interrupt) và registry request (`id` → `connId`) cho `s3b_cancel` | R2 | rust/Cargo.toml (tạo), rust/Cargo.lock (tạo), rust/rust-toolchain.toml (tạo), rust/src/lib.rs, rust/src/ffi.rs, rust/src/runtime.rs, rust/src/dispatch.rs, rust/src/protocol/mod.rs, rust/src/registry.rs (tạo); .gitignore (sửa: `rust/target/`) | - |
| N2 | Driver SQLite bằng **sqlx**: `open`/`close` (`SqliteConnectOptions` `create_if_missing(false)`, `read_only(readOnly)`, `busy_timeout` 5s, kiểm "not a database" bằng `PRAGMA schema_version`); mỗi connection một actor tokio sở hữu `SqliteConnection`; `execute` tách câu theo prepare-tail **lười** (gọi `sqlite3_prepare_v2` trên raw handle cho phần SQL còn lại ngay trước khi chạy câu đó, lấy text câu, finalize, rồi chạy bằng sqlx — nhờ vậy câu sau phụ thuộc câu trước vẫn prepare được; tail chỉ còn khoảng trắng/comment → câu hiện tại là câu cuối), chạy lần lượt, dừng ở câu lỗi đầu; trang đầu tối đa 500 row **và** `maxPageBytes` (luôn ≥ 1 dòng, Q12); cursor theo Q3 (chỉ câu cuối là SELECT giữ stream trong actor); `fetch`; huỷ bằng `sqlite3_interrupt` trên raw handle + cờ huỷ kiểm trước mỗi câu và mỗi dòng; giá trị ô theo kiểu lưu thực của từng ô: NULL → `null`, INTEGER → chuỗi, REAL/TEXT → chuỗi, BLOB → toàn bộ hex `0x...` (Q6 = C) | R2 | rust/src/drivers/mod.rs, rust/src/drivers/sqlite/mod.rs, rust/src/drivers/sqlite/actor.rs, rust/src/drivers/sqlite/split.rs, rust/src/drivers/sqlite/raw.rs (unsafe gom một chỗ), rust/src/drivers/sqlite/value.rs (tạo) | N1 |
| N3 | Đọc schema SQLite (trên actor của connection chính): `schemaTree` (sqlite_schema, bỏ `sqlite_%`), `tableInfo` (PRAGMA table_xinfo, index_list/index_xinfo, foreign_key_list, CHECK bằng `sqlparser` dialect SQLite — parse lỗi thì bỏ CHECK, vẫn trả PK/UNIQUE; DDL), `tableRows` (`SELECT * FROM main."<tên đã escape>"` dùng chung cursor của N2) | R2 | rust/src/drivers/sqlite/schema.rs (tạo), rust/src/dispatch.rs (sửa) | N2 |

Hợp đồng JSON mới (Go ↔ Rust, field camelCase):
- FFI: `s3b_init() -> i32` (0 = ok, tạo runtime tokio + registry, gọi nhiều lần vô hại); `s3b_call(req_ptr: *const u8, req_len: usize, out_ptr: *mut *mut u8, out_len: *mut usize) -> i32` (0 = `out` chứa JSON response, cả khi lỗi nghiệp vụ; khác 0 chỉ khi con trỏ null/panic không ghi được out; **chặn** tới khi xong — Go gọi trong goroutine của handler); `s3b_cancel(id: u64)` (đặt cờ huỷ và gọi `sqlite3_interrupt` của conn đang chạy request đó; id lạ hoặc đã xong thì bỏ qua); `s3b_free(ptr: *mut u8, len: usize)`.
- Request: `{"id": <u64 do Go cấp>, "method": "<tên>", "params": {...}}`. Response: `{"ok": true, "result": {...}}` hoặc `{"ok": false, "error": {"code": "<mã>", "message": "<chi tiết kỹ thuật, không chứa dữ liệu truy vấn>"}}`.
- Method:
  - `open` `{driver: "sqlite", path, readOnly}` → `{connId: u64}`
  - `close` `{connId}` → `{}` (đóng cursor, đóng connection, dừng actor)
  - `execute` `{connId, sql, pageSize, maxPageBytes}` → `{statements: [{index, sql, kind: "rows"|"affected", columns?: [{name, type}], rows?: [[string|null]], cursorId?: u64|null, done?: bool, truncated?: bool, rowsAffected?: i64, elapsedMs, error?: {code, message}}]}` — câu lỗi là phần tử cuối có `error`, `ok` vẫn true; chỉ phần tử cuối (nếu `kind: "rows"` và chưa `done`) có `cursorId`; phần tử trước có `truncated: true` khi còn dòng chưa đọc (Q3) — số dòng có thể < 500 khi chạm `maxPageBytes` (Q12). Câu lỗi prepare: `sql` chỉ chứa text tới hết câu lỗi, không kèm phần SQL còn lại (mục 9 Q1).
  - `fetch` `{connId, cursorId, pageSize, maxPageBytes}` → `{rows, done}` (trang có thể < `pageSize` dòng mà `done=false` khi chạm `maxPageBytes`; done → Rust tự đóng cursor)
  - `schemaTree` `{connId}` → `{schemas: [{name: "main", tables: [string], views: [string], indexes: [{name, table}], triggers: [{name, table}]}]}`
  - `tableInfo` `{connId, schema, table}` → `{columns: [{cid, name, type, notNull, defaultValue, pk}], indexes: [{name, unique, origin, partial, columns}], constraints: [{kind: "PRIMARY KEY"|"UNIQUE"|"CHECK", name, columns, expression}], foreignKeys: [{id, columns, refTable, refColumns, onUpdate, onDelete}], ddl}`
  - `tableRows` `{connId, schema, table, pageSize, maxPageBytes}` → giống một phần tử `kind: "rows"` của `execute`
- Mã lỗi Rust → Go: `invalidRequest` → DBE001, `openFailed` → DBE002, `notADatabase` → DBE003, `connNotFound` → DBE004, `cursorNotFound` → DBE005, `sqlError` → DBE006 (chỉ dùng trong `statements[].error`, hiện ở Messages), `tableNotFound` → DBE007, `internal` (panic, actor chết) → DBE008, `cancelled` → Go xét `ctx.Err()`: `context.Canceled` → `Result=false` im lặng; `context.DeadlineExceeded` → DBE015.

Crate: `tokio` (features `rt-multi-thread`, `sync`, `macros`), `sqlx` (`default-features = false`, features `sqlite`, `runtime-tokio`; libsqlite3 bundled), `libsqlite3-sys = "*"` (version `*` để Cargo tự dùng đúng bản sqlx kéo vào, nâng sqlx không phải sửa tay; không bật feature build riêng, chỉ để gọi `sqlite3_interrupt`/`sqlite3_prepare_v2`/`sqlite3_finalize`), `futures-util` (`StreamExt` đọc stream), `serde` + `serde_json`, `sqlparser`. `[profile.release] panic = "unwind"`. API `lock_handle().as_raw_handle()` và feature bundled của sqlx **chưa xác minh** trên phiên bản sẽ dùng — rust-native kiểm docs.rs trước khi code N2; không lấy được handle an toàn thì dừng và báo về (luật 6).

An toàn: mọi hàm export bọc `catch_unwind`; panic trong task tokio thành `JoinError` → `internal`; mọi `unsafe` gom trong `drivers/sqlite/raw.rs` có comment `// SAFETY:`; raw handle cho interrupt chỉ dùng khi connection còn trong registry (xoá khỏi registry dưới lock trước khi đóng, `s3b_cancel` đọc handle dưới cùng lock) để không gọi interrupt trên handle đã đóng; chỉ interrupt khi request đang chạy trên connection đúng là `id` cần huỷ (mục 9 B4); không `unwrap`/`expect` ngoài `#[cfg(test)]`.

Dùng lại: không có code Rust sẵn. Hằng `pageSize` 500 và `maxPageBytes` 16 MiB do Go gửi (một chỗ khai báo).  |  Hiệu năng: kết quả SELECT có thể 100.000+ row → đọc theo trang qua stream của sqlx, không collect toàn bộ; trang dừng sớm ở 16 MiB để payload FFI/JSON có trần; mỗi conn một actor nên tab này chạy lâu không chặn tab khác hay cây (connection chính riêng); prepare-tail chỉ prepare rồi finalize, chi phí nhỏ so với chạy câu; `elapsedMs` đo trong Rust; huỷ không chờ hàng đợi của actor (`sqlite3_interrupt` gọi từ thread của `s3b_cancel`); dựng hex BLOB bằng một lần cấp phát `String::with_capacity(2n+2)`.

Test Rust (rust-tester, có commit):
| Task | Hàm / file cần test | Case cần phủ |
|---|---|---|
| N1 | rust/src/protocol, rust/src/dispatch.rs, rust/src/ffi.rs, rust/src/registry.rs, rust/src/runtime.rs | parse request đúng / JSON sai → `invalidRequest` / method lạ → `invalidRequest` / thiếu param / serialize response ok và lỗi đúng camelCase / `s3b_init` gọi hai lần / `s3b_call` với con trỏ null trả mã ≠ 0 không panic / buffer trả về giải phóng qua `s3b_free` / panic trong handler bị `catch_unwind` → `internal` / panic trong task tokio → `internal` / `s3b_cancel` id lạ không lỗi |
| N2 | rust/src/drivers/sqlite/actor.rs, split.rs, raw.rs, value.rs | open file tạm thành công / file không tồn tại → `openFailed` (không tạo file) / file text → `notADatabase` / readOnly + INSERT → `sqlError` / SELECT 1.201 row → trang 500, `fetch` 500, `fetch` 201 + `done` / SELECT rỗng → `done` ngay / INSERT/UPDATE/DELETE trả `rowsAffected` / DDL / nhiều câu → nhiều `statements` / câu 2 lỗi → dừng, không chạy câu 3 / `;` trong chuỗi, comment `--` và `/* */`, thân `CREATE TRIGGER ... BEGIN ...; END;` / `CREATE TABLE t(...); INSERT INTO t ...; SELECT * FROM t` (câu sau phụ thuộc câu trước) / SQL chỉ có khoảng trắng-comment / câu cuối theo sau là comment vẫn được coi là câu cuối / NULL, số nguyên > 2^53 (chuỗi), REAL, TEXT unicode, cột không khai báo kiểu chứa nhiều kiểu lưu khác nhau, BLOB rỗng và BLOB vài KB → hex đầy đủ / Q3: `SELECT 600 row; SELECT 600 row` → câu 1 `truncated`, không cursor; câu 2 có cursor / Q12: blob lớn → trang ngắt sớm < 500 dòng, `done=false`, `fetch` tiếp đủ dòng; một dòng vượt `maxPageBytes` → trang vẫn có 1 dòng / Execute mới đóng cursor cũ → `fetch` cursor cũ → `cursorNotFound` / `close` khi cursor đang mở → gọi sau → `connNotFound` / metadata trên connection chính chạy được khi tab có cursor mở / huỷ CTE đệ quy chạy lâu → `cancelled` và conn vẫn dùng được sau đó / huỷ khi đang `fetch` / `s3b_cancel` đúng lúc `close` không crash |
| N3 | rust/src/drivers/sqlite/schema.rs | DB có table, view, index (kể cả `sqlite_autoindex_*` bị bỏ), trigger / DB rỗng → các nhóm rỗng / `tableInfo`: cột PK nhiều cột, NOT NULL, DEFAULT, UNIQUE, CHECK cột và CHECK table, FK có ON DELETE / DDL `sqlparser` không parse được → không có CHECK, vẫn có PK/UNIQUE / table tên có dấu `"` và khoảng trắng / table không tồn tại → `tableNotFound` / `tableRows` phân trang như N2 |

## 3. Task backend (go-backend)
| # | Task | Yêu cầu | File sửa / tạo | Phụ thuộc |
|---|---|---|---|---|
| B1 | Build DLL vào mọi bản: task `common:build:dll` (`cargo build --release --target x86_64-pc-windows-msvc` trong `rust/`) chạy trước build Go và copy `s3b_db.dll` cạnh exe (`OUT_DIR`/`BIN_DIR`, nên vào cả portable); NSIS `File` DLL; workflow cài Rust target; dev mode bỏ qua `rust/`; link CRT tĩnh (`rust/.cargo/config.toml` `crt-static`, nằm trong `sources` của `build:dll`) để DLL không cần VCRUNTIME140 (mục 9 B1) | R2 | build/Taskfile.yml (sửa), build/windows/Taskfile.yml (sửa: deps `build:native`, `build:debug` + bước copy), build/windows/nsis/project.nsi (sửa: `File "...\s3b_db.dll"` sau `wails.files`), build/config.yml (sửa: `dev_mode.ignore.dir` thêm `rust`), .github/workflows/release.yml, .github/workflows/pre-release.yml (sửa: bước cài Rust stable + target msvc, cache `rust/target`), rust/.cargo/config.toml (tạo, vòng 2) | N1 |
| B2 | Lưu profile DB **mọi provider** (sửa ở vòng 2, mục 9 B3): migration `db_profiles` (`provider`, `config` JSON, `secret` mã hoá qua `utils.KeyManager`), query sqlc, model, submodule CRUD (Go kiểm provider ∈ {`sqlite`, `postgres`}, chỉ giữ field config của provider, mã hoá secret) + chọn file `.db` bằng hộp thoại native | R2 | internal/pkg/db/schemas/000003_db_profiles.sql (tạo; vòng 2 sửa thẳng), internal/pkg/db/queries/dbprofile/{insert_db_profile,update_db_profile_by_id,delete_db_profile_by_id,select_all_db_profile,select_db_profile_by_id}.sql (tạo; vòng 2 sửa), sqlc.yaml (sửa: thêm `internal/pkg/db/queries/dbprofile`), models/db/db_profile_input.go, models/db/db_profile_output.go (tạo; vòng 2 sửa), models/alias.go (sửa), internal/modules/db/submodule_profile_mng.go (tạo; vòng 2 sửa), internal/modules/db/module.go + internal/app.go (vòng 2: truyền `km` vào `db.NewModule`) | - |
| B3 | Lớp gọi DLL không cgo: load `s3b_db.dll` theo đường dẫn tuyệt đối cạnh exe (`windows.LoadLibraryEx` + `LOAD_LIBRARY_SEARCH_APPLICATION_DIR`), lười ở lần dùng đầu, `s3b_init` một lần; `call(ctx, method, params, out)` cấp `id` tăng dần, goroutine nghe `ctx.Done()` → `s3b_cancel`, `s3b_free` sau khi copy; map mã lỗi Rust → DBE, `cancelled` + `ctx.Err() == DeadlineExceeded` → DBE015; interface `nativeCaller` để test bằng fake | R2 | internal/modules/db/native_windows.go, internal/modules/db/native_other.go (`//go:build !windows`, trả lỗi DBE009), internal/modules/db/submodule_native_mng.go (tạo) | N1 |
| B4 | Module + handler DB: Connect/Disconnect (map profile → conn chính, tab → conn riêng, `sync.RWMutex`, đóng ngoài lock), Execute/FetchRows/OpenTableRows/CloseDbTab (timeout 5 phút mỗi lời gọi, gửi `pageSize` 500 + `maxPageBytes` 16 MiB), GetSchemaTree/GetTableInfo/ConnectDb (timeout 30 giây), message code, wiring app/main, Shutdown đóng mọi conn | R2 | internal/modules/db/module.go, internal/modules/db/submodule_conn_mng.go, internal/modules/db/submodule_query_mng.go (tạo), models/db/query_input.go, models/db/query_output.go, models/db/schema_output.go (tạo), models/alias.go (sửa), internal/handlers/db_handler.go (tạo), internal/pkg/cnst/common.go (sửa: `Db = "db"`), internal/app.go (sửa), main.go (sửa: `RegisterService(DbHandler)`), frontend/src/locales/{en,vi,ja,zh-CN,zh-TW,ru,de}/messages/ipcMessage.json (sửa: mục `db`) | B2, B3, N2, N3 |

Binding mới (`DbHandler`): `GetAllDbProfile()` (trả `id, name, color, provider, config, hasSecret`, **không** trả secret), `CreateDbProfile(input)` và `UpdateDbProfileById(input)` (nhận `name, color, provider, config, secret`), `DeleteDbProfileById(input)`, `ChooseDbFile()`, `ConnectDb(ctx, {profileId})` (chỉ `provider = sqlite`, khác → DBE001), `DisconnectDb({profileId})`, `GetSchemaTree(ctx, {profileId})`, `GetTableInfo(ctx, {profileId, schema, table})`, `ExecuteSql(ctx, {profileId, tabId, sql})`, `OpenTableRows(ctx, {profileId, tabId, schema, table})`, `FetchRows(ctx, {tabId, cursorId})`, `CloseDbTab({tabId})`.

Timeout (Q10 = B): hằng trong `modules/db` — `queryTimeout = 5 * time.Minute` cho `ExecuteSql`, `OpenTableRows`, `FetchRows`; `metaTimeout = 30 * time.Second` cho `ConnectDb`, `GetSchemaTree`, `GetTableInfo`. Bọc `context.WithTimeout` + `context.AfterFunc(m.app.Context(), cancel)` theo quy ước. Hết giờ → Go gọi `s3b_cancel` → Rust trả `cancelled` → Go trả DBE015 (không im lặng, khớp bẫy `isCallCanceled` trong memory). Người dùng bấm Huỷ trước đó vẫn im lặng.

Message code (`modules/db/module.go`, đủ key 7 ngôn ngữ) — **danh sách cuối**:
- DBE001 Invalid request to the database engine.
- DBE002 Cannot open database file {path}.
- DBE003 The file is not a SQLite database.
- DBE004 The connection was closed. Connect again.
- DBE005 The result is no longer available. Run the query again.
- DBE006 SQL error (detail = lỗi SQLite; dùng trong Messages, không toast).
- DBE007 Table [{name}] does not exist.
- DBE008 Database engine error.
- DBE009 The database engine (s3b_db.dll) could not be loaded.
- DBE010 Cannot save database profile [{name}]. (vòng 2: dùng cả cho provider không hỗ trợ / config sai / mã hoá secret lỗi, chi tiết ở `errorDetail`)
- DBE011 Cannot delete database profile [{name}].
- DBE012 Cannot load database profiles.
- DBE013 Cannot open the file dialog.
- DBE014 Profile [{name}] is not connected.
- DBE015 The operation timed out after {timeout}. (param `timeout` là chuỗi do Go định dạng, vd. `5m`/`30s`, dùng chung cho Execute và metadata)

Migration / sqlc: **có** — schema cuối sau vòng 2 (sửa thẳng `000003_db_profiles.sql`, chưa phát hành): `id TEXT PK`, `name TEXT NOT NULL CHECK(length<=100)`, `color TEXT CHECK(length<=20)`, `provider TEXT NOT NULL`, `config TEXT NOT NULL` (JSON), `secret TEXT` (NULL khi không có, mã hoá `KeyManager`), `created_at`, `updated_at` (cùng định dạng `strftime('%Y-%m-%dT%H:%M:%fZ','now')`), index `name`; Down `DROP TABLE`; SQL leading commas. Bỏ `db_type`, `file_path`, `read_only`.  |  Cần sinh lại bindings: **có**  |  Event: không (tải trang theo yêu cầu FE, không đẩy event).

Dùng lại: `bucket/call_helper.go` (`withCallContext`, `isCallCanceled`) — chép mẫu vào package db (unexported, không import chéo module); mẫu hộp thoại `bucket/submodule_auth_files.go`; `utils.IsDialogCancelled`, `utils.GenerateUUID`; `models.NewOutput`/`ThrowError`/`NewParamsMessage`; `sqlc.New(db)` như `profile.NewModule`; pattern `*_other.go` như `setting/autostart_other.go`; vòng 2: mẫu `auth_config`/`auth_secret` + `seal`/`open` của `profile/submodule_auth_mng.go` và `km` đã tạo ở `internal/app.go`.  |  Hiệu năng: Go chỉ chuyển tiếp trang (không gom trang); trang tối đa ~16 MiB dữ liệu ô → giải mã JSON từ Rust thẳng vào struct output, không qua `map[string]any`, giữ `[][]*string`; không log SQL/dữ liệu (chỉ method, connId, mã lỗi, thời gian); map conn dùng RWMutex, đóng conn ngoài lock; mỗi call native chặn một goroutine (không giới hạn thêm vì FE chỉ có một Execute/tab); danh sách profile nhỏ, `GetAllDbProfile` không giải mã secret (chỉ xét cột `secret` khác NULL).

Test hồi quy Go (go-tester, test tạm):
| Task | Function sửa | Nơi gọi | Kịch bản hồi quy (hành vi cũ phải giữ) |
|---|---|---|---|
| B2 | internal/pkg/db/migration.go: RunMigrations (không sửa code, thêm migration 000003) | internal/app.go: NewApp | DB cũ ở version 2 có `connection_profiles` → sau migrate version 3, dữ liệu profile S3 giữ nguyên, tạo đúng 1 file `.bak-*`; DB mới (version 0) không backup; Down 000003 xoá bảng; bảng có đúng cột `provider`, `config`, `secret` |
| B2 | internal/modules/db/submodule_profile_mng.go (mới, vòng 2 sửa) | module.go, db_handler.go | tạo/sửa/xoá/đọc tất cả profile `sqlite` và `postgres`; provider khác → DBE010; sửa id không tồn tại → DBE010; secret lưu mã hoá (cột khác plaintext), `GetAllDbProfile` không trả secret, `hasSecret` đúng; đổi provider giữ `id`, config cũ bị bỏ; huỷ hộp thoại chọn file → body rỗng, không message (cần `-tags portable` cho KeyManager) |
| B3 | internal/modules/db/submodule_native_mng.go (mới) | submodule_conn_mng.go, submodule_query_mng.go | fake `nativeCaller`: response ok / lỗi từng mã → đúng DBE / `cancelled` + ctx Canceled → `Result=false` không message / `cancelled` + ctx DeadlineExceeded → DBE015 / ctx huỷ giữa chừng gọi `cancel(id)` / DLL không load được → DBE009 và S3 vẫn chạy |
| B4 | internal/app.go: NewApp, Shutdown | main.go | NewApp vẫn tạo đủ 5 handler cũ + DbHandler; Shutdown vẫn huỷ download/upload, ngắt S3, reset event, đóng DB app, và đóng conn DB (không panic khi DLL chưa load) |
| B4 | internal/pkg/cnst/common.go (thêm `Db`) | modules/db | các module name cũ không đổi |
| B4 | internal/modules/db/submodule_conn_mng.go, submodule_query_mng.go (mới) | module.go, db_handler.go | Connect hai lần không mở thêm conn / Disconnect đóng conn chính + conn tab của profile / Execute tab đổi profile đóng conn cũ / CloseDbTab tab không có conn → ok / FetchRows tab đã đóng → DBE004 / xoá profile đang Connect đóng conn trước / Execute dùng timeout 5 phút, GetSchemaTree dùng 30 giây (fake kiểm deadline ctx) / request gửi `pageSize` 500 và `maxPageBytes` 16 MiB |

## 4. Task frontend (react-frontend)
| # | Task | Yêu cầu | File sửa / tạo | Phụ thuộc |
|---|---|---|---|---|
| F1 | Profile DB thật (vòng 2: **mọi provider**, mục 9 B3): store nạp toàn bộ profile (SQLite + PG) từ backend, bỏ danh sách profile mock trong RAM (PG chỉ còn Connect/cây/dữ liệu mock); lưu/sửa/xoá mọi provider qua backend (`provider` + `config` + `secret`, store không giữ mật khẩu, chỉ `hasSecret`); modal: nút chọn file gọi `ChooseDbFile`, công tắc "Mở chỉ đọc" (chỉ SQLite, mặc định tắt), modal sửa cho đổi provider; profile đang Connect → khoá ô loại DB, `filePath`, `readOnly` kèm gợi ý "ngắt kết nối để sửa" (mục 9 B2); nạp danh sách khi vào chế độ SQL; Refresh ở đầu navbar nạp lại danh sách từ backend; Connect/Import ở đầu navbar giữ toast "chưa có backend" (Q8 = A) | R2 | frontend/src/pages/sql/stores/dbProfileStore.ts, frontend/src/pages/sql/mock/dbProfileMock.ts, frontend/src/pages/sql/modals/dbProfile/DbProfileModal.tsx, frontend/src/pages/sql/modals/dbProfile/dbProfileSchema.ts, frontend/src/pages/sql/navbar/SqlHeaderButtonGroup.tsx, frontend/src/pages/sql/SqlWorkspace.tsx (sửa); locales `dbProfileModal.json` 7 ngôn ngữ | B4 + bindings |
| F2 | Connect/Disconnect/Xoá thật cho SQLite (PG giữ cờ giả): menu navbar, double click thẻ, nút Connect trên tab SQL; Disconnect/xoá đóng conn ở backend | R2 | frontend/src/pages/sql/navbar/DbProfiles.tsx, frontend/src/pages/sql/components/SqlTabDetail.tsx (phần connect) (sửa) | F1 |
| F3 | Lưới dữ liệu dùng chung: virtualize hàng + cột (`@tanstack/react-virtual`, px × `useUiScale` + `useRemeasureOnScale`), cột số thứ tự, ô `NULL` hiển thị khác (chữ nghiêng màu dimmed), cuộn ngang, gọi `onEndReached` khi gần cuối (một lần mỗi lượt tải); ô một dòng có ellipsis, chuỗi rất dài (hex BLOB) chỉ đưa vào DOM tối đa một số ký tự đủ lấp ô (giá trị đầy đủ vẫn giữ trong dữ liệu) để layout không phải đo chuỗi hàng MB | R2 | frontend/src/components/display/dataGrid/DataGrid.tsx, frontend/src/components/display/dataGrid/DataGrid.module.css (tạo) | - |
| F4 | Execute thật: Ctrl+E/nút Execute gọi `ExecuteSql` (SQLite) hoặc `runSql` giả (PG); profile SQLite chưa Connect thì tự Connect rồi chạy (Q7 = A, Connect lỗi thì dừng); nút Huỷ khi đang chạy (AbortController → `callIPC` signal); panel kết quả dưới editor (`Splitter` dọc): tab Result 1..n (DataGrid; chỉ Result câu cuối tải tiếp bằng `FetchRows`, Result có `truncated` hiện ghi chú "chỉ hiện N dòng đầu" với N = số dòng thực nhận — Q3, Q12) + tab Messages (câu, số dòng, thời gian, lỗi); timeout DBE015 hiện toast qua `callIPC`; đóng tab gọi `CloseDbTab`; autocomplete SQLite lấy tên table/view từ cây đã nạp trong `dbTreeStore` (Q9 = A, có từ branch R1; ở branch R2 SQLite chưa có autocomplete) | R2 | frontend/src/pages/sql/components/SqlTabDetail.tsx, frontend/src/pages/sql/components/SqlTabActionBar.tsx (sửa), frontend/src/pages/sql/components/sqlResult/SqlResultPanel.tsx, frontend/src/pages/sql/components/sqlResult/SqlMessageList.tsx, frontend/src/pages/sql/hooks/useSqlRunner.ts (tạo), frontend/src/pages/sql/utils/sqlToast.ts (sửa: `runSql` chỉ còn cho PG), frontend/src/pages/sql/stores/sqlTabStore.ts (sửa: `closeTab` gọi `CloseDbTab`); locales `sqlTab.json` 7 ngôn ngữ | F2, F3 |
| F5 | Nguồn dữ liệu cây/cấu trúc: SQLite qua `GetSchemaTree`/`GetTableInfo`/`OpenTableRows`/`FetchRows`, PG qua mock mới cạnh `dbProfileMock.ts` (database → schema → nhóm, có table ≥ 30 cột × ≥ 10.000 row sinh lười theo trang); store cây: trạng thái mở Accordion theo profile, cây đã nạp, `dropProfile`; nối autocomplete SQLite với tên table/view của cây (Q9 = A) | R1 | frontend/src/pages/sql/mock/dbObjectMock.ts (tạo), frontend/src/pages/sql/utils/dbObjectSource.ts (tạo), frontend/src/pages/sql/stores/dbTreeStore.ts (tạo), frontend/src/pages/sql/components/SqlTabDetail.tsx (sửa: nguồn autocomplete) | R2 đã merge |
| F6 | Cây trong navbar (Q2 = A): thẻ profile và node đang mở gộp thành một danh sách phẳng virtualize (`useTree` + `flattenTreeData`), chevron trên thẻ làm Accordion; chỉ profile đã Connect mới mở được; icon lucide riêng cho database/schema/nhóm/table/view/index/trigger; click đơn chọn, double click table mở tab; Disconnect/xoá → đóng Accordion, bỏ cây, đóng tab `TableStructure` của profile; chọn tab gắn profile đã Connect → tự mở Accordion (không đóng cái khác) | R1 | frontend/src/pages/sql/navbar/DbProfiles.tsx, frontend/src/pages/sql/navbar/DbProfileItem.tsx (sửa), frontend/src/pages/sql/navbar/DbTreeRow.tsx (tạo); locales `sqlNavbar.json` 7 ngôn ngữ | F5 |
| F7 | Tab `TableStructure`: `sqlTabStore` thêm loại tab `table` (`openTableTab` chuyển tới tab đã có, `closeProfileTables` luôn chừa ≥ 1 tab SQL); nhãn tab icon khác + tên table; nội dung 6 tab con (Data dùng DataGrid + tải trang, Column/Index/Constraint/FK dùng DataGrid, Source dùng `Code block`) | R1 | frontend/src/pages/sql/stores/sqlTabStore.ts, frontend/src/pages/sql/SqlTabPage.tsx, frontend/src/pages/sql/components/SqlTabLabel.tsx (sửa), frontend/src/pages/sql/components/tableStructure/TableStructureDetail.tsx, frontend/src/pages/sql/components/tableStructure/TableDataView.tsx (tạo); locale mới `pages/sql/tableStructure.json` + đăng ký `resource.ts` 7 ngôn ngữ | F3, F5 |

i18n key mới (đủ 7 ngôn ngữ): `dbProfileModal`: `form.label.readOnly`, `form.description.readOnly`, `form.description.disconnectToEdit` (vòng 2, B2); `sqlTab`: `tooltip.cancel`, `result.title` (`Result {{n}}`), `result.messages`, `result.firstRowsOnly` (`{{count}}`), `result.loading`, `message.rowsAffected`, `message.rowsReturned`, `message.elapsed`, `message.cancelled`; `sqlNavbar`: `tree.tables`, `tree.views`, `tree.indexes`, `tree.triggers`, `tree.loading`, `tree.empty`, `tree.loadError`; namespace mới `tableStructure`: `tab.data|column|index|constraint|fk|source`, tiêu đề cột của Column/Index/Constraint/FK, `nullValue`; `ipcMessage.db.DBE001–DBE015`. Key `sqlNavbar:toast.noBackend` giữ (Connect/Import đầu navbar và mục Export vẫn dùng, Q8 = A).

Dùng lại: `callIPC` + `invalidateLoads`; `createAppStore`; `TabStrip` (không sửa); `useUiScale`/`useRemeasureOnScale`; `ActionIcon`, `Button`, `TruncatedText`, `StatusDot`, `Combobox`, `SwitchInput`/`CheckBoxInput`, `FieldInput`; `Splitter` (như `SqlWorkspace`); Mantine `useTree` + `flattenTreeData`; mẫu menu chung + `data-profile-key` trong `DbProfiles.tsx`; mẫu nạp list của `s3/stores/profileStore.ts`; nguồn autocomplete hiện có của `dbSchemaMock.ts` (chỉ đổi dữ liệu đầu vào cho SQLite).  |  Hiệu năng: row kết quả (tới 100.000+, mỗi trang tối đa ~16 MiB) **không** để trong store zustand+immer (immer freeze O(n) mỗi lần thêm trang) — giữ trong state/ref của hook `useSqlRunner`/`TableDataView`, nối trang bằng mảng mới; DataGrid virtualize 2 chiều, overscan nhỏ, ô chỉ render phần đầu chuỗi dài; `onEndReached` chặn gọi trùng khi đang tải và không dựa vào số dòng trang = 500 (trang có thể ngắn hơn mà chưa `done`); cây virtualize chung với danh sách profile; selector hẹp/`useShallow`; tree theo profile nạp một lần khi mở Accordion, Refresh mới nạp lại; mock PG sinh row theo trang, không tạo sẵn 10.000 object.

Test frontend (react-tester):
| Task | File cần test | Case cần phủ |
|---|---|---|
| F1 | stores/dbProfileStore.ts, modals/dbProfile/DbProfileModal.tsx, dbProfileSchema.ts, navbar/SqlHeaderButtonGroup.tsx, SqlWorkspace.tsx, mock/dbProfileMock.ts | nạp profile: callIPC trả body / null / rỗng, gồm cả SQLite và PG từ backend (không còn PG mock trong RAM); tạo/sửa SQLite và PG gọi đúng binding với `provider` + `config` + `secret`, lỗi giữ modal; store không giữ mật khẩu, `hasSecret`; sửa đổi provider giữ `id`; profile đang Connect: ô loại DB/`filePath`/`readOnly` bị khoá + hiện gợi ý, chưa Connect thì không khoá; chọn file: trả path / rỗng (huỷ) / null; readOnly mặc định tắt, chỉ hiện với SQLite, đổi loại DB; Refresh nạp lại; Connect/Import vẫn toast `noBackend` |
| F2 | navbar/DbProfiles.tsx, components/SqlTabDetail.tsx | Connect SQLite ok / lỗi (không đổi cờ) / PG giả; Disconnect SQLite gọi backend; xoá profile đang Connect (2 confirm) gọi backend, lỗi không xoá khỏi store |
| F3 | components/display/dataGrid/DataGrid.tsx | rỗng / có row / ô null / chuỗi rất dài bị cắt khi render / nhiều cột cuộn ngang / `onEndReached` gọi 1 lần, không gọi khi `hasMore=false` hoặc đang tải / đổi cỡ giao diện remeasure |
| F4 | hooks/useSqlRunner.ts, sqlResult/SqlResultPanel.tsx, SqlMessageList.tsx, SqlTabActionBar.tsx, SqlTabDetail.tsx, utils/sqlToast.ts, stores/sqlTabStore.ts | chạy selection vs toàn bộ; SQL rỗng; chưa Connect → tự Connect ok rồi chạy / Connect lỗi thì không chạy; một/nhiều câu; Result `truncated` hiện ghi chú với đúng số dòng (kể cả < 500), không tải tiếp; Result cuối tải tiếp đến `done`, kể cả trang ngắn hơn 500 mà chưa `done`; câu lỗi dừng và hiện Messages; affected rows; FetchRows lỗi; timeout (callIPC trả null); Huỷ (signal abort, không toast); chạy lại huỷ lượt cũ (kết quả cũ settle muộn bị bỏ); PG vẫn toast giả; đóng tab gọi `CloseDbTab`; đổi profile của tab gọi `CloseDbTab` (mục 9 P1) |
| F5 | mock/dbObjectMock.ts, utils/dbObjectSource.ts, stores/dbTreeStore.ts, components/SqlTabDetail.tsx | SQLite: binding trả body / null; PG: mock đúng cấu trúc, trang row cuối `done`; mở/đóng/tự mở Accordion; `dropProfile`; reset; autocomplete SQLite có tên table/view sau khi cây nạp, chưa nạp thì rỗng |
| F6 | navbar/DbProfiles.tsx, DbProfileItem.tsx, DbTreeRow.tsx | chưa Connect không mở được; mở nhiều profile; cây SQLite/PG đúng cấp; click chọn; double click table mở tab, view/index/trigger không làm gì; Disconnect đóng Accordion + tab table; chọn tab tự mở Accordion; đang tải / lỗi / rỗng |
| F7 | stores/sqlTabStore.ts, SqlTabPage.tsx, SqlTabLabel.tsx, tableStructure/TableStructureDetail.tsx, TableDataView.tsx | `openTableTab` mới / đã có → chuyển tab; `closeProfileTables` khi chỉ còn tab table → thêm tab SQL; moveTab/closeTab hành vi cũ giữ; nhãn tab SQL cũ không đổi; 6 tab con; GetTableInfo trả null; Data tải trang |
| Hồi quy | toàn bộ `vitest run` | test sprint-18 (`SqlTabDetail`, `DbProfiles`, `DbProfileModal`, `sqlTabStore`, `sqlToast`...) và S3 (`TabStrip`, `ConnectionProfiles`...) phải qua; test cũ chỉ sửa khi plan đổi hành vi (bỏ `mock-sqlite-local` và danh sách PG mock trong RAM, Connect/Execute thật cho SQLite) và ghi rõ trong báo cáo |

## 5. Branch
| Branch | Yêu cầu | Task | Ghi chú |
|---|---|---|---|
| SP-19/sqlite_native_backend | R2 | N1, N2, N3, B1, B2, B3, B4, F1, F2, F3, F4 | Làm trước; PR vào `SP-19/release`; vòng 2 sửa theo mục 9 trên cùng branch |
| SP-19/db_object_tree | R1 | F5, F6, F7 | Chỉ tách sau khi người dùng merge PR R2 vào `SP-19/release` (Q1 = A, ngoại lệ "không chờ merge"); chỉ có FE |

Trước khi đặt tên, `git-flow` kiểm `git ls-remote --heads origin 'SP-19/*'` (bẫy trùng tên trong memory).

## 6. Thứ tự thực hiện (luôn tuần tự, xong branch này mới sang branch sau)
Với từng branch trong bảng trên:
1. Tách branch từ `origin/SP-19/release` (git-flow; release branch tạo một lần đầu sprint từ `origin/staging`)
2. Native: N1 → N2 → N3, rồi Rust test (rust-tester) + `cargo fmt --check`, `cargo clippy --target x86_64-pc-windows-msvc --all-targets -- -D warnings`, `cargo build --release --target x86_64-pc-windows-msvc`
3. Backend: B1 → B2 → B3 → B4
4. `go tool sqlc generate`, rồi `go tool wails3 generate bindings -clean=true -ts` (skill `wails3-bindings`)
5. Go test hồi quy (go-tester, test tạm, xoá sau khi chạy)
6. Frontend: theo thứ tự số task của branch
7. FE test (react-tester) → verify → review → commit, push, PR vào `SP-19/release` (git-flow)

Vòng 2 của branch R2 (sau review vòng 1) chạy theo thứ tự ở mục 9.3.

Sau PR R2: orchestrator dừng, chờ người dùng merge. Branch R1 tách sau đó; phải chạy lại `common:build:dll` và sinh lại bindings (thư mục `frontend/bindings` bị gitignore) trước khi làm F5.

## 7. Rủi ro
| # | Rủi ro | Mức độ | Cách giảm thiểu |
|---|---|---|---|
| 1 | Sprint có 14 task (3 N, 4 B, 7 F) cộng hạ tầng build mới — vượt ngưỡng ~10, branch R2 có 11 task, vòng review tốn kém | high | Đã tách 2 branch (Q1 = A); review R2 theo lớp Rust → Go → FE |
| 2 | Huỷ câu đang chạy và tách câu theo prepare-tail với sqlx cần raw handle `sqlite3*` (`lock_handle().as_raw_handle()`) + `libsqlite3-sys` — **chưa xác minh** API trên bản sqlx sẽ dùng; có `unsafe`; huỷ future sqlx không dừng ngay worker SQLite nên phải dựa vào `sqlite3_interrupt` | high | rust-native kiểm API trước khi code N2, không lấy được handle an toàn thì dừng và báo về; `unsafe` gom một file có `// SAFETY:`; test huỷ bằng CTE đệ quy và huỷ khi đang `fetch` |
| 3 | `libsqlite3-sys` khai báo trực tiếp lệch phiên bản với bản sqlx kéo vào → Cargo báo lỗi khi resolve (`links = "sqlite3"` chỉ cho một bản); lỗi lúc build, không lọt vào bản phát hành | low | Khai báo `libsqlite3-sys = "*"` để Cargo hợp nhất với bản sqlx dùng (crate không publish nên `*` hợp lệ); kiểm `cargo tree -i libsqlite3-sys` chỉ ra một bản, không bật feature build riêng |
| 4 | Gọi `sqlite3_interrupt` lên handle đã đóng (cancel tới đúng lúc `close`) gây use-after-free | high | Handle chỉ đọc dưới lock của registry; `close` xoá khỏi registry dưới cùng lock trước khi đóng connection; test cancel đồng thời với close |
| 5 | Tên task `build:native` trong `CLAUDE.md` mục 8 trùng task Go đã có ở `build/windows/Taskfile.yml` | low | Đặt `common:build:dll`; báo người dùng sửa `CLAUDE.md` (luật 7) |
| 6 | Cursor đang mở giữ read transaction: ở journal mode `delete`, tab khác ghi vào cùng file bị `database is locked` | medium | `busy_timeout` 5s; Execute mới/đóng tab/Disconnect đóng cursor; cursor `done` tự đóng; ghi chú trong report là hành vi của SQLite |
| 7 | CI `windows-latest` chưa cài Rust target/cargo cache; build sqlx + libsqlite3 bundled + `sqlparser` lần đầu mất vài phút — **chưa xác minh** runner có sẵn rustup | medium | B1 thêm bước cài toolchain + cache `rust/target`; người dùng cho chạy thử workflow trên `SP-19/release` hoặc kiểm lúc PR release → staging |
| 8 | DLL thiếu/không load được (máy người dùng, dev mode) làm hỏng cả app | medium | Load lười, lỗi → DBE009 chỉ ở chế độ SQL, S3 không ảnh hưởng; task build copy DLL vào `build/bin` cho dev |
| 9 | Panic qua biên FFI / trong task tokio làm crash app | high | `catch_unwind` ở mọi hàm export, `JoinError` → `internal`; không `unwrap`/`expect` ngoài test; clippy `-D warnings` |
| 10 | Row lớn trong store immer làm UI giật khi tải trang | medium | Row giữ ngoài zustand (xem Hiệu năng F4/F7); DataGrid virtualize 2 chiều |
| 11 | Test FE cho lưới/cây virtualize trong jsdom (kích thước 0) khó đạt C1 95% | medium | Theo cách test sẵn có của `DbProfiles.test.tsx` (mock kích thước/virtualizer); tách hàm thuần (map cây, format ô) để test riêng |
| 12 | Test Go của module db không có DLL thật | low | B3 tách interface `nativeCaller`; go-tester dùng fake; test tích hợp thật chỉ ở `cargo test` + test tay |
| 13 | Đổi hành vi sprint-18 (bỏ `mock-sqlite-local`, Connect/Execute thật cho SQLite) làm test cũ fail | medium | Đổi hành vi có chủ ý theo requirement; react-tester sửa test cũ tương ứng và ghi rõ trong báo cáo |
| 14 | Người dùng chọn file `.db` trên đường dẫn UNC (`\\host\...`) có thể gửi NTLM qua SMB khi mở | low | Người dùng tự chọn file nên chấp nhận; không tự `Stat` đường dẫn khi nạp danh sách profile |
| 15 | BLOB toàn bộ hex (Q6 = C): trang bị chặn ~16 MiB (Q12 = A), nhưng **một dòng** có blob lớn hơn (vd. 200 MB → chuỗi 400 MB) vẫn được gửi nguyên vì trang luôn ≥ 1 dòng | medium | Chấp nhận theo lựa chọn; Rust dựng hex một lần cấp phát, Go giải mã thẳng vào struct, FE không để row trong immer và chỉ render phần đầu chuỗi; ghi vào report là giới hạn đã biết |
| 16 | Timeout 5 phút (Q10 = B) cắt câu hợp lệ chạy lâu (index lớn, `VACUUM`) | low | Lựa chọn của người dùng; DBE015 ghi rõ thời hạn; người dùng vẫn có nút Huỷ trước đó |
| 17 | Đúng 3 cỡ giao diện cho lưới/cây (hằng px virtualizer) | medium | px × `useUiScale()` + `useRemeasureOnScale`; agent FE đo bằng Playwright root 14/16/18px |
| 18–23 | Rủi ro mới của vòng 2 | — | Xem mục 9.5 |

## 8. Tiêu chí hoàn thành
- [ ] Unit test frontend đạt Branches (C1) và Lines ≥ 95% cho từng file đã đổi/mới; toàn bộ `vitest run` qua, console sạch; test hồi quy Go (tạm) qua và đã xoá; `cargo test` qua
- [ ] `cargo fmt --check`, `cargo clippy ... -D warnings`, `cargo build --release --target x86_64-pc-windows-msvc` qua; grep `rust/src` không có `unwrap(`/`expect(` ngoài `#[cfg(test)]`; `unsafe` chỉ nằm trong `drivers/sqlite/raw.rs`; `cargo tree -i libsqlite3-sys` chỉ có một phiên bản
- [ ] `go build ./...`, `go vet ./...`, `go tool golangci-lint run ./...` qua với `CGO_ENABLED=0`; bindings sinh lại bằng skill `wails3-bindings`, `tsc --noEmit` qua
- [ ] `go tool wails3 task build` → `build/bin` có `S3Browser.exe` và `s3b_db.dll`; bản portable và installer NSIS có DLL; `dumpbin /dependents s3b_db.dll` không có `VCRUNTIME140.dll` (mục 9 B1)
- [ ] Tạo profile SQLite (chọn file bằng hộp thoại, bật/tắt chỉ đọc) và profile PostgreSQL → tắt app, mở lại → cả hai vẫn còn; sửa, xoá cũng giữ sau khởi động lại; cột `secret` trong DB app không chứa mật khẩu dạng rõ; Refresh đầu navbar nạp lại danh sách; Connect/Import đầu navbar vẫn toast "chưa có backend"
- [ ] Sửa profile (chưa Connect) đổi SQLite ↔ PostgreSQL → lưu được, `id` không đổi, tab đang gắn profile không lệch; profile đang Connect → ô loại DB, file, chỉ đọc bị khoá và có gợi ý "ngắt kết nối để sửa" (7 ngôn ngữ)
- [ ] Connect file `.db` thật → thẻ đổi trạng thái; file không tồn tại → toast DBE002; file không phải SQLite → toast DBE003
- [ ] Ctrl+E ở tab có profile SQLite chưa Connect → tự Connect rồi chạy
- [ ] Ctrl+E `SELECT` → lưới kết quả; `INSERT/UPDATE/DELETE/CREATE` → số dòng ở Messages; `SELECT 1; SELEC 2; SELECT 3;` → Result 1, Messages báo lỗi câu 2 (chỉ hiện text câu 2, không kèm câu 3), không chạy câu 3; `CREATE TABLE t(a); INSERT INTO t VALUES (1); SELECT * FROM t;` chạy hết; profile chỉ đọc + `INSERT` → lỗi ở Messages
- [ ] `SELECT` trên table 100.000 row → hiện 500 row đầu, cuộn tới cuối tải thêm, UI không treo; hai câu SELECT lớn liền nhau → Result 1 có ghi chú "chỉ hiện N dòng đầu", Result 2 tải tiếp được
- [ ] Ô BLOB hiện hex đầy đủ dạng `0x...` (cắt bằng ellipsis trong ô); table có nhiều blob lớn → mỗi trang ≤ ~16 MiB (ít hơn 500 dòng), cuộn tiếp vẫn tải đủ, app không treo
- [ ] Câu chạy lâu (CTE đệ quy) → bấm Huỷ → dừng, không toast lỗi, log không có dòng Error; để quá 5 phút → toast DBE015; đóng tab / Disconnect / đổi profile của tab → backend đóng conn (FetchRows sau đó không trả dữ liệu)
- [ ] Log app không chứa câu SQL hay dữ liệu truy vấn
- [ ] Profile chưa Connect: không mở được Accordion, thẻ giống sprint-18; đã Connect: mở/đóng độc lập nhiều profile; SQLite `main` → Tables/Views/Indexes/Triggers, PG database → schema → nhóm, mỗi loại node có icon riêng, không có Queries/Backups
- [ ] Click đơn chỉ tô sáng; double click View/Index/Trigger không làm gì; double click table → mở tab `TableStructure` (icon khác, tên table), double click lần nữa → chuyển tới tab đó; tab đóng/kéo thả/sắp xếp được
- [ ] Tab `TableStructure` có Data (số thứ tự dòng, NULL khác màu, virtualize, cuộn ngang, SQLite tải theo trang), Column, Index, Constraint (PK, UNIQUE, CHECK parse bằng `sqlparser`), FK, Source (DDL) — SQLite lấy từ file thật, PG từ mock có table nhiều cột nhiều row
- [ ] Autocomplete trong tab SQL của profile SQLite gợi ý tên table/view của cây đã nạp
- [ ] Chọn tab gắn profile đã Connect mà Accordion đang đóng → tự mở, không đóng Accordion khác; Disconnect hoặc xoá profile → Accordion đóng, cây bị bỏ, tab `TableStructure` của profile đóng
- [ ] Đúng ở cỡ small/medium/large và theme sáng/tối (đo bằng Playwright root 14/16/18px hoặc xem tay, ghi rõ); chuỗi UI đủ 7 ngôn ngữ, cùng tập key với `en`
- [ ] Chế độ S3 không đổi hành vi (test S3 qua, `TabStrip` không sửa)

## 9. Thay đổi phạm vi sau review vòng 1 (2026-11-17)

Review vòng 1 trên `SP-19/sqlite_native_backend`. Nội dung dưới đây người dùng đã chốt; các mục 1–8 ở trên đã sửa cho khớp (B1, B2, giả định, binding, migration, F1, F4 test, tiêu chí).

### 9.1 Phát hiện và cách sửa
| Mã | Mức | Phát hiện | Cách sửa (đã chốt) | Lớp |
|---|---|---|---|---|
| B1 | cao | `s3b_db.dll` phụ thuộc `VCRUNTIME140.dll`, máy không có VC++ Redistributable không load được | Tạo `rust/.cargo/config.toml`: `[target.x86_64-pc-windows-msvc] rustflags = ["-C", "target-feature=+crt-static"]`; thêm file này vào `sources` của task `build:dll` trong `build/Taskfile.yml` để đổi cấu hình thì build lại | Rust + build |
| B4 | cao | `s3b_cancel(id)` có thể interrupt nhầm request khác trên cùng connection (request `id` đã xong, request mới đang chạy) | Mỗi connection trong registry có `running: AtomicU64` (id request đang chạy, 0 = rảnh); đặt khi bắt đầu, xoá về 0 khi xong; `s3b_cancel` chỉ gọi `sqlite3_interrupt` khi `running == id` (vẫn dưới lock registry như mục 3a) | Rust |
| B2 | cao | Sửa `filePath`/`readOnly` của profile đang kết nối làm connection lệch với profile đã lưu | Phương án B: modal sửa khoá ô `filePath` (và nút chọn file), `readOnly` và ô loại DB khi profile đang kết nối, hiện gợi ý "ngắt kết nối để sửa" (key mới `dbProfileModal:form.description.disconnectToEdit`, 7 ngôn ngữ); không tự đóng connection; tên/màu vẫn sửa được | FE |
| B3 | cao | Đổi phạm vi: bảng `db_profiles` lưu mọi loại DB | Xem 9.2 | Go + FE |
| Q1 | low | Trường `sql` của câu lỗi prepare chứa cả phần SQL còn lại | Chỉ lấy text tới hết câu lỗi (dùng vị trí tail SQLite trả, hoặc khi prepare lỗi thì cắt tới `;` kết thúc câu đầu theo tách câu sẵn có — rust-native chọn cách khớp `split.rs`, **chưa xác minh** SQLite trả tail khi prepare lỗi) | Rust |
| B5 | low | Xoá profile đang Connect: đóng connection trước rồi mới xoá DB, xoá DB lỗi thì connection đã mất | Đổi thứ tự trong `module.go`/`submodule_profile_mng.go`: xoá bản ghi trước, thành công mới đóng connection (chính + tab) của profile | Go |
| P1 | low | Tab đổi sang profile khác chưa đóng connection tab cũ ở backend ngay | `sqlTabStore` (đổi profile của tab) gọi `CloseDbTab({tabId})` khi profile mới khác profile cũ | FE |
| Q2 | low | Người dùng huỷ (ctx `Canceled`) vẫn ghi log mức Error | Khi `isCallCanceled` thì không log Error (tối đa Debug), vẫn trả `Result=false` im lặng; `DeadlineExceeded` vẫn log | Go |
| Q3 | low | `created_at` (default `CURRENT_TIMESTAMP`, `YYYY-MM-DD HH:MM:SS`) khác định dạng `updated_at` (`strftime('%Y-%m-%dT%H:%M:%fZ','now')` ở query update) | Đặt default của cả hai cột trong `000003_db_profiles.sql` là `(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`, query update giữ nguyên biểu thức đó | Go (SQL) |
| Q4 | low (chưa xác minh) | `copy:dll` có thể lỗi "file in use" khi dev đang chạy exe đã nạp DLL | go-backend thử tái hiện; nếu đúng: task copy khai báo `sources`/`generates` để Task bỏ qua khi DLL không đổi, và báo lỗi rõ (dừng app dev rồi build lại) thay vì im lặng; không xác nhận được thì ghi "chưa xác minh" trong report | build |

### 9.2 B3 — `db_profiles` lưu mọi loại DB (thay quyết định "profile PostgreSQL chỉ lưu RAM")
- Profile PostgreSQL lưu vào SQLite của app ngay sprint này, thay danh sách profile mock trong RAM. Chỉ Connect/cây/dữ liệu PG vẫn mock (không có backend PG).
- Schema (sửa thẳng `internal/pkg/db/schemas/000003_db_profiles.sql`; migration **chưa phát hành** — không có trên `origin/staging` hay `origin/SP-19/release` — nên không thêm migration mới): `id`, `name`, `color`, `provider TEXT NOT NULL` (thay `db_type`; giá trị `sqlite`, `postgres`; Go kiểm danh sách hỗ trợ, không CHECK ở SQL), `config TEXT NOT NULL` (JSON theo provider), `secret TEXT` (NULL hoặc mật khẩu mã hoá qua `utils.KeyManager`), `created_at`, `updated_at` (Q3); bỏ `file_path`, `read_only`. Thêm loại DB mới không cần migration.
- `config` theo provider: SQLite `{filePath, readOnly}`; PostgreSQL `{host, port, database, username, sslMode}` (theo form `DbProfileModal`/`dbProfileSchema.ts` hiện có); mật khẩu PG đi vào `secret`, không vào `config`. Model Go: một struct phẳng `DbProfileConfig` (json camelCase, `omitempty`) như mẫu `models.AuthConfig`; trước khi lưu Go xoá field không thuộc provider. Go kiểm field bắt buộc theo provider (SQLite: `filePath` khác rỗng; PG: `host`, `database`, `username` khác rỗng, `port` 1–65535) → sai thì DBE010.
- Mã hoá: dùng mẫu `seal`/`open` của `profile/submodule_auth_mng.go`; `db.NewModule` nhận thêm `km *utils.KeyManager` từ `internal/app.go` (đã có `km`). Secret rỗng lưu NULL. Quy tắc ô mật khẩu trống khi sửa: theo **Q13** (ĐÃ CHỐT, xem 9.6).
- Binding: `CreateDbProfile`/`UpdateDbProfileById` nhận `provider` + `config` + `secret`; `GetAllDbProfile` trả `provider` + `config` + `hasSecret` (không trả secret, không giải mã khi đọc danh sách). `ConnectDb` chỉ hỗ trợ `sqlite` (provider khác → DBE001; FE không gọi cho PG, PG vẫn cờ giả).
- Modal sửa **cho đổi provider**: cập nhật bản ghi giữ nguyên `id` (tab đang gắn không lệch), config của loại cũ bị xoá, đổi provider thì bỏ secret cũ; ô chọn loại DB bị khoá khi profile đang kết nối (cùng quy tắc B2).
- FE: `dbProfileStore` nạp mọi profile từ backend; `DbProfile` có `provider`, `config`, `hasSecret` (không giữ `password`); `mock/dbProfileMock.ts` bỏ danh sách profile (giữ phần mock khác nếu còn dùng). Giá trị `postgresql` ↔ `postgres`: theo **Q14** (ĐÃ CHỐT, xem 9.6).
- Máy dev đã chạy bản `000003` cũ (version 3 có `db_type`/`file_path`) phải xoá bảng `db_profiles` hoặc `goose down` một bậc trước khi chạy bản mới (goose không chạy lại migration đã áp dụng) — orchestrator ghi vào report và memory.

### 9.3 Thứ tự vòng 2 (branch `SP-19/sqlite_native_backend`, tuần tự)
1. rust-native: B1 (`rust/.cargo/config.toml`), B4 (`running: AtomicU64`), Q1 → `cargo fmt --check`, clippy, build release.
2. rust-tester: thêm case cho B4, Q1 (test Rust hiện có giữ nguyên, phải qua).
3. go-backend: B1 (`sources` của `build:dll` trong `build/Taskfile.yml`), B3 (schema/provider/config/secret, model, submodule profile, `km`), B5, Q2, Q3, Q4.
4. `go tool sqlc generate`, rồi skill `wails3-bindings`.
5. go-tester: test hồi quy tạm (`-tags portable` cho phần cần KeyManager), xoá sau khi chạy.
6. react-frontend: B2-B, B3 (provider + modal sửa đổi provider, store không giữ mật khẩu), P1.
7. react-tester → verifier → code-reviewer vòng 2 (vòng review thứ 2/3 theo B4 của `CLAUDE.md`).

### 9.4 Test bổ sung vòng 2
| Lớp | Hàm / file | Case cần phủ |
|---|---|---|
| Rust (rust-tester) | rust/src/registry.rs, ffi.rs (`s3b_cancel`) | cancel id đã xong khi connection đang chạy request khác → request khác không bị interrupt; cancel đúng id đang chạy vẫn `cancelled`; `running` về 0 sau khi xong cả khi lỗi/panic |
| Rust (rust-tester) | rust/src/drivers/sqlite/actor.rs, split.rs | `SELECT 1; SELEC 2; SELECT 3` → `statements[1].sql` chỉ là câu 2; câu lỗi là câu cuối; câu lỗi kèm comment |
| Go (go-tester) | internal/modules/db/submodule_profile_mng.go | như bảng mục 3 (B2) + secret rỗng/không rỗng, `hasSecret`, quy tắc Q13; config field lạ của provider khác bị bỏ; PG thiếu host/port sai → DBE010 |
| Go (go-tester) | internal/modules/db/module.go (xoá profile — B5) | xoá DB lỗi → connection vẫn mở, message DBE011; xoá thành công → đóng conn chính + conn tab; profile chưa Connect xoá bình thường |
| Go (go-tester) | submodule_native_mng.go / nơi log (Q2) | ctx `Canceled` → không có bản ghi log mức Error (handler slog giả); `DeadlineExceeded` vẫn log + DBE015 |
| Go (go-tester) | migration 000003 (Q3) | `created_at` và `updated_at` sau insert cùng định dạng ISO; sau update `created_at` không đổi |
| FE (react-tester) | dbProfileStore.ts, DbProfileModal.tsx, dbProfileSchema.ts, mock/dbProfileMock.ts | như bảng mục 4 (F1) |
| FE (react-tester) | stores/sqlTabStore.ts (P1) | đổi profile của tab → gọi `CloseDbTab` một lần; chọn lại cùng profile → không gọi; tab chưa có profile → không gọi |

### 9.5 Rủi ro mới
| # | Rủi ro | Mức độ | Cách giảm thiểu |
|---|---|---|---|
| 18 | Secret mã hoá cần `KeyManager`; test Go package có KeyManager phải chạy `-tags portable` và không `-race` (bẫy đã ghi trong memory) | medium | go-tester dùng `-tags portable`; giữ mã hoá trong một submodule để fake dễ |
| 19 | Sửa thẳng migration `000003` đã chạy trên máy dev: goose coi version 3 đã áp dụng nên bảng cũ vẫn còn, CRUD lỗi cột | medium | Ghi rõ trong report + memory: xoá bảng `db_profiles` hoặc `goose down` một bậc; dữ liệu cũ chưa phát hành nên không cần chuyển đổi; kiểm lại trước khi PR rằng `000003` vẫn chưa có trên `origin/staging`/`origin/SP-19/release` |
| 20 | Đổi provider trong modal sửa khi có tab đang gắn profile: tab giữ `id` nhưng nội dung (autocomplete, Connect) theo provider mới | low | Ô loại DB khoá khi đang kết nối; profile chưa kết nối không có connection tab mở lâu (P1/CloseDbTab) |
| 21 | Bỏ danh sách PG mock trong RAM làm hỏng test sprint-18 dựa vào profile mock (`DbProfiles`, `SqlTabDetail`, `DbProfileModal`) | medium | Thay đổi có chủ ý; react-tester sửa test cũ và ghi rõ trong báo cáo |
| 22 | `crt-static` đổi cách link CRT; nếu crate C (libsqlite3 bundled qua `cc`) không theo cờ, DLL vẫn có thể kéo `VCRUNTIME140` — **chưa xác minh** | medium | Kiểm `dumpbin /dependents` (hoặc tương đương) sau build, ghi kết quả vào report |
| 23 | Tổng số vòng review: đây là vòng 2/3 của branch R2 | medium | Không thêm việc ngoài 9.1; quá vòng 3 thì dừng hỏi người dùng |

### 9.6 Câu hỏi đã chốt (2026-11-17)
| # | Câu hỏi | Quyết định |
|---|---|---|
| Q13 | Sửa profile mà để trống ô mật khẩu (FE không nhận lại mật khẩu, chỉ có `hasSecret`) | **ĐÃ CHỐT (2026-11-17): A** — để trống ô mật khẩu thì giữ mật khẩu đã lưu nếu cùng provider (giống `fillEmpty` của profile S3); đổi provider thì bỏ mật khẩu cũ; sprint này chưa có cách xoá mật khẩu đã lưu |
| Q14 | Giá trị loại PostgreSQL ở FE là `postgresql` (`DbType`, `form.dbType.postgresql`), backend dùng `postgres` | **ĐÃ CHỐT (2026-11-17): A** — FE đổi `dbType` thành `provider` với giá trị `sqlite`/`postgres`, giữ nguyên tên key i18n `form.dbType.*`, chỉ map nhãn |
