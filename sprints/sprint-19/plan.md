# Plan sprint-19

> **Trạng thái: DONE 2026-11-22.** PR #43–#50 đã merge vào `SP-19/release`; version beta `1.1.0-beta.19`. Kết quả thực tế và các lệch plan đã chấp nhận: **mục 11**. Plan đã duyệt (B3) 2026-11-18; mọi câu hỏi Q1–Q36 đã chốt; chạy qua orchestrator theo mục 5–6 và 10.9. Biện pháp giảm rủi ro 25, 26, 40 của R3 (golden test SQLite, spike đo N12, PG dùng decode của `postgres-protocol` + test so sánh nhị phân/text): **người dùng duyệt 2026-11-18**, xem mục 10.
>
> **Cập nhật R3:** N4–N11 đã commit trên `SP-19/native_db_drivers` (golden test, refactor N4, mỗi driver một commit, bench). Kết quả thực tế khác plan ban đầu ghi ngay tại chỗ, đánh dấu "Thực tế R3" (10.4–10.12).
>
> **Cập nhật 2026-11-20:** đối chiếu lại với code trên `SP-19/native_db_drivers` (đỉnh `caeb63d`): crate và feature thật theo `rust/Cargo.toml` (10.3, 10.4, 10.6), TLS của SQL Server (10.5), tên file test thật (10.8), các chỗ được phép có `unsafe` (mục 3a, 8, 10.11).

## 1. Tóm tắt yêu cầu
- R1: Profile DB đã Connect có Accordion trong thẻ navbar SQL chứa cây đối tượng (SQLite `main` → Tables/Views/Indexes/Triggers; PostgreSQL database → schema → nhóm). Double click table mở tab đặc biệt `TableStructure` (6 tab con Data/Column/Index/Constraint/FK/Source). SQLite lấy dữ liệu thật qua R2, PostgreSQL dùng mock.
- R2: Dựng backend đầu tiên của chế độ SQL cho SQLite: Rust `s3b_db.dll` (FFI 4 hàm, `sqlx` + tokio theo Q4 = A) + Go `internal/modules/db` (load DLL không cgo, handler Wails mới, `DBE<NNN>`), task build DLL vào exe/portable/NSIS. Profile DB (mọi loại: SQLite và PostgreSQL, xem mục 9) lưu vào SQLite của app (goose + sqlc), chọn file bằng hộp thoại native, tuỳ chọn chỉ đọc. Connect thật (chỉ SQLite); Ctrl+E/Execute chạy SQL thật (nhiều câu, dừng ở câu lỗi, autocommit, nút Huỷ, timeout 5 phút); panel kết quả Result 1..n + Messages; SELECT tải theo trang (**10.000 row** — Q16 = B, người dùng chốt 2026-11-18 sau khi đo hiệu năng, thay mức 500 ban đầu — tối đa ~16 MiB) qua `cursorId`; có lệnh đọc schema và row của table cho R1.
- R3 (thêm 2026-11-18): Driver Rust cho MySQL, MariaDB, PostgreSQL, SQL Server, MongoDB, Redis theo `CLAUDE.md` §8, cùng hợp đồng `s3b_call` với SQLite (open/close, execute nhiều câu dừng ở lỗi đầu, cursor theo trang, huỷ, mã lỗi ổn định), có TLS rustls + `ring` (đủ 6 `SslMode`, CA từ kho Windows); MongoDB/Redis dùng lệnh gốc; bài đo hiệu năng (docker compose trong `test-env/`, bench Rust release, report Excel). Chỉ Rust driver + bài đo, chưa nối Go/FE, Oracle tạm bỏ. Plan chi tiết ở **mục 10**.

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
- R3: xem mục 10.12.

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
- Giới hạn trang (Q12 = A): `maxPageBytes` = 16 MiB (hằng ở Go, gửi xuống Rust), tính theo tổng độ dài chuỗi ô đã dựng. `pageSize` = 10.000 (Q16 = B, 2026-11-18).
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

Câu hỏi của R3: Q15–Q36 **ĐÃ CHỐT 2026-11-18** — xem **mục 10.0**. Không còn câu hỏi mở.

## 3a. Task native (rust-native)
| # | Task | Yêu cầu | File sửa / tạo | Phụ thuộc |
|---|---|---|---|---|
| N1 | Dựng crate `s3b_db` (cdylib + rlib để test), toolchain, FFI 4 hàm bọc `catch_unwind`, runtime tokio dùng chung (tạo một lần ở `s3b_init`, `s3b_call` chạy `block_on` trên runtime đó), protocol JSON, dispatch theo `method`, registry connection (`connId` → kênh gửi lệnh tới actor + raw handle cho interrupt) và registry request (`id` → `connId`) cho `s3b_cancel` | R2 | rust/Cargo.toml (tạo), rust/Cargo.lock (tạo), rust/rust-toolchain.toml (tạo), rust/src/lib.rs, rust/src/ffi.rs, rust/src/runtime.rs, rust/src/dispatch.rs, rust/src/protocol/mod.rs, rust/src/registry.rs (tạo); .gitignore (sửa: `rust/target/`) | - |
| N2 | Driver SQLite bằng **sqlx**: `open`/`close` (`SqliteConnectOptions` `create_if_missing(false)`, `read_only(readOnly)`, `busy_timeout` 5s, kiểm "not a database" bằng `PRAGMA schema_version`); mỗi connection một actor tokio sở hữu `SqliteConnection`; `execute` tách câu theo prepare-tail **lười** (gọi `sqlite3_prepare_v2` trên raw handle cho phần SQL còn lại ngay trước khi chạy câu đó, lấy text câu, finalize, rồi chạy bằng sqlx — nhờ vậy câu sau phụ thuộc câu trước vẫn prepare được; tail chỉ còn khoảng trắng/comment → câu hiện tại là câu cuối), chạy lần lượt, dừng ở câu lỗi đầu; trang đầu tối đa `pageSize` row do Go gửi (10.000 theo Q16 = B) **và** `maxPageBytes` (luôn ≥ 1 dòng, Q12); cursor theo Q3 (chỉ câu cuối là SELECT giữ stream trong actor); `fetch`; huỷ bằng `sqlite3_interrupt` trên raw handle + cờ huỷ kiểm trước mỗi câu và mỗi dòng; giá trị ô theo kiểu lưu thực của từng ô: NULL → `null`, INTEGER → chuỗi, REAL/TEXT → chuỗi, BLOB → toàn bộ hex `0x...` (Q6 = C) | R2 | rust/src/drivers/mod.rs, rust/src/drivers/sqlite/mod.rs, rust/src/drivers/sqlite/actor.rs, rust/src/drivers/sqlite/split.rs, rust/src/drivers/sqlite/raw.rs (unsafe gom một chỗ), rust/src/drivers/sqlite/value.rs (tạo) | N1 |
| N3 | Đọc schema SQLite (trên actor của connection chính): `schemaTree` (sqlite_schema, bỏ `sqlite_%`), `tableInfo` (PRAGMA table_xinfo, index_list/index_xinfo, foreign_key_list, CHECK bằng `sqlparser` dialect SQLite — parse lỗi thì bỏ CHECK, vẫn trả PK/UNIQUE; DDL), `tableRows` (`SELECT * FROM main."<tên đã escape>"` dùng chung cursor của N2) | R2 | rust/src/drivers/sqlite/schema.rs (tạo), rust/src/dispatch.rs (sửa) | N2 |

Task native của R3 (N4–N12): xem **mục 10.4**.

Hợp đồng JSON mới (Go ↔ Rust, field camelCase):
- FFI: `s3b_init() -> i32` (0 = ok, tạo runtime tokio + registry, gọi nhiều lần vô hại); `s3b_call(req_ptr: *const u8, req_len: usize, out_ptr: *mut *mut u8, out_len: *mut usize) -> i32` (0 = `out` chứa JSON response, cả khi lỗi nghiệp vụ; khác 0 chỉ khi con trỏ null/panic không ghi được out; **chặn** tới khi xong — Go gọi trong goroutine của handler); `s3b_cancel(id: u64)` (đặt cờ huỷ và gọi `sqlite3_interrupt` của conn đang chạy request đó; id lạ hoặc đã xong thì bỏ qua); `s3b_free(ptr: *mut u8, len: usize)`.
- Request: `{"id": <u64 do Go cấp>, "method": "<tên>", "params": {...}}`. Response: `{"ok": true, "result": {...}}` hoặc `{"ok": false, "error": {"code": "<mã>", "message": "<chi tiết kỹ thuật, không chứa dữ liệu truy vấn>"}}`.
- Method:
  - `open` `{driver: "sqlite", path, readOnly}` → `{connId: u64}`
  - `close` `{connId}` → `{}` (đóng cursor, đóng connection, dừng actor)
  - `execute` `{connId, sql, pageSize, maxPageBytes}` → `{statements: [{index, sql, kind: "rows"|"affected", columns?: [{name, type}], rows?: [[string|null]], cursorId?: u64|null, done?: bool, truncated?: bool, rowsAffected?: i64, elapsedMs, error?: {code, message}}]}` — câu lỗi là phần tử cuối có `error`, `ok` vẫn true; chỉ phần tử cuối (nếu `kind: "rows"` và chưa `done`) có `cursorId`; phần tử trước có `truncated: true` khi còn dòng chưa đọc (Q3) — số dòng có thể < `pageSize` khi chạm `maxPageBytes` (Q12). Câu lỗi prepare: `sql` chỉ chứa text tới hết câu lỗi, không kèm phần SQL còn lại (mục 9 Q1).
  - `fetch` `{connId, cursorId, pageSize, maxPageBytes}` → `{rows, done}` (trang có thể < `pageSize` dòng mà `done=false` khi chạm `maxPageBytes`; done → Rust tự đóng cursor)
  - `schemaTree` `{connId}` → `{schemas: [{name: "main", tables: [string], views: [string], indexes: [{name, table}], triggers: [{name, table}]}]}`
  - `tableInfo` `{connId, schema, table}` → `{columns: [{cid, name, type, notNull, defaultValue, pk}], indexes: [{name, unique, origin, partial, columns}], constraints: [{kind: "PRIMARY KEY"|"UNIQUE"|"CHECK", name, columns, expression}], foreignKeys: [{id, columns, refTable, refColumns, onUpdate, onDelete}], ddl}`
  - `tableRows` `{connId, schema, table, pageSize, maxPageBytes}` → giống một phần tử `kind: "rows"` của `execute`
- Mã lỗi Rust → Go: `invalidRequest` → DBE001, `openFailed` → DBE002, `notADatabase` → DBE003, `connNotFound` → DBE004, `cursorNotFound` → DBE005, `sqlError` → DBE006 (chỉ dùng trong `statements[].error`, hiện ở Messages), `tableNotFound` → DBE007, `internal` (panic, actor chết) → DBE008, `cancelled` → Go xét `ctx.Err()`: `context.Canceled` → `Result=false` im lặng; `context.DeadlineExceeded` → DBE015.

Crate: `tokio` (features `rt-multi-thread`, `sync`, `macros`), `sqlx` (`default-features = false`, features `sqlite`, `runtime-tokio`; libsqlite3 bundled), `libsqlite3-sys = "*"` (version `*` để Cargo tự dùng đúng bản sqlx kéo vào, nâng sqlx không phải sửa tay; không bật feature build riêng, chỉ để gọi `sqlite3_interrupt`/`sqlite3_prepare_v2`/`sqlite3_finalize`), `futures-util` (`StreamExt` đọc stream), `serde` + `serde_json`, `sqlparser`. `[profile.release] panic = "unwind"`. API `lock_handle().as_raw_handle()` và feature bundled của sqlx **chưa xác minh** trên phiên bản sẽ dùng — rust-native kiểm docs.rs trước khi code N2; không lấy được handle an toàn thì dừng và báo về (luật 6).

An toàn: mọi hàm export bọc `catch_unwind`; panic trong task tokio thành `JoinError` → `internal`; `unsafe` gọi SQLite C API gom trong `drivers/sqlite/raw.rs`, mọi khối `unsafe` có comment `// SAFETY:` (danh sách đầy đủ các chỗ được phép có `unsafe` ở mục 8); raw handle cho interrupt chỉ dùng khi connection còn trong registry (xoá khỏi registry dưới lock trước khi đóng, `s3b_cancel` đọc handle dưới cùng lock) để không gọi interrupt trên handle đã đóng; chỉ interrupt khi request đang chạy trên connection đúng là `id` cần huỷ (mục 9 B4); không `unwrap`/`expect` ngoài `#[cfg(test)]`.

Dùng lại: không có code Rust sẵn. Hằng `pageSize` (10.000 theo Q16 = B) và `maxPageBytes` 16 MiB do Go gửi (một chỗ khai báo).  |  Hiệu năng: kết quả SELECT có thể 100.000+ row → đọc theo trang qua stream, không collect toàn bộ; trang dừng sớm ở 16 MiB để payload FFI/JSON có trần; mỗi conn một actor nên tab này chạy lâu không chặn tab khác hay cây (connection chính riêng); prepare-tail chỉ prepare rồi finalize, chi phí nhỏ so với chạy câu; `elapsedMs` đo trong Rust; huỷ không chờ hàng đợi của actor (`sqlite3_interrupt` gọi từ thread của `s3b_cancel`); dựng hex BLOB bằng một lần cấp phát `String::with_capacity(2n+2)`.

Test Rust (rust-tester, có commit). Test truyền `pageSize` của riêng nó (500 ở `rust/tests/common/mod.rs`), không phụ thuộc hằng Go, nên Q16 = B không làm đổi test Rust:
| Task | Hàm / file cần test | Case cần phủ |
|---|---|---|
| N1 | rust/src/protocol, rust/src/dispatch.rs, rust/src/ffi.rs, rust/src/registry.rs, rust/src/runtime.rs | parse request đúng / JSON sai → `invalidRequest` / method lạ → `invalidRequest` / thiếu param / serialize response ok và lỗi đúng camelCase / `s3b_init` gọi hai lần / `s3b_call` với con trỏ null trả mã ≠ 0 không panic / buffer trả về giải phóng qua `s3b_free` / panic trong handler bị `catch_unwind` → `internal` / panic trong task tokio → `internal` / `s3b_cancel` id lạ không lỗi |
| N2 | rust/src/drivers/sqlite/actor.rs, split.rs, raw.rs, value.rs | open file tạm thành công / file không tồn tại → `openFailed` (không tạo file) / file text → `notADatabase` / readOnly + INSERT → `sqlError` / SELECT 1.201 row (pageSize 500) → trang 500, `fetch` 500, `fetch` 201 + `done` / SELECT rỗng → `done` ngay / INSERT/UPDATE/DELETE trả `rowsAffected` / DDL / nhiều câu → nhiều `statements` / câu 2 lỗi → dừng, không chạy câu 3 / `;` trong chuỗi, comment `--` và `/* */`, thân `CREATE TRIGGER ... BEGIN ...; END;` / `CREATE TABLE t(...); INSERT INTO t ...; SELECT * FROM t` (câu sau phụ thuộc câu trước) / SQL chỉ có khoảng trắng-comment / câu cuối theo sau là comment vẫn được coi là câu cuối / NULL, số nguyên > 2^53 (chuỗi), REAL, TEXT unicode, cột không khai báo kiểu chứa nhiều kiểu lưu khác nhau, BLOB rỗng và BLOB vài KB → hex đầy đủ / Q3: `SELECT 600 row; SELECT 600 row` → câu 1 `truncated`, không cursor; câu 2 có cursor / Q12: blob lớn → trang ngắt sớm < pageSize dòng, `done=false`, `fetch` tiếp đủ dòng; một dòng vượt `maxPageBytes` → trang vẫn có 1 dòng / Execute mới đóng cursor cũ → `fetch` cursor cũ → `cursorNotFound` / `close` khi cursor đang mở → gọi sau → `connNotFound` / metadata trên connection chính chạy được khi tab có cursor mở / huỷ CTE đệ quy chạy lâu → `cancelled` và conn vẫn dùng được sau đó / huỷ khi đang `fetch` / `s3b_cancel` đúng lúc `close` không crash |
| N3 | rust/src/drivers/sqlite/schema.rs | DB có table, view, index (kể cả `sqlite_autoindex_*` bị bỏ), trigger / DB rỗng → các nhóm rỗng / `tableInfo`: cột PK nhiều cột, NOT NULL, DEFAULT, UNIQUE, CHECK cột và CHECK table, FK có ON DELETE / DDL `sqlparser` không parse được → không có CHECK, vẫn có PK/UNIQUE / table tên có dấu `"` và khoảng trắng / table không tồn tại → `tableNotFound` / `tableRows` phân trang như N2 |

## 3. Task backend (go-backend)
| # | Task | Yêu cầu | File sửa / tạo | Phụ thuộc |
|---|---|---|---|---|
| B1 | Build DLL vào mọi bản: task `common:build:dll` (`cargo build --release --target x86_64-pc-windows-msvc` trong `rust/`) chạy trước build Go và copy `s3b_db.dll` cạnh exe (`OUT_DIR`/`BIN_DIR`, nên vào cả portable); NSIS `File` DLL; workflow cài Rust target; dev mode bỏ qua `rust/`; link CRT tĩnh (`rust/.cargo/config.toml` `crt-static`, nằm trong `sources` của `build:dll`) để DLL không cần VCRUNTIME140 (mục 9 B1) | R2 | build/Taskfile.yml (sửa), build/windows/Taskfile.yml (sửa: deps `build:native`, `build:debug` + bước copy), build/windows/nsis/project.nsi (sửa: `File "...\s3b_db.dll"` sau `wails.files`), build/config.yml (sửa: `dev_mode.ignore.dir` thêm `rust`), .github/workflows/release.yml, .github/workflows/pre-release.yml (sửa: bước cài Rust stable + target msvc, cache `rust/target`), rust/.cargo/config.toml (tạo, vòng 2) | N1 |
| B2 | Lưu profile DB **mọi provider** (sửa ở vòng 2, mục 9 B3): migration `db_profiles` (`provider`, `config` JSON, `secret` mã hoá qua `utils.KeyManager`), query sqlc, model, submodule CRUD (Go kiểm provider ∈ {`sqlite`, `postgres`}, chỉ giữ field config của provider, mã hoá secret) + chọn file `.db` bằng hộp thoại native | R2 | internal/pkg/db/schemas/000003_db_profiles.sql (tạo; vòng 2 sửa thẳng), internal/pkg/db/queries/dbprofile/{insert_db_profile,update_db_profile_by_id,delete_db_profile_by_id,select_all_db_profile,select_db_profile_by_id}.sql (tạo; vòng 2 sửa), sqlc.yaml (sửa: thêm `internal/pkg/db/queries/dbprofile`), models/db/db_profile_input.go, models/db/db_profile_output.go (tạo; vòng 2 sửa), models/alias.go (sửa), internal/modules/db/submodule_profile_mng.go (tạo; vòng 2 sửa), internal/modules/db/module.go + internal/app.go (vòng 2: truyền `km` vào `db.NewModule`) | - |
| B3 | Lớp gọi DLL không cgo: load `s3b_db.dll` theo đường dẫn tuyệt đối cạnh exe (`windows.LoadLibraryEx` + `LOAD_LIBRARY_SEARCH_APPLICATION_DIR`), lười ở lần dùng đầu, `s3b_init` một lần; `call(ctx, method, params, out)` cấp `id` tăng dần, goroutine nghe `ctx.Done()` → `s3b_cancel`, `s3b_free` sau khi copy; map mã lỗi Rust → DBE, `cancelled` + `ctx.Err() == DeadlineExceeded` → DBE015; interface `nativeCaller` để test bằng fake | R2 | internal/modules/db/native_windows.go, internal/modules/db/native_other.go (`//go:build !windows`, trả lỗi DBE009), internal/modules/db/submodule_native_mng.go (tạo) | N1 |
| B4 | Module + handler DB: Connect/Disconnect (map profile → conn chính, tab → conn riêng, `sync.RWMutex`, đóng ngoài lock), Execute/FetchRows/OpenTableRows/CloseDbTab (timeout 5 phút mỗi lời gọi, gửi `pageSize` **10.000** (Q16 = B) + `maxPageBytes` 16 MiB), GetSchemaTree/GetTableInfo/ConnectDb (timeout 30 giây), message code, wiring app/main, Shutdown đóng mọi conn | R2 | internal/modules/db/module.go, internal/modules/db/submodule_conn_mng.go, internal/modules/db/submodule_query_mng.go (tạo), models/db/query_input.go, models/db/query_output.go, models/db/schema_output.go (tạo), models/alias.go (sửa), internal/handlers/db_handler.go (tạo), internal/pkg/cnst/common.go (sửa: `Db = "db"`), internal/app.go (sửa), main.go (sửa: `RegisterService(DbHandler)`), frontend/src/locales/{en,vi,ja,zh-CN,zh-TW,ru,de}/messages/ipcMessage.json (sửa: mục `db`) | B2, B3, N2, N3 |

R3 không có task backend (chưa nối Go, mục 10).

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

Dùng lại: `bucket/call_helper.go` (`withCallContext`, `isCallCanceled`) — chép mẫu vào package db (unexported, không import chéo module); mẫu hộp thoại `bucket/submodule_auth_files.go`; `utils.IsDialogCancelled`, `utils.GenerateUUID`; `models.NewOutput`/`ThrowError`/`NewParamsMessage`; `sqlc.New(db)` như `profile.NewModule`; pattern `*_other.go` như `setting/autostart_other.go`; vòng 2: mẫu `auth_config`/`auth_secret` + `seal`/`open` của `profile/submodule_auth_mng.go` và `km` đã tạo ở `internal/app.go`.  |  Hiệu năng: Go chỉ chuyển tiếp trang (không gom trang); trang tối đa 10.000 dòng / ~16 MiB dữ liệu ô → Go chuyển nguyên JSON của Rust (`MarshalJSON`, mục 9.7), không decode lại; không log SQL/dữ liệu (chỉ method, connId, mã lỗi, thời gian); map conn dùng RWMutex, đóng conn ngoài lock; mỗi call native chặn một goroutine (không giới hạn thêm vì FE chỉ có một Execute/tab); danh sách profile nhỏ, `GetAllDbProfile` không giải mã secret (chỉ xét cột `secret` khác NULL).

Test hồi quy Go (go-tester, test tạm):
| Task | Function sửa | Nơi gọi | Kịch bản hồi quy (hành vi cũ phải giữ) |
|---|---|---|---|
| B2 | internal/pkg/db/migration.go: RunMigrations (không sửa code, thêm migration 000003) | internal/app.go: NewApp | DB cũ ở version 2 có `connection_profiles` → sau migrate version 3, dữ liệu profile S3 giữ nguyên, tạo đúng 1 file `.bak-*`; DB mới (version 0) không backup; Down 000003 xoá bảng; bảng có đúng cột `provider`, `config`, `secret` |
| B2 | internal/modules/db/submodule_profile_mng.go (mới, vòng 2 sửa) | module.go, db_handler.go | tạo/sửa/xoá/đọc tất cả profile `sqlite` và `postgres`; provider khác → DBE010; sửa id không tồn tại → DBE010; secret lưu mã hoá (cột khác plaintext), `GetAllDbProfile` không trả secret, `hasSecret` đúng; đổi provider giữ `id`, config cũ bị bỏ; huỷ hộp thoại chọn file → body rỗng, không message (cần `-tags portable` cho KeyManager) |
| B3 | internal/modules/db/submodule_native_mng.go (mới) | submodule_conn_mng.go, submodule_query_mng.go | fake `nativeCaller`: response ok / lỗi từng mã → đúng DBE / `cancelled` + ctx Canceled → `Result=false` không message / `cancelled` + ctx DeadlineExceeded → DBE015 / ctx huỷ giữa chừng gọi `cancel(id)` / DLL không load được → DBE009 và S3 vẫn chạy |
| B4 | internal/app.go: NewApp, Shutdown | main.go | NewApp vẫn tạo đủ 5 handler cũ + DbHandler; Shutdown vẫn huỷ download/upload, ngắt S3, reset event, đóng DB app, và đóng conn DB (không panic khi DLL chưa load) |
| B4 | internal/pkg/cnst/common.go (thêm `Db`) | modules/db | các module name cũ không đổi |
| B4 | internal/modules/db/submodule_conn_mng.go, submodule_query_mng.go (mới) | module.go, db_handler.go | Connect hai lần không mở thêm conn / Disconnect đóng conn chính + conn tab của profile / Execute tab đổi profile đóng conn cũ / CloseDbTab tab không có conn → ok / FetchRows tab đã đóng → DBE004 / xoá profile đang Connect đóng conn trước / Execute dùng timeout 5 phút, GetSchemaTree dùng 30 giây (fake kiểm deadline ctx) / request gửi `pageSize` 10.000 (Q16 = B) và `maxPageBytes` 16 MiB |

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

R3 không có task frontend (chưa nối FE, mục 10; việc FE sau này ở mục 10.13).

i18n key mới (đủ 7 ngôn ngữ): `dbProfileModal`: `form.label.readOnly`, `form.description.readOnly`, `form.description.disconnectToEdit` (vòng 2, B2); `sqlTab`: `tooltip.cancel`, `result.title` (`Result {{n}}`), `result.messages`, `result.firstRowsOnly` (`{{count}}`), `result.loading`, `message.rowsAffected`, `message.rowsReturned`, `message.elapsed`, `message.cancelled`; `sqlNavbar`: `tree.tables`, `tree.views`, `tree.indexes`, `tree.triggers`, `tree.loading`, `tree.empty`, `tree.loadError`; namespace mới `tableStructure`: `tab.data|column|index|constraint|fk|source`, tiêu đề cột của Column/Index/Constraint/FK, `nullValue`; `ipcMessage.db.DBE001–DBE015`. Key `sqlNavbar:toast.noBackend` giữ (Connect/Import đầu navbar và mục Export vẫn dùng, Q8 = A).

Dùng lại: `callIPC` + `invalidateLoads`; `createAppStore`; `TabStrip` (không sửa); `useUiScale`/`useRemeasureOnScale`; `ActionIcon`, `Button`, `TruncatedText`, `StatusDot`, `Combobox`, `SwitchInput`/`CheckBoxInput`, `FieldInput`; `Splitter` (như `SqlWorkspace`); Mantine `useTree` + `flattenTreeData`; mẫu menu chung + `data-profile-key` trong `DbProfiles.tsx`; mẫu nạp list của `s3/stores/profileStore.ts`; nguồn autocomplete hiện có của `dbSchemaMock.ts` (chỉ đổi dữ liệu đầu vào cho SQLite).  |  Hiệu năng: row kết quả (tới 100.000+, mỗi trang tối đa 10.000 dòng / ~16 MiB) **không** để trong store zustand+immer (immer freeze O(n) mỗi lần thêm trang) — giữ trong state/ref của hook `useSqlRunner`/`TableDataView`, nối trang bằng mảng mới; DataGrid virtualize 2 chiều, overscan nhỏ, ô chỉ render phần đầu chuỗi dài; `onEndReached` chặn gọi trùng khi đang tải và không dựa vào số dòng trang = `pageSize` (trang có thể ngắn hơn mà chưa `done`); cây virtualize chung với danh sách profile; selector hẹp/`useShallow`; tree theo profile nạp một lần khi mở Accordion, Refresh mới nạp lại; mock PG sinh row theo trang, không tạo sẵn 10.000 object.

Test frontend (react-tester):
| Task | File cần test | Case cần phủ |
|---|---|---|
| F1 | stores/dbProfileStore.ts, modals/dbProfile/DbProfileModal.tsx, dbProfileSchema.ts, navbar/SqlHeaderButtonGroup.tsx, SqlWorkspace.tsx, mock/dbProfileMock.ts | nạp profile: callIPC trả body / null / rỗng, gồm cả SQLite và PG từ backend (không còn PG mock trong RAM); tạo/sửa SQLite và PG gọi đúng binding với `provider` + `config` + `secret`, lỗi giữ modal; store không giữ mật khẩu, `hasSecret`; sửa đổi provider giữ `id`; profile đang Connect: ô loại DB/`filePath`/`readOnly` bị khoá + hiện gợi ý, chưa Connect thì không khoá; chọn file: trả path / rỗng (huỷ) / null; readOnly mặc định tắt, chỉ hiện với SQLite, đổi loại DB; Refresh nạp lại; Connect/Import vẫn toast `noBackend` |
| F2 | navbar/DbProfiles.tsx, components/SqlTabDetail.tsx | Connect SQLite ok / lỗi (không đổi cờ) / PG giả; Disconnect SQLite gọi backend; xoá profile đang Connect (2 confirm) gọi backend, lỗi không xoá khỏi store |
| F3 | components/display/dataGrid/DataGrid.tsx | rỗng / có row / ô null / chuỗi rất dài bị cắt khi render / nhiều cột cuộn ngang / `onEndReached` gọi 1 lần, không gọi khi `hasMore=false` hoặc đang tải / đổi cỡ giao diện remeasure |
| F4 | hooks/useSqlRunner.ts, sqlResult/SqlResultPanel.tsx, SqlMessageList.tsx, SqlTabActionBar.tsx, SqlTabDetail.tsx, utils/sqlToast.ts, stores/sqlTabStore.ts | chạy selection vs toàn bộ; SQL rỗng; chưa Connect → tự Connect ok rồi chạy / Connect lỗi thì không chạy; một/nhiều câu; Result `truncated` hiện ghi chú với đúng số dòng (kể cả < pageSize), không tải tiếp; Result cuối tải tiếp đến `done`, kể cả trang ngắn hơn pageSize mà chưa `done`; câu lỗi dừng và hiện Messages; affected rows; FetchRows lỗi; timeout (callIPC trả null); Huỷ (signal abort, không toast); chạy lại huỷ lượt cũ (kết quả cũ settle muộn bị bỏ); PG vẫn toast giả; đóng tab gọi `CloseDbTab`; đổi profile của tab gọi `CloseDbTab` (mục 9 P1) |
| F5 | mock/dbObjectMock.ts, utils/dbObjectSource.ts, stores/dbTreeStore.ts, components/SqlTabDetail.tsx | SQLite: binding trả body / null; PG: mock đúng cấu trúc, trang row cuối `done`; mở/đóng/tự mở Accordion; `dropProfile`; reset; autocomplete SQLite có tên table/view sau khi cây nạp, chưa nạp thì rỗng |
| F6 | navbar/DbProfiles.tsx, DbProfileItem.tsx, DbTreeRow.tsx | chưa Connect không mở được; mở nhiều profile; cây SQLite/PG đúng cấp; click chọn; double click table mở tab, view/index/trigger không làm gì; Disconnect đóng Accordion + tab table; chọn tab tự mở Accordion; đang tải / lỗi / rỗng |
| F7 | stores/sqlTabStore.ts, SqlTabPage.tsx, SqlTabLabel.tsx, tableStructure/TableStructureDetail.tsx, TableDataView.tsx | `openTableTab` mới / đã có → chuyển tab; `closeProfileTables` khi chỉ còn tab table → thêm tab SQL; moveTab/closeTab hành vi cũ giữ; nhãn tab SQL cũ không đổi; 6 tab con; GetTableInfo trả null; Data tải trang |
| Hồi quy | toàn bộ `vitest run` | test sprint-18 (`SqlTabDetail`, `DbProfiles`, `DbProfileModal`, `sqlTabStore`, `sqlToast`...) và S3 (`TabStrip`, `ConnectionProfiles`...) phải qua; test cũ chỉ sửa khi plan đổi hành vi (bỏ `mock-sqlite-local` và danh sách PG mock trong RAM, Connect/Execute thật cho SQLite) và ghi rõ trong báo cáo |

## 5. Branch
Thứ tự làm (Q18 = B, 2026-11-18): R2 (bổ sung PR #43) → R3 → R1.

| Branch | Yêu cầu | Task | Ghi chú |
|---|---|---|---|
| SP-19/sqlite_native_backend | R2 | N1, N2, N3, B1, B2, B3, B4, F1, F2, F3, F4 + bổ sung mục 9.7 | PR #43 vào `SP-19/release`. Q15 = A: commit bổ sung thay đổi chưa commit (đọc dòng SQLite bằng C API, Go chuyển nguyên JSON, tag `wailsgen`, `pageSize` 10.000) vào chính PR này trước khi merge — thêm một vòng review, người dùng đã chấp nhận |
| SP-19/native_db_drivers | R3 | (golden test SQLite) → N4, N10, N12 (spike), N5, N6, N7, N8, N9, N11 | Q17 = A (một branch). Tách từ `origin/SP-19/release` **sau khi PR #43 merge** (N4 sửa lại code SQLite của R2). Chỉ Rust + `test-env/`, không Go/FE. Golden test commit trước, N4 một commit refactor riêng, mỗi driver một commit (người dùng duyệt 2026-11-18). **Thực tế R3: golden test và N4–N11 đã commit** (đỉnh `caeb63d` bench), chưa PR |
| SP-19/db_object_tree | R1 | F5, F6, F7 | Làm sau R3 (Q18 = B). Chỉ cần PR #43 đã merge (Q1 = A); không phụ thuộc code R3 nên tách từ `origin/SP-19/release` ngay khi tới lượt, không chờ PR R3 merge; chỉ có FE |

Trước khi đặt tên, `git-flow` kiểm `git ls-remote --heads origin 'SP-19/*'` (bẫy trùng tên trong memory).

## 6. Thứ tự thực hiện (luôn tuần tự, xong branch này mới sang branch sau)
Với từng branch trong bảng trên:
1. Tách branch từ `origin/SP-19/release` (git-flow; release branch tạo một lần đầu sprint từ `origin/staging`)
2. Native: các task N của branch, rồi Rust test (rust-tester) + `cargo fmt --check`, `cargo clippy --target x86_64-pc-windows-msvc --all-targets -- -D warnings`, `cargo build --release --target x86_64-pc-windows-msvc`
3. Backend: các task B của branch
4. `go tool sqlc generate`, rồi `go tool wails3 generate bindings -f "-tags=wailsgen" -clean=true -ts` (skill `wails3-bindings`)
5. Go test hồi quy (go-tester, test tạm, xoá sau khi chạy)
6. Frontend: theo thứ tự số task của branch
7. FE test (react-tester) → verify → review → commit, push, PR vào `SP-19/release` (git-flow)

Vòng 2 của branch R2 chạy theo mục 9.3; phần bổ sung theo Q15 = A chạy theo mục 9.7. Branch R3 chạy theo mục 10.9 (có bước golden test trước N4 và spike N12 trước các driver).

Sau PR #43 (đã gồm 9.7): orchestrator dừng, chờ người dùng merge. Rồi làm R3 (mục 10.9), PR R3; rồi tách R1 — phải chạy lại `common:build:dll` và sinh lại bindings (thư mục `frontend/bindings` bị gitignore) trước khi làm F5.

Thứ tự task cuối của sprint: [R2 bổ sung 9.7] → golden test SQLite + mốc bench SQLite → N4 → N10 → N12 (spike) → N5 → N6 → N7 → N8 → N9 → N11 → F5 → F6 → F7.

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
| 15 | BLOB toàn bộ hex (Q6 = C): trang bị chặn ~16 MiB (Q12 = A), nhưng **một dòng** có blob lớn hơn (vd. 200 MB → chuỗi 400 MB) vẫn được gửi nguyên vì trang luôn ≥ 1 dòng | medium | Chấp nhận theo lựa chọn; Rust dựng hex một lần cấp phát, Go chuyển nguyên JSON, FE không để row trong immer và chỉ render phần đầu chuỗi; ghi vào report là giới hạn đã biết |
| 16 | Timeout 5 phút (Q10 = B) cắt câu hợp lệ chạy lâu (index lớn, `VACUUM`) | low | Lựa chọn của người dùng; DBE015 ghi rõ thời hạn; người dùng vẫn có nút Huỷ trước đó |
| 17 | Đúng 3 cỡ giao diện cho lưới/cây (hằng px virtualizer) | medium | px × `useUiScale()` + `useRemeasureOnScale`; agent FE đo bằng Playwright root 14/16/18px |
| 18–23 | Rủi ro mới của vòng 2 | — | Xem mục 9.5 |
| 24–45 | Rủi ro của R3 và của các câu trả lời 2026-11-18 (gồm `pageSize` 10.000, vòng review bổ sung #43, TLS, PG nhị phân) | — | Xem mục 10.10 |

## 8. Tiêu chí hoàn thành
- [ ] Unit test frontend đạt Branches (C1) và Lines ≥ 95% cho từng file đã đổi/mới; toàn bộ `vitest run` qua, console sạch; test hồi quy Go (tạm) qua và đã xoá; `cargo test` qua
- [ ] `cargo fmt --check`, `cargo clippy ... -D warnings`, `cargo build --release --target x86_64-pc-windows-msvc` qua; grep `rust/src` không có `unwrap(`/`expect(` ngoài `#[cfg(test)]`; `unsafe` chỉ ở các chỗ sau, mỗi khối `unsafe` có `// SAFETY:`: (1) `drivers/sqlite/raw.rs` (gọi SQLite C API, `unsafe impl Send/Sync`, `pub unsafe fn InterruptHandle::of`); (2) `ffi.rs` (`#[unsafe(no_mangle)]` của 4 hàm export; `s3b_call`, `s3b_free` là `pub unsafe extern "C" fn` với khối `unsafe` đọc/ghi con trỏ của Go); (3) chỗ gọi `raw::InterruptHandle::of` ở `drivers/sqlite/mod.rs` (lấy handle interrupt khi `open`); (4) test `#[cfg(test)]` (vd. `drivers/sqlite/actor.rs` gọi `InterruptHandle::of`). Đã kiểm 2026-11-20: `InterruptHandle::of` đã là `pub unsafe fn` và module `raw` là `pub(crate) mod raw` nên không gọi được ngoài crate và mọi chỗ gọi phải tự bọc `unsafe` — không còn tồn đọng về điểm này. `cargo tree -i libsqlite3-sys` chỉ có một phiên bản
- [ ] `go build ./...`, `go vet ./...`, `go tool golangci-lint run ./...` qua với `CGO_ENABLED=0`; bindings sinh lại bằng skill `wails3-bindings`, `tsc --noEmit` qua
- [ ] `go tool wails3 task build` → `build/bin` có `S3Browser.exe` và `s3b_db.dll`; bản portable và installer NSIS có DLL; `dumpbin /dependents s3b_db.dll` không có `VCRUNTIME140.dll` (mục 9 B1)
- [ ] Tạo profile SQLite (chọn file bằng hộp thoại, bật/tắt chỉ đọc) và profile PostgreSQL → tắt app, mở lại → cả hai vẫn còn; sửa, xoá cũng giữ sau khởi động lại; cột `secret` trong DB app không chứa mật khẩu dạng rõ; Refresh đầu navbar nạp lại danh sách; Connect/Import đầu navbar vẫn toast "chưa có backend"
- [ ] Sửa profile (chưa Connect) đổi SQLite ↔ PostgreSQL → lưu được, `id` không đổi, tab đang gắn profile không lệch; profile đang Connect → ô loại DB, file, chỉ đọc bị khoá và có gợi ý "ngắt kết nối để sửa" (7 ngôn ngữ)
- [ ] Connect file `.db` thật → thẻ đổi trạng thái; file không tồn tại → toast DBE002; file không phải SQLite → toast DBE003
- [ ] Ctrl+E ở tab có profile SQLite chưa Connect → tự Connect rồi chạy
- [ ] Ctrl+E `SELECT` → lưới kết quả; `INSERT/UPDATE/DELETE/CREATE` → số dòng ở Messages; `SELECT 1; SELEC 2; SELECT 3;` → Result 1, Messages báo lỗi câu 2 (chỉ hiện text câu 2, không kèm câu 3), không chạy câu 3; `CREATE TABLE t(a); INSERT INTO t VALUES (1); SELECT * FROM t;` chạy hết; profile chỉ đọc + `INSERT` → lỗi ở Messages
- [ ] `SELECT` trên table 100.000 row → hiện 10.000 row đầu (Q16 = B), cuộn tới cuối tải thêm, UI không treo; hai câu SELECT lớn liền nhau → Result 1 có ghi chú "chỉ hiện N dòng đầu", Result 2 tải tiếp được
- [ ] Ô BLOB hiện hex đầy đủ dạng `0x...` (cắt bằng ellipsis trong ô); table có nhiều blob lớn → mỗi trang ≤ ~16 MiB (ít hơn 10.000 dòng), cuộn tiếp vẫn tải đủ, app không treo
- [ ] Câu chạy lâu (CTE đệ quy) → bấm Huỷ → dừng, không toast lỗi, log không có dòng Error; để quá 5 phút → toast DBE015; đóng tab / Disconnect / đổi profile của tab → backend đóng conn (FetchRows sau đó không trả dữ liệu)
- [ ] Log app không chứa câu SQL hay dữ liệu truy vấn
- [ ] Profile chưa Connect: không mở được Accordion, thẻ giống sprint-18; đã Connect: mở/đóng độc lập nhiều profile; SQLite `main` → Tables/Views/Indexes/Triggers, PG database → schema → nhóm, mỗi loại node có icon riêng, không có Queries/Backups
- [ ] Click đơn chỉ tô sáng; double click View/Index/Trigger không làm gì; double click table → mở tab `TableStructure` (icon khác, tên table), double click lần nữa → chuyển tới tab đó; tab đóng/kéo thả/sắp xếp được
- [ ] Tab `TableStructure` có Data (số thứ tự dòng, NULL khác màu, virtualize, cuộn ngang, SQLite tải theo trang), Column, Index, Constraint (PK, UNIQUE, CHECK parse bằng `sqlparser`), FK, Source (DDL) — SQLite lấy từ file thật, PG từ mock có table nhiều cột nhiều row
- [ ] Autocomplete trong tab SQL của profile SQLite gợi ý tên table/view của cây đã nạp
- [ ] Chọn tab gắn profile đã Connect mà Accordion đang đóng → tự mở, không đóng Accordion khác; Disconnect hoặc xoá profile → Accordion đóng, cây bị bỏ, tab `TableStructure` của profile đóng
- [ ] Đúng ở cỡ small/medium/large và theme sáng/tối (đo bằng Playwright root 14/16/18px hoặc xem tay, ghi rõ); chuỗi UI đủ 7 ngôn ngữ, cùng tập key với `en`
- [ ] Chế độ S3 không đổi hành vi (test S3 qua, `TabStrip` không sửa)
- [ ] R3: xem mục 10.11

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
| 23 | Tổng số vòng review: đây là vòng 2/3 của branch R2 | medium | Không thêm việc ngoài 9.1; quá vòng 3 thì dừng hỏi người dùng (bổ sung 9.7 là vòng người dùng đã đồng ý thêm — Q15 = A) |

### 9.6 Câu hỏi đã chốt (2026-11-17)
| # | Câu hỏi | Quyết định |
|---|---|---|
| Q13 | Sửa profile mà để trống ô mật khẩu (FE không nhận lại mật khẩu, chỉ có `hasSecret`) | **ĐÃ CHỐT (2026-11-17): A** — để trống ô mật khẩu thì giữ mật khẩu đã lưu nếu cùng provider (giống `fillEmpty` của profile S3); đổi provider thì bỏ mật khẩu cũ; sprint này chưa có cách xoá mật khẩu đã lưu |
| Q14 | Giá trị loại PostgreSQL ở FE là `postgresql` (`DbType`, `form.dbType.postgresql`), backend dùng `postgres` | **ĐÃ CHỐT (2026-11-17): A** — FE đổi `dbType` thành `provider` với giá trị `sqlite`/`postgres`, giữ nguyên tên key i18n `form.dbType.*`, chỉ map nhãn |

### 9.7 Bổ sung PR #43 trước khi merge (Q15 = A, Q16 = B, chốt 2026-11-18)
Thay đổi đang chưa commit trên `SP-19/sqlite_native_backend` được đưa vào chính PR #43 (vòng review bổ sung, người dùng đã đồng ý vượt 3 vòng):
- Rust: đường đọc dòng SQLite bằng C API (`rust/src/drivers/sqlite/raw.rs`, `actor.rs`, `value.rs`; `elapsedMs` 10.000 dòng ~54 ms → ~8 ms), test `rust/tests/sqlite_cursor.rs`, `rust/Cargo.toml`/`Cargo.lock`.
- Go: chuyển nguyên JSON của Rust ra FE (`models/db/query_output.go`, `models/db/query_output_json.go` (`//go:build !wailsgen`), `internal/modules/db/submodule_native_mng.go`, `submodule_query_mng.go`, `module.go`), tag `wailsgen` trong `build/Taskfile.yml` (`GEN_FLAGS`).
- `pageSize = 10000` ở `internal/modules/db/module.go` **giữ nguyên** (Q16 = B, người dùng chốt 2026-11-18 sau khi đo hiệu năng); plan R2 đã sửa các chỗ ghi 500. `requirement.md` (500 → 10.000 và ghi chú Q15) session chính đã sửa xong 2026-11-18.
- Thứ tự: rust-tester (chạy toàn bộ `cargo test`, bổ sung case cho đường đọc C API nếu thiếu: NULL/INTEGER/REAL/TEXT/BLOB, trang dừng ở `maxPageBytes`, huỷ giữa trang) → go-tester (hồi quy tạm: `ExecuteSql`/`FetchRows`/`OpenTableRows` trả đúng JSON gốc; lỗi từng mã vẫn map DBE như cũ; `cancelled` + Canceled vẫn im lặng; `MarshalJSON` có raw / không raw; request gửi `pageSize` 10.000) → skill `wails3-bindings` (kiểm `StatementResult`, `ExecuteSqlOutput`, `FetchRowsOutput` vẫn có class) → react-tester (toàn bộ `vitest run`, FE nhận trang 10.000 dòng) → verifier → code-reviewer → git-flow commit + push lên PR #43.

## 10. R3 — Driver Rust cho MySQL, MariaDB, PostgreSQL, SQL Server, MongoDB, Redis và bài đo (thêm 2026-11-18)

Đã chốt trước (poll 2026-11-18): gộp vào sprint-19; chỉ Rust driver + bài đo (chưa nối Go `modules/db` và FE); Oracle tạm bỏ; driver theo bảng `CLAUDE.md` §8; mục tiêu `elapsedMs` trang 10.000 dòng < 40 ms (nhắm < 20 ms), bản release, không debugger, DB local; MongoDB/Redis dùng lệnh gốc; report Excel.

Biện pháp giảm rủi ro 25, 26, 40 (golden test SQLite + mốc bench trước N4, N4 commit refactor riêng; spike N12; PG dùng decode của `postgres-protocol`, chỉ giải mã kiểu trong danh sách cho phép, test so sánh nhị phân/text; tách thời gian theo pha; tối ưu riêng MongoDB/SQL Server): **người dùng duyệt 2026-11-18**.

### 10.0 Câu hỏi (R3) — tất cả ĐÃ CHỐT 2026-11-18
| # | Câu hỏi | Phương án | Đề xuất | Trả lời |
|---|---|---|---|---|
| Q15 | Thay đổi chưa commit (SQLite C API, Go chuyển nguyên JSON, `wailsgen`) đưa vào branch nào | A: bổ sung vào PR #43<br>B: branch riêng sau #43<br>C: gộp vào branch R3 | A | **ĐÃ CHỐT 2026-11-18: A** — người dùng chấp nhận thêm một vòng review (mục 9.7) |
| Q16 | `pageSize` Go tạm 10000, quyết định cũ 500 | A: trả về 500<br>B: giữ 10000 | A | **ĐÃ CHỐT 2026-11-18: B** — giữ 10.000 sau khi đo hiệu năng; plan R2 và `requirement.md` đã sửa; rủi ro 39 |
| Q17 | Chia branch R3 | A: một branch `SP-19/native_db_drivers`<br>B: hai branch SQL/NoSQL<br>C: mỗi DB một branch | A | **ĐÃ CHỐT 2026-11-18: A** |
| Q18 | Thứ tự R1 và R3 | A: R1 trước<br>B: R3 trước | A | **ĐÃ CHỐT 2026-11-18: B** — R3 làm trước R1 (mục 5) |
| Q19 | TLS cho driver mạng | A: chưa bật TLS<br>B: rustls + `ring` ngay cho cả 5 crate<br>C: native-tls | A | **ĐÃ CHỐT 2026-11-18: B** — chi tiết 10.6; Rust nhận field `tls` trong `open`, nối Go/FE ngoài phạm vi R3 |
| Q20 | Đường đọc dòng PostgreSQL | A: simple query (text)<br>B: extended protocol nhị phân + tự giải mã OID | A | **ĐÃ CHỐT 2026-11-18: B** — danh sách OID và fallback ở 10.3a; rủi ro 40 |
| Q21 | Tách nhiều câu MySQL/MariaDB | A: Rust tách bằng tokenizer + `DELIMITER`<br>B: gửi cả đoạn cho server chạy multi-statement | A | **ĐÃ CHỐT 2026-11-18** — người dùng ghi "gửi cả đoạn cho rust xử lý hết". **Cách hiểu của plan**: Go gửi nguyên đoạn SQL xuống Rust (không tách ở Go), Rust tự tách câu bằng tokenizer `sqlparser` + hỗ trợ `DELIMITER` rồi chạy từng câu, mỗi câu có text và `elapsedMs` riêng — tức phương án A. Nếu người dùng ý là phương án B (server chạy multi-statement) thì báo lại |
| Q22 | Tách câu SQL Server | A: theo dòng `GO`<br>B: theo `;` | A | **ĐÃ CHỐT 2026-11-18: A** |
| Q23 | Huỷ câu SQL Server | A: đóng TCP rồi mở lại connection<br>B: chờ xong rồi bỏ kết quả<br>C: `KILL <spid>` | A | **ĐÃ CHỐT 2026-11-18: A** |
| Q24 | Cú pháp lệnh MongoDB | A: document `runCommand` dạng Extended JSON<br>B: tập con mongosh<br>C: cả hai | A | **ĐÃ CHỐT 2026-11-18: A** |
| Q25 | Quy đổi document MongoDB thành lưới | A: cột theo key cấp 1<br>B: một cột JSON<br>C: `_id` + JSON | A | **ĐÃ CHỐT 2026-11-18: một cột JSON** — FE (sau này) hiển thị mỗi document bằng `FieldInput` type `json` (Mantine `JsonInput`, `frontend/src/components/inputs/FieldInput.tsx` đã có case `'json'`), mỗi dòng một `FieldInput`. Rust trả mỗi document một dòng, một cột `document` chứa Extended JSON relaxed dạng gọn (Q33 = A). Phần FE ở 10.13 |
| Q26 | Quy đổi reply Redis | A: RESP3 quy đổi cột<br>B: một cột text như `redis-cli` | A | **ĐÃ CHỐT 2026-11-18: A** |
| Q27 | Dữ liệu bench Redis | A: LIST chứa JSON, đo `LRANGE`<br>B: STREAM<br>C: HASH mỗi dòng | A | **ĐÃ CHỐT 2026-11-18: A** |
| Q28 | Cách xuất Excel | A: `rust_xlsxwriter` dev-dependency của example bench<br>B: JSON + `exceljs` | A | **ĐÃ CHỐT 2026-11-18: A** |
| Q29 | Đo trang đầu n dòng | A: `pageSize = n`, bỏ trần byte khi bench<br>B: `pageSize` cố định 10.000 | A | **ĐÃ CHỐT 2026-11-18: A** |
| Q30 | Driver mới vào DLL phát hành | A: có, build mặc định<br>B: feature tắt mặc định | A | **ĐÃ CHỐT 2026-11-18: A** — report ghi kích thước DLL |
| Q31 | PostgreSQL: cột có kiểu không tự giải mã được (composite, range/multirange, `money`, `reg*`, kiểu extension) | A: câu đó chạy bằng simple query (text)<br>B: nhị phân, ô hiện hex + tên kiểu<br>C: B + giải mã composite/range | A | **ĐÃ CHỐT 2026-11-18: A** — `prepare` biết OID mọi cột trước khi chạy; câu có ít nhất một cột ngoài danh sách cho phép (10.3a) thì chạy bằng simple query protocol (text, server tự định dạng như `psql`), không chạy câu hai lần; `columns[].type` lấy từ `prepare` |
| Q32 | PostgreSQL: hiển thị `timestamptz` | A: luôn UTC dạng `...+00`<br>B: theo `TimeZone` phiên (`chrono-tz`)<br>C: cột `timestamptz` đi text protocol | A | **ĐÃ CHỐT 2026-11-18: A** — `2026-11-18 03:04:05.123456+00`, không thêm `chrono-tz`; khác `psql` chỉ ở cách hiển thị (giá trị đúng tuyệt đối) |
| Q33 | Chuỗi JSON của mỗi document MongoDB | A: JSON gọn một dòng, FE format dòng đang hiện<br>B: Rust thụt lề sẵn | A | **ĐÃ CHỐT 2026-11-18: A** — không xuống dòng/thụt lề; FE (10.13) format khi mount dòng |
| Q34 | Các chế độ TLS Rust nhận trong `open` | A: đủ 6 `SslMode` như FE<br>B: chỉ `disable` + `verify-full`<br>C: `disable`, `require`, `verify-full` | A | **ĐÃ CHỐT 2026-11-18: A** — `disable`, `allow`, `prefer`, `require`, `verify-ca`, `verify-full` cho mọi DB mạng; ngữ nghĩa từng chế độ ở 10.5; verifier riêng cho `require`/`verify-ca` gom trong `tls.rs` |
| Q35 | Nguồn root CA khi không có `caFile` | A: kho chứng chỉ Windows (`rustls-native-certs`)<br>B: `webpki-roots`<br>C: chỉ `caFile` | A | **ĐÃ CHỐT 2026-11-18: A** — nạp một lần (cache) cho cả process; có `caFile` thì chỉ tin CA trong file |
| Q36 | Test TLS bằng Docker | A: `gen-certs.sh` + bật TLS thật cho cả 6 DB<br>B: chỉ unit test cấu hình | A | **ĐÃ CHỐT 2026-11-18: A** — mount `test-env/certs/` vào compose, Redis thêm cổng TLS 10036; test từng chế độ (10.8) |

### 10.1 Hiện trạng đã kiểm trong code (R3)
- `rust/Cargo.toml`: package `s3b_db` (edition 2024, **không** phải workspace), `crate-type = ["cdylib", "rlib"]`; deps `libsqlite3-sys = "*"`, `serde`, `serde_json` (`raw_value`), `sqlparser 0.64`, `sqlx 0.9` (`sqlite`, `runtime-tokio`), `tokio 1.54` (`rt-multi-thread`, `sync`, `macros`, `time`); `panic = "unwind"`. `rust/.cargo/config.toml` bật `+crt-static` cho `x86_64-pc-windows-msvc`.
- Phần dùng chung đang gắn cứng SQLite:
  - `registry.rs` import `drivers::sqlite::{Cmd, raw::InterruptHandle}`; `ConnEntry.interrupt: InterruptHandle`.
  - `dispatch.rs` gọi thẳng `sqlite::open/close/request`.
  - `Cmd`, `Job`, `Reply`, `request()` nằm trong `drivers/sqlite/mod.rs`.
  - `Limits`, `Page`, `hold`, `read_page`, `statement_error`, `rows_statement`, `elapsed_ms`, `cancelled`, `cursor_not_found`, `RegistryGuard` nằm trong `drivers/sqlite/actor.rs`.
- `protocol::OpenParams` chỉ có `driver`, `path`, `readOnly`; `sqlite::open` từ chối driver khác `sqlite` (`invalidRequest`). `schemaTree`/`tableInfo`/`tableRows` chỉ SQLite có.
- Huỷ: `Job.cancel: Arc<AtomicBool>`; `Registry::cancel` đặt cờ, rồi interrupt khi `running == id`. Đủ cho SQLite (C API chặn thread, cờ kiểm giữa các dòng). Driver mạng chờ future async nên cần thêm cách đánh thức future đang chờ.
- Trang kết quả: `Vec<Vec<Option<String>>>`, byte = tổng `String::len` của ô khác NULL. `elapsedMs` đo từ trước prepare tới hết trang đầu, **chưa** gồm serialize JSON.
- Test tích hợp `rust/tests/common/mod.rs` gọi qua 4 hàm FFI (`s3b_init/call/cancel/free`) — dùng lại làm khung cho golden test, test DB mạng, spike và bench.
- `test-env/`: mỗi stack một file compose (`docker-compose-<x>.yml`, project `s3b-<x>-test`, container `s3b-test-<x>`), cổng đổi được bằng biến môi trường; cổng đã dùng: 10010, 10011, 10389, 4566, 8180, 10020, 10021. Có `scripts/gen-certs.sh` (sinh CA, cert server, cert client vào `certs/` bằng openssl; `certs/` đã gitignore) — dùng cho TLS (Q36 = A).
- FE đã có `SslMode` 6 giá trị (`dbProfileStore.ts`, `dbProfileSchema.ts`, mặc định `prefer`) — khớp Q34 = A; `FieldInput` type `json` (`JsonInput`) cho Q25.
- `docs/package.json` có `exceljs ^4.4.0` (không dùng vì Q28 = A).
- Go: `pageSize = 10000` (`internal/modules/db/module.go:71`, giữ theo Q16 = B), `maxPageBytes = 16 << 20`.
- Mốc ~8 ms cho 10.000 dòng SQLite (mục 9.7) là số đo đã báo trong PR #43; công cụ đo cụ thể **chưa xác minh** trong code → plan thêm test đo cố định (golden step, 10.4) để so trước/sau N4 trên cùng máy.
  - **Thực tế R3**: mốc ~8 ms lệch so với đo thật bằng `sqlite_perf` (12–21 ms tuỳ lần chạy trên cùng máy), vì bộ dữ liệu bench thật ~296 B/dòng (JSON 10.000 dòng = 2.957.357 B) chứ không phải ~220 B/dòng như ước ở 10.2. `sqlite_perf` chỉ dùng để so trước/sau trên cùng máy, không so với mốc ~8 ms.

### 10.2 Giả định (planner chọn, người dùng/reviewer có thể phản biện)
- Mỗi connection mạng cũng là một **actor tokio** như SQLite: actor sở hữu client/connection, nhận `Cmd` qua `mpsc`, giữ cursor trong hàm async của nó (mẫu `Held<'c>` + `hold`). Không thêm trait object cho driver; `Cmd` dùng chung, mỗi driver có `run()` riêng.
- `open` thêm field mạng, mọi field mới `#[serde(default)]`: `host`, `port`, `database`, `username`, `password`, `tls` (10.5). `driver` ∈ `sqlite`, `postgres`, `mysql`, `mariadb`, `sqlserver`, `mongodb`, `redis`.
  - `mariadb` dùng chung code `mysql_async`, chỉ khác tên.
  - `readOnly` chỉ áp cho SQLite.
  - Redis: `database` là số DB (mặc định 0).
  - Timeout kết nối (gồm bắt tay TLS) là hằng 10 giây trong Rust.
- Q21: Go (khi nối) gửi nguyên đoạn SQL; Rust tách câu cho mọi DB SQL (SQLite prepare-tail, PG/MySQL tokenizer, SQL Server `GO`).
- Không thêm mã lỗi mới; dùng lại mã có sẵn, Go map sau khi nối:
  - Không kết nối được, sai mật khẩu, lỗi TLS (cert không tin cậy, sai hostname), quá timeout → `openFailed` (message ghi rõ loại lỗi, không chứa mật khẩu).
  - Lệnh Mongo/Redis sai cú pháp → lỗi của câu (`sqlError` trong `statements[].error`).
  - `schemaTree`/`tableInfo`/`tableRows` trên connection không phải SQLite → `invalidRequest` ("method not supported by driver").
- `StatementResult` thêm field tuỳ chọn `firstRowMs`: từ lúc gửi câu tới khi có dòng đầu, tức thời gian server + mạng. Go đang chuyển nguyên JSON nên không ảnh hưởng.
- **Tách pha cho bench (rủi ro 26)**: thêm cargo feature `bench-timing` (mặc định **tắt**, DLL phát hành và Go không thấy). Khi bật, `StatementResult` có thêm `readMs` (tổng thời gian chờ crate trả dòng tiếp theo sau dòng đầu = đọc mạng + giải mã giao thức của crate) và `convertMs` (tổng thời gian code của mình đổi ô sang chuỗi + dựng trang), đo theo **dòng** (không theo ô) để overhead đo nhỏ. Bench ghi JSON = `callMs − elapsedMs`. Giới hạn: crate (tiberius, mongodb, mysql_async, tokio-postgres) đọc socket và giải mã giao thức trong cùng một lời gọi nên "đọc mạng" và "giải mã của crate" **không tách được** ở mức driver — report ghi chung một cột; spike N12 đo riêng thời gian đọc thô của crate để thấy phần này.
- Bỏ một cursor còn dòng (lệnh mới tới, `close`, `fetch` cursor khác) thì **huỷ phía server rồi đọc bỏ phần còn lại**, để lệnh sau không phải chờ hết kết quả lớn:
  - PostgreSQL: `CancelToken::cancel_query` (đi cùng cấu hình TLS của connection).
  - MySQL/MariaDB: `KILL QUERY <id>` qua connection phụ.
  - SQL Server: đóng TCP rồi mở lại connection (Q23 = A).
  - MongoDB: driver tự `killCursors` khi drop cursor.
  - Redis: reply đã nằm trọn trong RAM nên không cần.
- Redis:
  - Mỗi dòng không rỗng là một lệnh, tách token như `redis-cli`: `"..."` có escape `\n` và `\xHH`, `'...'`.
  - Chặn các lệnh đổi chế độ connection: `SUBSCRIBE`, `PSUBSCRIBE`, `SSUBSCRIBE`, `MONITOR` → lỗi của câu.
  - Reply nằm trọn trong RAM, cursor là chỉ số trong reply.
  - Huỷ bằng cách bỏ connection rồi mở lại, vì Redis không dừng được lệnh đang chạy.
- MongoDB:
  - `database` của `open` là DB mặc định.
  - `find`/`aggregate`/`listCollections`/`listIndexes` chạy như lệnh có cursor. Lệnh không ghi `batchSize` thì tự thêm `batchSize = pageSize` (batch đầu mặc định của server chỉ 101 document, nên thiếu tham số này trang 10.000 cần ~100 vòng `getMore`); `getMore` cũng dùng `batchSize = pageSize`.
  - Mọi kết quả trả dòng có **một cột `document`** (Q25), mỗi document một dòng, Extended JSON relaxed dạng gọn một dòng (Q33 = A), ghi thẳng từ `RawDocument` (10.3).
  - `insert`/`update`/`delete` → `kind: "affected"` với `rowsAffected = n` của reply.
  - Lệnh khác (`ping`, `buildInfo`...) → reply là một document, hiện thành một dòng.
- Bộ dữ liệu bench (sinh tất định, không dùng crate `rand`):
  - 10 cột: `id` int PK, `n_int` int, `n_big` bigint, `n_float` double, `n_dec` decimal(12,2), `s_short` varchar(32), `s_long` varchar(200) khoảng 120 ký tự có cả unicode, `flag` bool, `ts` timestamp, `maybe_null` varchar(32) với khoảng 20% NULL.
  - Khoảng 220 byte mỗi dòng, nên 10.000 dòng ≈ 2,2 MB JSON (khớp mốc ~2 MB của `CLAUDE.md` §8). **Thực tế R3**: JSON đo được ~295–303 B/dòng với DB SQL (SQLite 2.957.357 B cho 10.000 dòng), ~407 B/dòng với MongoDB/Redis (có tên field trong mỗi dòng), tức ~3 MB / ~4 MB cho 10.000 dòng.
  - Mỗi DB dùng kiểu tương đương phổ biến nhất: SQL Server dùng `NVARCHAR`/`DATETIME2`/`BIT`; Mongo cùng field (kết quả là một cột JSON nên số byte lớn hơn do có tên field); Redis theo Q27 = A.
  - Bench đo cả **SQLite** làm mốc so sánh (không cần Docker).
  - Bench chạy **không TLS** (`tls.mode = disable`) để số đo so được giữa các DB; TLS chỉ kiểm chức năng trong test.
- Bench nạp dữ liệu qua chính `s3b_call` (INSERT nhiều dòng mỗi câu; Mongo lệnh `insert`; Redis `RPUSH`). Không có script SQL riêng cho từng DB, nên dữ liệu chắc chắn giống nhau. Nạp lại chỉ khi bảng/collection/key chưa đủ n dòng; dữ liệu giữ trong named volume giữa các lần chạy.
- Một file compose `test-env/docker-compose-db.yml` (project `s3b-db-test`) có 6 service, chạy riêng được từng service (`docker compose ... up -d postgres`). Giống mẫu "một stack một file" đang có. TLS bật tuỳ chọn (client vẫn nối được không TLS) để cùng service phục vụ cả bench và test TLS.
- Một lệnh: `test-env/db-bench.ps1`:
  1. `docker compose ... up -d --wait` (có healthcheck).
  2. Lấy CPU/RAM/OS bằng `Get-CimInstance`.
  3. `cargo run --release --target x86_64-pc-windows-msvc --features bench-timing --example db_bench`.
  4. In đường dẫn file `.xlsx`.

  Report ghi vào `test-env/db/report/` (gitignore).

### 10.3 Kiến trúc chung (N4)
- **`drivers/mod.rs`** chứa phần dùng chung. Chuyển từ `drivers/sqlite/mod.rs` sang: `Cmd`, `Job`, `Reply`, `request()`; thêm `open()` chọn driver theo `p.driver`. `dispatch.rs` chỉ còn gọi `drivers::open/close/request`.
- **`drivers/common.rs`** (mới) nhận phần chung chuyển từ `sqlite/actor.rs`, giữ nguyên hành vi:
  - `Limits`, `Page`, `PageBuilder` (đẩy dòng, cộng byte, dừng ở `page_size`/`max_bytes`, luôn ≥ 1 dòng).
  - Các hàm dựng `StatementResult`: `rows_statement`, `affected_statement`, `statement_error`.
  - `elapsed_ms`, `cancelled()`, `cursor_not_found()`, `RegistryGuard`.
  - `hold<C: Cursor>()` generic, với `trait Cursor { fn id(&self) -> u64; async fn next_page(&mut self, limits, cancel) -> DbResult<Page>; async fn abandon(self); }`. `async fn` trong trait đã stable; dùng generic nên không cần `dyn`.
  - `Held` của SQLite implement `Cursor` (`next_page` gọi `read_page` cũ).
  - `hex` (chuyển từ `sqlite/value.rs`).
  - Bộ đếm `readMs`/`convertMs` chỉ biên dịch khi bật feature `bench-timing` (`#[cfg(feature = "bench-timing")]`), để đường đọc của bản phát hành không có thêm `Instant::now()`.
- **`drivers/datetime.rs`** (mới): đổi số ngày/micro giây/ticks sang chuỗi ISO (`civil_from_days` thuần, không `chrono`) — dùng cho phần ghi chuỗi của PostgreSQL (sau khi `postgres-protocol` đã giải mã ra số) và SQL Server.
- **`drivers/tls.rs`** (mới, Q19 = B, Q34 = A, Q35 = A):
  - Cài `ring` làm `CryptoProvider` mặc định của process một lần ở `s3b_init` (bỏ qua nếu đã cài) để crate nào gọi `ClientConfig::builder()` cũng dùng `ring`.
  - Dựng `rustls::ClientConfig` theo `tls.mode` (ngữ nghĩa ở 10.5): `verify-full` dùng `WebPkiServerVerifier` chuẩn; `verify-ca` dùng verifier riêng bọc verifier chuẩn và bỏ lỗi sai hostname (vẫn kiểm chuỗi CA, hạn dùng); `require`/`prefer`/`allow` dùng verifier riêng chấp nhận mọi cert nhưng vẫn kiểm chữ ký bắt tay (`verify_tls12/13_signature`) — giống `sslmode=require` của libpq.
  - Root CA: có `caFile` thì chỉ tin CA trong file PEM; không có thì nạp kho chứng chỉ Windows qua `rustls-native-certs` (Q35 = A). Kho Windows nạp một lần cho cả process (`OnceLock`), `ClientConfig` cache theo (`mode`, `caFile`). **Thực tế R3**: không dùng `rustls-pemfile`; `caFile` đọc bằng trait `PemObject` (`CertificateDer::pem_slice_iter`) của `rustls-pki-types` (dùng qua re-export `rustls::pki_types`, crate `rustls-pki-types` khai báo trực tiếp trong `Cargo.toml`); hàm dùng chung `tls::root_certs_der` trả danh sách cert DER cho driver không nhận `ClientConfig` (SQL Server, MongoDB).
  - Mọi verifier riêng gom trong file này, có test (10.8).
- **Huỷ**:
  - `Job.cancel` đổi thành `Arc<CancelSignal>` gồm `flag: AtomicBool` và `notify: tokio::sync::Notify`.
  - Driver mạng chờ mọi future bằng `tokio::select!` giữa future và `cancelled()`. Phải đăng ký `notified()` trước khi đọc cờ để không lỡ tín hiệu.
  - `ConnEntry.interrupt` đổi từ `InterruptHandle` sang `Arc<dyn Interrupt + Send + Sync>`.
    - SQLite: gọi `sqlite3_interrupt` như cũ.
    - Driver mạng: spawn task trên runtime chung để huỷ phía server (`CancelToken::cancel_query`, `KILL QUERY`). `s3b_cancel` chạy trên thread của Go nên không được chặn.
  - Giữ đúng quy tắc B4: chỉ interrupt khi `running == id`, đọc dưới lock `conns`.
- **Tách câu** — `drivers/split_sql.rs` (mới), dùng tokenizer của `sqlparser` (không parse cả câu), trả danh sách khoảng byte của từng câu:
  - PostgreSQL: dialect `PostgreSqlDialect`, chuỗi `$$`/`$tag$` là một token. Extended protocol chỉ nhận một câu mỗi lần `Parse` nên PG bắt buộc tách ở Rust.
  - MySQL/MariaDB: `MySqlDialect`, comment `#`, backtick, lệnh `DELIMITER` (Q21).
  - SQL Server: tách theo dòng `GO` (Q22 = A), không dùng tokenizer để tìm `;`.
  - Tokenizer lỗi (ký tự lạ) thì coi cả đoạn là một câu, để server báo lỗi.
  - Tokenizer trả vị trí dòng/cột chứ không phải byte offset (**chưa xác minh**) → đổi sang byte offset trong `split_sql.rs`.
  - SQLite giữ prepare-tail như cũ.
- **Chuyển giá trị sang chuỗi** — mỗi ô cấp phát đúng một `String`, không qua `serde_json::Value`, không `format!` cho từng byte:
  - PostgreSQL: nhị phân theo 10.3a (giải mã bằng `postgres-protocol`, chỉ phần ghi chuỗi tự viết).
  - MySQL/MariaDB: text protocol (`query_iter`) trả mọi ô dạng bytes → `String::from_utf8` lấy luôn `Vec` sẵn có, không copy. Cột charset binary (63) → hex (`common::hex`).
  - SQL Server: đọc thẳng `tiberius::ColumnData` của từng ô (không qua `Row::get`/`FromSql` sang kiểu trung gian) → chuỗi. Số dùng `itoa`/`Display`; `Numeric` dùng `Display`; ngày giờ qua `datetime.rs`, không kéo `chrono`; `uniqueidentifier` dùng `Display`; binary → hex; `NVARCHAR` đã là UTF-8 sau khi tiberius giải mã.
  - MongoDB: đọc `RawDocument`/`RawDocumentBuf` và **tự ghi Extended JSON relaxed dạng gọn** (Q33 = A) bằng cách duyệt phần tử thô, ghi thẳng vào một `String` cấp sẵn capacity bằng cỡ document × ~1,3 — không đổi sang `Document`/`Bson`/`serde_json::Value`. ObjectId → `{"$oid":"..."}`, Date → `{"$date":"<ISO>"}` (relaxed), Int32/Int64/Double → số JSON (Double NaN/Inf theo dạng `{"$numberDouble":"..."}`), Decimal128 → `{"$numberDecimal":"..."}`, Binary → `{"$binary":{"base64":"...","subType":"xx"}}`, chuỗi escape đúng JSON.
  - Redis: reply → chuỗi theo Q26 = A.
- **Đo thời gian**: `elapsedMs` đo từ lúc gửi câu tới hết trang đầu (như SQLite); `firstRowMs` đo tại lúc nhận dòng đầu; `readMs`/`convertMs` chỉ khi bật `bench-timing`.

#### 10.3a PostgreSQL extended protocol nhị phân (Q20 = B, Q31 = A, Q32 = A; giảm rủi ro 40 — người dùng duyệt 2026-11-18)
- Mỗi câu: `prepare` (lấy `Type` của từng cột) → nếu **mọi** cột thuộc **danh sách cho phép** (bảng dưới): `query_raw` (Bind với kết quả nhị phân) → stream `Row`; lấy bytes thô của ô (`Row::col_buffer` hoặc `FromSql` cho `&[u8]`, **chưa xác minh** API trên bản sẽ dùng; rust-native kiểm docs.rs `tokio-postgres`/`postgres-types` trước khi code).
- **Giải mã bằng `postgres-protocol`** (crate cùng bộ với `tokio-postgres`, đã là dependency của nó; khai báo trực tiếp với version khớp bản `tokio-postgres` kéo vào, kiểm `cargo tree -i postgres-protocol` chỉ một bản): dùng các hàm `postgres_protocol::types::*_from_sql` cho bool, int2/int4/int8/oid, float4/float8, text (`text_from_sql`), bytea, date/time/timestamp/timestamptz (ra số ngày/micro giây), uuid, inet/cidr, macaddr, mảng (`array_from_sql` → duyệt chiều + phần tử, phần tử giải mã bằng chính các hàm trên). Tên hàm cụ thể và việc có `macaddr8`, `timetz`, `varbit` hay không **chưa xác minh**; kiểu nào không có hàm decode sẵn thì tự giải mã theo định dạng nhị phân chuẩn của PG, hoặc bỏ khỏi danh sách cho phép (khi đó đi simple query) — rust-native chọn và ghi vào báo cáo.
- **Chỉ phần ghi ra chuỗi là tự viết** (`postgres/value.rs`, `array.rs`): số → `itoa`/`Display`, ngày giờ → `datetime.rs`, bytea → `\x` + hex, mảng → cú pháp `{...}` với quy tắc quote của PG.
- **`numeric` và `interval`**: `postgres-protocol` có thể không có hàm decode (**chưa xác minh**) → có thể phải tự giải mã: `numeric` = header (ndigits, weight, sign, dscale) + các nhóm chữ số cơ số 10000; `interval` = micro giây (i64) + ngày (i32) + tháng (i32). Có hàm sẵn thì dùng.
- **Danh sách cho phép**: chỉ kiểu trong bảng dưới mới đi nhị phân. Kiểu khác (composite, range/multirange, `money`, `reg*`, `tsvector`, `point`/geometric, kiểu extension như PostGIS, mảng của các kiểu này, và mọi kiểu bị bỏ khỏi danh sách do thiếu hàm decode) → **cả câu** chạy bằng simple query protocol (Q31 = A, `simple_query_raw`, server trả text như `psql`), không chạy câu hai lần; `columns[].type` vẫn lấy từ `prepare`. Simple query dùng stream `SimpleQueryMessage` cùng cơ chế trang/`hold` (**chưa xác minh** `simple_query_raw` trả stream; nếu không thì đọc theo trang trên API có sẵn hoặc báo về).
- Câu không trả dòng (`prepare` không có cột) → `execute_raw` → `rowsAffected`. Hai vòng mạng (Parse/Describe, rồi Bind/Execute) mỗi câu — tính vào `firstRowMs`.
- Bảng kiểu (định dạng chuỗi theo mặc định của `psql` với `DateStyle = ISO`, `IntervalStyle = postgres`):

  | Nhóm | Kiểu (OID) | Giải mã | Chuỗi ra |
  |---|---|---|---|
  | Số nguyên | `int2`, `int4`, `int8`, `oid` | `postgres-protocol` | `itoa` |
  | Số thực | `float4`, `float8` | `postgres-protocol` | `Display` của Rust (ngắn nhất, khứ hồi đúng); `NaN`, `Infinity`, `-Infinity` như PG; `-0` như server (kiểm bằng test so sánh) |
  | Số thập phân | `numeric` | tự viết nếu không có hàm sẵn (chưa xác minh) | nhóm chữ số cơ số 10000 + `dscale`; `NaN`, `Infinity`, `-Infinity` |
  | Logic | `bool` | `postgres-protocol` | `t` / `f` (như `psql`) |
  | Chuỗi | `text`, `varchar`, `bpchar`, `name`, `char`, `unknown`, `xml`, `citext` (OID động, nhận theo tên kiểu) | `text_from_sql` | UTF-8 nguyên bytes (không copy thêm) |
  | Enum | mọi kiểu `Kind::Enum` | text | nhãn enum (dạng nhị phân là text) |
  | Domain | `Kind::Domain(base)` | theo kiểu gốc | theo kiểu gốc (kiểu gốc ngoài danh sách → simple query) |
  | Ngày giờ | `date`, `time`, `timetz`, `timestamp`, `timestamptz` | `postgres-protocol` (`timetz` chưa xác minh) | ISO qua `datetime.rs`; `infinity`/`-infinity`; ngày BC có hậu tố ` BC`; **`timestamptz` luôn UTC dạng `YYYY-MM-DD HH:MM:SS[.ffffff]+00`** (Q32 = A, không đọc `TimeZone` phiên, không thêm `chrono-tz`) |
  | Khoảng | `interval` | tự viết nếu không có hàm sẵn (chưa xác minh) | dạng `postgres`: `1 year 2 mons 3 days 04:05:06.789` |
  | Định danh | `uuid` | `postgres-protocol` | dạng 8-4-4-4-12 |
  | JSON | `json` (text), `jsonb` (bỏ byte phiên bản đầu) | text | chuỗi JSON nguyên văn |
  | Nhị phân | `bytea` | `postgres-protocol` | `\x` + hex (như `psql`), dùng `common::hex` |
  | Mạng | `inet`, `cidr`, `macaddr`, `macaddr8` | `postgres-protocol` (`macaddr8` chưa xác minh) | dạng chuẩn PG |
  | Bit | `bit`, `varbit` | `postgres-protocol` nếu có (chưa xác minh) | chuỗi `0`/`1` |
  | Mảng | `Kind::Array(elem)` với `elem` thuộc các nhóm trên, nhiều chiều | `array_from_sql` | `{a,b,"c d",NULL}` theo quy tắc quote của PG |

- Giải mã nhị phân lỗi giữa chừng (dữ liệu bất thường) → ô hiện `0x<hex>` thay vì làm hỏng cả trang, không ghi dữ liệu vào message lỗi.
- `columns[].type` = tên kiểu từ `Type::name()`.
- **Test so sánh nhị phân/text** (bắt buộc, 10.8): trên PostgreSQL Docker, cùng một câu chạy hai đường — nhị phân (driver) và text (simple query, hoặc `SELECT col::text`) — so **từng ô**; lệch là fail (riêng `timestamptz` so sau khi phiên đặt `TimeZone = 'UTC'`, và có test riêng cho Q32).

### 10.4 Task native R3 (rust-native)
Bước trước N4 (rust-tester, **commit riêng trước commit refactor**, giảm rủi ro 25 — người dùng duyệt 2026-11-18): viết golden test và test đo SQLite trên code **hiện tại** (sau khi PR #43 merge, chưa refactor), sinh file golden, ghi số đo mốc. Chi tiết ở 10.8 (dòng "Golden SQLite").

**Trạng thái (thực tế R3):** golden test và N4, N10, N5, N6, N7, N8, N9, N11 **đã xong và đã commit** trên `SP-19/native_db_drivers` (mỗi driver một commit). N12 là spike tạm, không commit theo plan. Crate và feature thật của toàn bộ crate: xem bảng 10.6 (theo `rust/Cargo.toml`).

| # | Task | Yêu cầu | File sửa / tạo | Phụ thuộc |
|---|---|---|---|---|
| N4 | **[Đã xong]** Lớp chung cho mọi driver (10.3), **một commit refactor riêng, không đổi hành vi** (người dùng duyệt 2026-11-18): chuyển `Cmd/Job/request` lên `drivers/mod.rs`, `drivers::open` chọn driver; `common.rs` (Limits, Page/PageBuilder, dựng StatementResult, `hold<C: Cursor>`, `hex`, bộ đếm `bench-timing`); `datetime.rs`; `tls.rs` (cài provider `ring` ở `s3b_init`, dựng `ClientConfig` cho đủ 6 `mode` (Q34 = A), root CA từ kho Windows qua `rustls-native-certs` hoặc `caFile` (Q35 = A), cache config); `CancelSignal` + `Interrupt` trong registry; `split_sql.rs` (PG, MySQL + `DELIMITER`, MSSQL `GO`); `OpenParams` thêm field mạng + `tls`; `firstRowMs`; feature `bench-timing`; SQLite chuyển sang dùng phần chung. Điều kiện xong: golden test SQLite trùng từng byte sau chuẩn hoá (10.8) và test đo SQLite 10.000 dòng không tăng so với mốc (10.8) | R3 | rust/src/drivers/mod.rs, rust/src/drivers/common.rs, rust/src/drivers/datetime.rs, rust/src/drivers/tls.rs, rust/src/drivers/split_sql.rs (tạo), rust/src/drivers/sqlite/mod.rs, rust/src/drivers/sqlite/actor.rs, rust/src/drivers/sqlite/value.rs, rust/src/drivers/sqlite/raw.rs (impl `Interrupt`), rust/src/registry.rs, rust/src/dispatch.rs, rust/src/ffi.rs (cài provider), rust/src/protocol/mod.rs (sửa); rust/Cargo.toml (sửa: `rustls`, `rustls-native-certs`, `rustls-pki-types` (thực tế, thay `rustls-pemfile` dự kiến ban đầu), `[features] bench-timing = []`) | PR #43 (gồm 9.7) đã merge; golden test đã commit |
| N10 | **[Đã xong]** Môi trường DB Docker: `docker-compose-db.yml` 6 service, image ghim tag cụ thể (đề xuất `mysql:8.4.x`, `mariadb:11.4.x`, `postgres:17.x`, `mcr.microsoft.com/mssql/server:2022-CUxx-ubuntu-22.04`, `mongo:8.0.x`, `redis:7.4.x`; agent chọn tag patch đang có trên registry và ghi vào report), healthcheck cho `--wait`, cổng 10030–10035 (MySQL, MariaDB, PG, MSSQL, Mongo, Redis) + 10036 (Redis TLS) đổi được bằng biến môi trường, named volume; Redis bật `--enable-debug-command yes` (test huỷ bằng `DEBUG SLEEP`) và `--requirepass`; **TLS thật cho cả 6 DB (Q36 = A)**: mount `test-env/certs/` (sinh bằng `scripts/gen-certs.sh`), mỗi DB bật TLS **tuỳ chọn** (client không TLS vẫn nối được, để bench chạy không TLS): PG `ssl=on`, MySQL/MariaDB `ssl-cert/ssl-key/ssl-ca`, MSSQL cert qua `mssql.conf` (`forceencryption=0`), Mongo `--tlsMode allowTLS`, Redis `--tls-port 10036` cạnh cổng thường; file `db/db.env` chứa host/cổng/user/mật khẩu test (dùng chung cho compose, test, spike và bench); README thêm mục DB (cách sinh cert, dựng, yêu cầu RAM của MSSQL); `.gitignore` thêm `db/report/` | R3 | test-env/docker-compose-db.yml, test-env/db/db.env, test-env/db/mssql.conf (tạo nếu cần), test-env/README.txt, test-env/.gitignore (sửa); test-env/scripts/gen-certs.sh (sửa nếu thiếu SAN `127.0.0.1`/`localhost` hoặc quyền đọc key cho user trong container — chưa xác minh) | - |
| N12 | **Spike đo crate** (giảm rủi ro 26 — người dùng duyệt 2026-11-18), ngay sau N4 + N10, trước khi viết driver: example tối giản đo **thời gian đọc thô** 10.000 dòng (bộ dữ liệu 10 cột của bench, nạp bằng client của chính crate) với `tiberius` (đọc hết `QueryStream`, chạm từng `ColumnData` nhưng không đổi sang chuỗi; packet size tối đa, `TCP_NODELAY`) và `mongodb` (`find` với `batchSize = 10000`, duyệt `RawDocument`, không đổi sang JSON), trên Docker local, bản release, 3 lần khởi động + 15 lần đo, báo min/trung vị/max. **Trung vị của crate > 40 ms thì dừng và báo về** cho người dùng quyết định trước khi viết N7/N8; 20–40 ms thì ghi chú, làm tiếp. Code spike là file tạm: xoá sau khi đo, khôi phục `Cargo.toml`/`Cargo.lock`, **không commit**; số đo ghi vào báo cáo của task và report sprint | R3 | rust/examples/spike_read.rs (tạm), rust/Cargo.toml (tạm: `[dev-dependencies]` `tiberius`, `tokio-util`, `mongodb`) — xoá/khôi phục sau khi đo | N4, N10 |
| N5 | **[Đã xong]** Driver PostgreSQL `tokio-postgres` + `postgres-protocol`: open (connection task spawn trên runtime chung, TLS qua `tokio-postgres-rustls` với `ClientConfig` của `tls.rs`, `allow`/`prefer` thử theo thứ tự như libpq, timeout 10s), actor, execute tách câu bằng `split_sql`, đọc dòng **nhị phân** theo 10.3a: **giải mã bằng hàm của `postgres-protocol`**, chỉ phần ghi chuỗi tự viết (`numeric`/`interval` có thể tự giải mã — chưa xác minh), **chỉ kiểu trong danh sách cho phép**, kiểu khác chạy simple query (Q31 = A), `timestamptz` UTC (Q32 = A), giữ stream làm cursor (`Cursor`), huỷ bằng `CancelToken` + `select!`, bỏ cursor = cancel + đọc bỏ. Điều kiện xong: test so sánh nhị phân/text trên Docker (10.8) qua cho mọi kiểu trong danh sách và mọi giá trị biên, không lệch ô nào | R3 | rust/src/drivers/postgres/mod.rs, actor.rs, value.rs (ghi chuỗi + giải mã numeric/interval nếu cần), array.rs (mảng) (tạo); rust/Cargo.toml (sửa: `tokio-postgres`, `postgres-protocol`, `tokio-postgres-rustls`) | N4, N10, N12 |
| N6 | **[Đã xong]** Driver MySQL/MariaDB `mysql_async`: open (`OptsBuilder`, TLS rustls theo `tls` 6 chế độ — feature thực tế `default-rustls-ring`), actor, tách câu + `DELIMITER` (Q21), `query_iter` text protocol giữ `QueryResult` làm cursor, `affected_rows` cho câu không trả dòng, huỷ `KILL QUERY` qua connection phụ mở khi cần (cùng cấu hình TLS), cột binary → hex | R3 | rust/src/drivers/mysql/mod.rs, actor.rs, value.rs (tạo); rust/Cargo.toml (sửa: `mysql_async` `default-features = false`, `default-rustls-ring`) | N4, N10, N12 |
| N7 | **[Đã xong]** Driver SQL Server `tiberius` (+ `tokio-util` compat): open (SQL auth, `EncryptionLevel` + `trust_cert` theo 6 chế độ `tls`; TLS của tiberius là rustls — phiên bản rustls và cách truyền `ClientConfig` riêng **chưa xác minh**, xem rủi ro 41; tiberius không nhận được verifier riêng thì `verify-ca` ánh xạ gần nhất và báo về), **tối ưu đọc (người dùng duyệt 2026-11-18)**: packet size TDS tối đa (32767, qua `Config::packet_size` hoặc tương đương — **chưa xác minh** tên API), `TcpStream::set_nodelay(true)` trước khi giao cho tiberius, đọc thẳng `ColumnData` của từng ô; actor, tách theo `GO` (Q22 = A), `QueryStream` nhiều result set → nhiều Result, đổi `ColumnData` sang chuỗi qua `datetime.rs`, huỷ bằng đóng TCP rồi mở lại connection (Q23 = A, connection mở lại dùng cùng packet size/nodelay/TLS). **Thực tế R3**: client yêu cầu tối đa nhưng packet size server thương lượng là mức tối đa server cho phép, gần 32767 chứ không bằng giá trị yêu cầu: 32576 B khi không TLS, 16554 B khi có TLS; `verify-ca` ánh xạ gần nhất (xem 10.5) | R3 | rust/src/drivers/sqlserver/mod.rs, actor.rs, value.rs (tạo); rust/Cargo.toml (sửa) | N4, N10, N12 (spike không vượt 40 ms) |
| N8 | **[Đã xong]** Driver MongoDB `mongodb` (đọc BSON thô): open (`ClientOptions` dựng bằng code, không qua URI để không lộ mật khẩu trong lỗi; `tls` theo `tls.rs`: `verify-ca` → `allow_invalid_hostnames`, `require`/`prefer`/`allow` → `allow_invalid_certificates`), parse lệnh `runCommand` Extended JSON (Q24 = A), lệnh có cursor qua `run_raw_cursor_command`/`run_cursor_command` với `RawDocumentBuf` (tên API **chưa xác minh**), **`batchSize = pageSize`** cho lệnh đầu và `getMore` khi lệnh không ghi (batch đầu mặc định chỉ 101 document — người dùng duyệt 2026-11-18), mỗi document một dòng, một cột `document` (Q25) ghi Extended JSON relaxed **dạng gọn một dòng** (Q33 = A) **thẳng từ `RawDocument`** bằng bộ ghi tự viết (10.3), lệnh ghi → `affected`, huỷ bằng `select!` + drop. **Thực tế R3**: `verify-ca` = `verify-full` (có kiểm hostname), không dùng `allow_invalid_hostnames`; xem 10.5 | R3 | rust/src/drivers/mongodb/mod.rs, actor.rs, command.rs, ejson.rs (tạo); rust/Cargo.toml (sửa: `mongodb` `default-features = false`, `compat-3-0-0`, `rustls-tls`) | N4, N10, N12 (spike không vượt 40 ms) |
| N9 | **[Đã xong]** Driver Redis `redis`: open (AUTH, chọn DB, RESP3 theo Q26 = A, `allow`/`prefer` thử theo thứ tự), tách lệnh như `redis-cli`, chặn lệnh pub/sub/monitor, quy đổi reply theo Q26, phân trang trên reply trong RAM, huỷ = bỏ connection + mở lại. **Thực tế R3**: crate `redis` chỉ bật `tokio-comp` (không bật feature TLS nào của `redis`); TLS làm trực tiếp bằng `tokio-rustls` (`TlsConnector` dựng từ `ClientConfig` của `tls.rs`, `drivers/redis/mod.rs`) | R3 | rust/src/drivers/redis/mod.rs, actor.rs, command.rs, value.rs (tạo); rust/Cargo.toml (sửa: `redis` `default-features = false`, `tokio-comp`; `tokio-rustls`) | N4, N10 |
| N11 | **[Đã xong]** Bench + report Excel: example `db_bench` gọi qua 4 hàm FFI, build với `--features bench-timing`. Mỗi DB (SQLite + 6 DB Docker, không TLS): kiểm DB có chạy không (không chạy → ghi "không chạy", không fail cả bench), nạp dữ liệu nếu thiếu, lấy phiên bản DB. Mỗi n ∈ {1.000, 10.000, 100.000}: `pageSize = n`, `maxPageBytes` không giới hạn (Q29 = A); 3 lần khởi động + 15 lần đo, lấy `elapsedMs`, `firstRowMs`, `readMs`, `convertMs` từ response và `callMs` (wall time của `s3b_call`, gồm serialize JSON) cùng số byte JSON. **Tách thời gian theo pha** (người dùng duyệt 2026-11-18): server = `firstRowMs`; đọc mạng + giải mã giao thức của crate = `readMs` (không tách được hai phần này, xem 10.2; số đọc thô của spike N12 ghi cạnh để so); đổi sang chuỗi/dựng trang = `convertMs`; ghi JSON = `callMs − elapsedMs`. Ghi `.xlsx` bằng `rust_xlsxwriter` (Q28 = A): sheet Summary (DB × n: min/trung vị/max của `elapsedMs` và `callMs`, trung vị từng pha; đạt < 40 ms / nhắm < 20 ms cho n = 10.000), sheet Runs (mọi lần đo, mọi pha), sheet Env (phiên bản DB, phiên bản crate driver đọc từ `Cargo.lock`, kích thước `s3b_db.dll` release (Q30 = A), CPU/RAM/OS do script truyền vào, commit git, ngày giờ). Script `db-bench.ps1` chạy tất cả bằng một lệnh. Kết quả đo: xem 10.11 (dòng mục tiêu < 40 ms) | R3 | rust/examples/db_bench/main.rs, data.rs, report.rs (tạo); rust/Cargo.toml (sửa: `[dev-dependencies]` `rust_xlsxwriter`, `[[example]] db_bench` `test = true`); test-env/db-bench.ps1 (tạo) | N5–N9 |

Thứ tự trong branch (người dùng duyệt 2026-11-18): golden test SQLite + mốc đo (commit riêng) → N4 (commit refactor riêng; golden + đo phải qua) → N10 → **N12 spike** (dừng nếu crate > 40 ms) → N5 → N6 → N7 → N8 → N9 → N11. Mỗi driver một commit riêng để dễ review.

### 10.5 Hợp đồng JSON thay đổi (R3)
- `open` params: `{driver, path?, readOnly?, host?, port?, database?, username?, password?, tls?}`.
  - `tls`: `{mode: "disable"|"allow"|"prefer"|"require"|"verify-ca"|"verify-full", caFile?: string}`; thiếu `tls` = `disable`. Cert client (mTLS) chưa có ở R3 (10.13). Ngữ nghĩa (Q34 = A, theo libpq):

    | mode | Thử TLS | Kiểm chuỗi CA | Kiểm hostname | Server không hỗ trợ TLS |
    |---|---|---|---|---|
    | `disable` | không | — | — | nối thường |
    | `allow` | thử không TLS trước, server bắt buộc TLS thì nối TLS | không | không | nối thường |
    | `prefer` | thử TLS trước, không được thì nối thường | không | không | nối thường |
    | `require` | bắt buộc | không | không | `openFailed` |
    | `verify-ca` | bắt buộc | có (`caFile` hoặc kho Windows) | không | `openFailed` |
    | `verify-full` | bắt buộc | có | có | `openFailed` |

    Với driver không tự thử lại được (Mongo, SQL Server), `allow`/`prefer` thực hiện bằng hai lần thử kết nối trong cùng timeout 10 giây.
  - **Xấp xỉ và giới hạn thực tế R3** (khác bảng trên, do API của crate; người dùng đã biết):
    - SQL Server (đã kiểm `drivers/sqlserver/mod.rs` `attempts`, 2026-11-20): `allow`/`prefer`/`require` = `EncryptionLevel::Required` + `trust_cert()` (mã hoá, không kiểm cert); `verify-ca` nghiêm ngặt như `verify-full` (**vẫn kiểm hostname**) vì `tiberius` không có cách bỏ riêng kiểm hostname — code **không** dùng `hostname_in_certificate`. Với `verify-*`, `caFile` được đọc bằng `tls::root_certs_der` rồi nạp từng cert qua `trust_cert_ca_bundle` trong RAM và **cộng dồn với kho chứng chỉ Windows** (`tiberius` không có chế độ "chỉ tin file này") — khác Q35 ("có `caFile` thì chỉ tin CA trong file"). SQL Server **không** ghi file CA tạm; `s3b_mssql_ca_<pid>` chỉ là thư mục tạm của test `#[cfg(test)]` trong `sqlserver/mod.rs` (`verify_modes_reject_a_bad_ca_file_before_connecting_and_without_leaking_it`). `caFile` chỉ được đọc ở `verify-*`, các mode khác bỏ qua.
    - MySQL/MariaDB và MongoDB: `verify-ca` = `verify-full` (có kiểm hostname).
    - Redis `verify-ca`: đúng bảng (kiểm CA, bỏ qua hostname).
    - MongoDB không có `caFile`: đọc kho chứng chỉ Windows qua `tls::root_certs_der(None)` rồi ghi ra file PEM tạm (`<temp>/s3b-ca-<pid>-<số ngẫu nhiên>.pem`, tạo bằng `create_new`, chỉ chứa root CA công khai) cho `TlsOptions::ca_file_path`; file bị xoá khi guard `RootsFile` bị drop (`drivers/mongodb/mod.rs`, Q35).
    - MongoDB `authSource` cố định `admin`; `database` rỗng → `admin`; lệnh `update` báo `rowsAffected = n` (số document khớp) của reply.
    - Redis: lệnh chặn connection (`SUBSCRIBE`, `MONITOR`...) là lỗi của câu; bật TLS tới server/cổng không TLS thì treo tới timeout kết nối 10 giây rồi mới `openFailed`.
  - Field `tls` dùng cho mọi driver mạng; SQLite bỏ qua.
  - `driver` lạ, `tls.mode` lạ → `invalidRequest`.
  - Driver mạng thiếu `host` → `invalidRequest`; `caFile` không đọc được/không phải PEM → `openFailed`.
  - Không kết nối được, sai mật khẩu, lỗi TLS, quá 10 giây → `openFailed`. `message` không được chứa mật khẩu.
- `execute` giữ nguyên dạng. `sql` là SQL (PG/MySQL/MariaDB/MSSQL), các document lệnh JSON (Mongo) hoặc các dòng lệnh (Redis).
- Mongo: phần tử `kind: "rows"` có `columns: [{name: "document", type: "json"}]`, mỗi dòng một chuỗi JSON gọn một dòng.
- `StatementResult` thêm `firstRowMs?: u64`. Chỉ khi build với feature `bench-timing`: thêm `readMs?: u64`, `convertMs?: u64` (DLL phát hành không có, Go không cần biết).
- `fetch`, `close` giữ nguyên.
- `schemaTree`, `tableInfo`, `tableRows` trên connection không phải SQLite → `invalidRequest`.
- Mã lỗi giữ nguyên danh sách hiện có, Go chưa phải đổi. Khi nối Go sau này, câu DBE002 "Cannot open database file {path}" cần câu mới cho DB mạng — ghi ở 10.13.

### 10.6 Crate, TLS, kích thước DLL, thời gian build, `crt-static`
Nguyên tắc ban đầu: `default-features = false`, chỉ bật feature cần, TLS chỉ qua rustls với provider `ring`, không kéo `openssl`, `native-tls`, `aws-lc-rs`. Tên feature trong plan ban đầu là đề xuất; bảng dưới đã **đổi theo `rust/Cargo.toml` thật** (kiểm 2026-11-20). **Thực tế R3**: `aws-lc-rs 1.19.0` / `aws-lc-sys 0.47.0` **có** trong cây phụ thuộc vì `tiberius` với feature `rustls` bật `tokio-rustls/default`; đã thử ép chỉ `ring` nhưng không được; **người dùng đã chấp nhận**. Provider dùng lúc chạy vẫn là `ring` (cài ở `s3b_init`; driver SQL Server tự cài trước khi nối nếu chưa có, xem test `mssql_provider.rs`); không có `openssl`/`native-tls`.

| Crate | Version / feature thật (`rust/Cargo.toml`) | Dùng ở / ghi chú |
|---|---|---|
| `tokio-postgres` | `0.7.18`, `default-features = false`, `runtime` | Driver PG; không có TLS sẵn |
| `tokio-postgres-rustls` | `0.14.0`, `default-features = false` | TLS cho PG với `ClientConfig` của `tls.rs` (cùng `rustls` 0.23) |
| `postgres-protocol` | `0.6.12` (mặc định; khai báo trực tiếp để gọi `types::*_from_sql`) | Version khớp bản `tokio-postgres` kéo vào (`cargo tree -i postgres-protocol` chỉ một bản) |
| `fallible-iterator` | `0.2` | Duyệt mảng PG trả từ `array_from_sql` (`postgres/array.rs`) |
| `mysql_async` | `0.37.1`, `default-features = false`, `default-rustls-ring` | Driver MySQL/MariaDB, TLS rustls + `ring`. Plan ban đầu đoán `rustls-tls`/`default-rustls` — sai tên |
| `tiberius` | `0.13.0`, `default-features = false`, `tds73`, `rustls` | Driver SQL Server. Plan ban đầu lo hai bản rustls (rủi ro 41): **thực tế** chỉ một bản `rustls 0.23.46`, nhưng feature `rustls` kéo `aws-lc-rs` (xem trên) |
| `tokio-util` | `0.7`, `compat` | Nối `TcpStream` tokio vào `tiberius` |
| `mongodb` | `3.10.1`, `default-features = false`, `compat-3-0-0`, `rustls-tls` | Driver MongoDB (không bật `dns-resolver`, `openssl-tls`, nén) |
| `redis` | `1.8.2`, `default-features = false`, `tokio-comp` | Driver Redis; **không** bật `tokio-rustls-comp`/`tls-rustls` như plan ban đầu — TLS qua `tokio-rustls` trực tiếp |
| `tokio-rustls` | `0.26.6`, `default-features = false`, `ring`, `tls12` | `TlsConnector` cho Redis, dựng từ `ClientConfig` của `tls.rs` |
| `rustls` | `0.23`, `default-features = false`, `ring`, `std`, `tls12` | `ring` làm `CryptoProvider` mặc định của process; không dùng `webpki-roots` |
| `rustls-native-certs` | `0.8` | Kho chứng chỉ Windows (Q35 = A) |
| `rustls-pki-types` | `1` | Kiểu cert và trait `PemObject` đọc `caFile` (`tls.rs`, dùng qua `rustls::pki_types`). Thay `rustls-pemfile` dự kiến ban đầu |
| `base64` | `0.22.1` | MongoDB: `$binary` trong Extended JSON (`ejson.rs`) và ghi file PEM tạm từ kho Windows (`mongodb/mod.rs`) |
| `itoa` | `1.0.19` | Số nguyên → chuỗi (PG `value.rs`, SQL Server `value.rs`, MongoDB `ejson.rs`, Redis `value.rs`) |
| `ryu` | `1.0.23` | Double → chuỗi (MongoDB `ejson.rs`, Redis `value.rs`) |
| Có từ R2 | `libsqlite3-sys = "*"`, `sqlx 0.9.0` (`sqlite`, `runtime-tokio`), `sqlparser 0.64.0`, `serde`, `serde_json` (`raw_value`), `futures-util` (`default-features = false`), `tokio 1.54.1` (`rt-multi-thread`, `sync`, `macros`, `time`, `net`) | `net` thêm cho driver mạng |
| `[dev-dependencies]` | `mysql_common 0.37.3` (`default-features = false`), `rust_xlsxwriter 0.103.0` (feature mặc định), `tokio` (`test-util`) | `mysql_common` dựng row thô trong test `mysql/value.rs` (`new_row_raw`); `rust_xlsxwriter` cho example `db_bench`; không vào DLL. Feature `bench-timing` của chính crate cho bench |

- Kiểm sau build (**đã đổi theo thực tế R3**, người dùng chấp nhận `aws-lc-rs`): `cargo tree -i rustls` chỉ **một bản `rustls 0.23.46`**; `cargo tree -i openssl-sys` / `-i native-tls` rỗng; DLL release build **không** bật `bench-timing`; DLL link `crt-static` và import table (`dumpbin /dependents`) không có `VCRUNTIME140.dll`; ghi kích thước DLL.
- `ring` có code C/asm build qua `cc`; trên `x86_64-pc-windows-msvc` **chưa xác minh** có cần nasm hay dùng object dựng sẵn. `cc` theo cờ `crt-static` nhưng vẫn kiểm `dumpbin /dependents s3b_db.dll` không có `VCRUNTIME140.dll` sau build (rủi ro 22, 41). `rustls-native-certs` gọi API crypt32 của Windows (DLL hệ thống, không ảnh hưởng `crt-static`).
- Kích thước DLL: dự kiến tăng vài MB mỗi driver cộng ~1–2 MB cho rustls + ring (ước lượng, **chưa đo**); `mongodb` và `tiberius` nặng nhất. N11 ghi kích thước DLL release trước/sau vào report (Q30 = A: mọi driver vào DLL phát hành). Có thể giảm bằng `[profile.release]` `lto = "thin"`, `codegen-units = 1`, `strip = true`, nhưng **chỉ đề xuất**, không làm khi người dùng chưa đồng ý (ngoài phạm vi).
  - **Thực tế R3** (byte, release): SQLite baseline 10.397.184 → sau N4 11.003.392 → PG 13.351.936 → MySQL 16.347.136 → MSSQL 19.176.448 → Mongo 25.323.520 → Redis 26.110.464 → sau sửa Q35 (kho Windows cho Mongo) 26.103.296.
- Thời gian build: lần đầu thêm vài phút (mongodb + bson + tiberius + mysql_async + rustls/ring); CI release build lâu hơn, đã có cache `rust/target`; ghi thời gian build sạch trước/sau vào report.
- Nối Go/FE cho tuỳ chọn TLS ngoài phạm vi R3 (10.13): FE đã có `sslMode` 6 giá trị cho PG nên tên `mode` khớp sẵn.

### 10.7 Dùng lại | Hiệu năng (R3)
Dùng lại:
- `rust/tests/common/mod.rs`: gọi FFI, `ok`/`err_code`, `TempDir` — golden test, test mạng, spike và bench dùng mẫu này.
- `protocol` (StatementResult, FetchResult, DbError, mã lỗi).
- Actor/`hold`/`Held` của SQLite (chuyển lên `common.rs`), `value::hex`, `sqlparser` (đã có trong deps, dùng tokenizer).
- `postgres-protocol` (decode nhị phân PG, đã nằm trong cây phụ thuộc của `tokio-postgres`).
- Mẫu compose/README/cổng đổi được và `scripts/gen-certs.sh` của `test-env/`.
- `datetime.rs` dùng chung cho PG và SQL Server.
- `SslMode` 6 giá trị đã có ở FE (tên `mode` giữ nguyên để nối sau không phải map).

Hiệu năng:
- **Dữ liệu**: 1.000 / 10.000 / 100.000 dòng × 10 cột (~0,22 / 2,2 / 22 MB JSON theo ước ban đầu; thực tế R3 ~0,3 / 3 / 30 MB với DB SQL, ~0,4 / 4 / 40 MB với MongoDB/Redis — xem 10.2). Trang mặc định của app là 10.000 dòng (Q16 = B) nên đường đọc 10.000 dòng là đường nóng thật, không chỉ của bench.
- **Đọc dòng**:
  - Đọc theo stream, mỗi trang tối đa `pageSize` dòng và `maxPageBytes`. Không collect cả kết quả, trừ Redis (reply vốn trọn trong RAM).
  - `Vec::with_capacity(min(pageSize, 10_000))` cho trang, `with_capacity(ncols)` cho dòng.
  - Mỗi ô đúng một `String` (MySQL tái dùng `Vec<u8>` có sẵn; PG chuỗi text/json nhận bytes rồi `from_utf8`).
  - PG nhị phân: giải mã bằng `postgres-protocol` (ra số/bytes, không qua kiểu Rust trung gian như `chrono`), bảng hàm giải mã chọn **một lần cho mỗi cột** theo OID (không `match` OID ở từng ô). Fallback simple query chỉ cho câu có kiểu ngoài danh sách (Q31 = A), câu thường không trả giá.
  - `timestamptz` UTC (Q32 = A): không tra bảng múi giờ ở từng ô.
  - SQL Server: packet size TDS tối đa (ít vòng đọc hơn cho trang lớn), `TCP_NODELAY` (không chờ Nagle ở các gói nhỏ của request/ack), đọc thẳng `ColumnData`.
  - Mongo: `batchSize = pageSize` (tránh ~100 vòng `getMore` khi batch mặc định 101), bộ ghi Extended JSON tự viết duyệt `RawDocument`, một `String` cho mỗi document, không qua `Document`/`serde_json::Value`; dạng gọn (Q33 = A) giữ byte ít nhất.
  - Không qua `serde_json::Value` hay `sqlx` trên đường đọc dòng.
  - Bộ đếm pha (`readMs`/`convertMs`) chỉ có khi bật `bench-timing`, đo theo dòng; bản phát hành không tốn thêm.
- **Bốn pha thời gian** (bench): server (`firstRowMs`), đọc mạng + giải mã của crate (`readMs`), đổi sang chuỗi (`convertMs`), ghi JSON (`callMs − elapsedMs`); spike N12 cho số đọc thô của crate để biết phần không thể tối ưu ở code mình.
- **Không chặn runtime**:
  - Mọi I/O mạng (kể cả bắt tay TLS) là async.
  - Huỷ không chặn thread của `s3b_cancel` (spawn task).
  - Bỏ cursor lớn huỷ phía server trước khi đọc bỏ, để lệnh sau không chờ đọc hết 100.000+ dòng.
- **TLS**: kho chứng chỉ Windows nạp một lần cho cả process (`OnceLock`), `ClientConfig` cache theo (`mode`, `caFile`); không đọc kho ở mỗi `open`.
- **SQLite sau N4**: `elapsedMs` 10.000 dòng không tăng so với mốc trước refactor (~8 ms, đo lại trên cùng máy ở bước golden). **Thực tế R3**: đo thật 12–21 ms do bộ dữ liệu ~296 B/dòng (10.1); tiêu chí là so trước/sau trên cùng máy, không so với ~8 ms.
- **Bench**:
  - Kết nối một lần cho mỗi DB, không tính vào thời gian đo; không TLS.
  - Khởi động 3 lần trước khi đo 15 lần.
  - Bản release, không debugger.
  - Dùng `127.0.0.1` thay `localhost` để tránh thử IPv6 trước trên Windows.
  - **Giới hạn Docker Desktop (WSL2)** (thực tế R3): chỉ riêng đường mạng host ↔ container đã tốn ~24 ms cho 2,5 MB, nên mục tiêu < 40 ms (nhắm < 20 ms) chỉ công bằng khi DB cài trực tiếp trên host; số đo với DB trong Docker là cận trên.

### 10.8 Test Rust (rust-tester, có commit)
Test cần DB Docker:
- Đọc `test-env/db/db.env` (đường dẫn tính từ `CARGO_MANIFEST_DIR`, nên mật khẩu chỉ nằm trong `test-env/`) và thử TCP connect tới cổng trong 1 giây.
- Không có file hoặc không kết nối được → in `SKIP <db>: not reachable at 127.0.0.1:<port>` ra stderr rồi `return` (cargo test không có skip thật). Test TLS thiếu `test-env/certs/` → in `SKIP <db> tls: certs not generated`. Ghi số test bị skip vào báo cáo.

Test thuần (tách câu, đổi giá trị, giải mã OID, ghi Extended JSON, parse lệnh, dựng `ClientConfig`/verifier, golden SQLite) luôn chạy, không cần Docker.

**Tên file test thật trong `rust/tests/` (kiểm 2026-11-20)** — mỗi file `tests/*.rs` là một binary riêng:
- Chung/N4: `common/mod.rs` (helper FFI), `ffi_protocol.rs`, `ffi_uninit.rs`, `ffi_tls.rs` (`s3b_init` cài provider TLS, gọi lại vô hại; `client_config` dùng được qua API công khai), `dispatch_open.rs` (`open` driver chưa có/sai tham số, chặn method cây trên driver không phải SQLite, hợp đồng huỷ với actor giả của driver mạng, JSON `open` cũ của SQLite).
- SQLite: `sqlite_exec.rs`, `sqlite_cursor.rs`, `sqlite_schema.rs`, `sqlite_golden.rs` + `golden/sqlite/*.json`, `sqlite_perf.rs` (`#[ignore]`).
- PostgreSQL: `pg_common/mod.rs`, `postgres.rs`, `postgres_tls.rs`, `postgres_binary_vs_text.rs` (+ `fixtures/pg_exprs.txt`).
- MySQL/MariaDB: `my_common/mod.rs`, `mysql.rs` (macro `both!` sinh `<tên>::mysql` và `<tên>::mariadb`), `mysql_tls.rs`.
- SQL Server: `mssql_common/mod.rs`, `mssql.rs`, `mssql_tls.rs`, `mssql_provider.rs` (một test duy nhất, binary riêng không gọi `s3b_init`: nối tới server PRELOGIN giả để chắc driver tự cài `ring` trước khi `tiberius` dựng TLS — trả `openFailed`, không panic "CryptoProvider", provider mặc định là `ring`).
- MongoDB: `mongo_common/mod.rs`, `mongo.rs`, `mongo_tls.rs`.
- Redis: `redis_common/mod.rs`, `redis.rs`, `redis_tls.rs`.
- Cert dựng sẵn cho test TLS thuần: `fixtures/` (`ca.pem`, `ca_other.pem`, `server.pem`, `server.key`, `server_other_ca.pem`, `selfsigned.pem`, `gen.sh`).

| Task | Hàm / file cần test | Case cần phủ |
|---|---|---|
| Golden SQLite (trước N4, người dùng duyệt 2026-11-18) | rust/tests/sqlite_golden.rs, rust/tests/golden/sqlite/*.json (tạo, commit trước N4). **Đã kiểm 2026-11-20**: 15 file golden có trong repo, `00_open_close.json` … `14_not_found.json` (open/close, nhiều câu, câu lỗi, readOnly, phân trang, truncated, blob, null, số, unicode, rowsAffected, schemaTree, tableInfo, tableRows, not found) | Một `#[test]` chạy tuần tự trên file DB tạm mới, qua FFI, một bộ câu cố định: nhiều câu trong một `execute`; câu lỗi giữa đoạn (`SELECT 1; SELEC 2; SELECT 3`); lỗi readOnly; phân trang (`execute` + các `fetch` tới `done`, pageSize nhỏ + `maxPageBytes` nhỏ để có trang ngắt sớm); hai SELECT liền nhau (`truncated`); BLOB rỗng/vài KB; NULL; REAL (0.1, 1e308, -0.0, số nguyên lớn > 2^53); TEXT Unicode (tiếng Việt, CJK, emoji); `rowsAffected`; `schemaTree`/`tableInfo`/`tableRows`; lỗi `cursorNotFound`/`connNotFound`. Mỗi response lưu nguyên văn JSON. **Chuẩn hoá trước khi so**: parse response bằng `serde_json` (bật `preserve_order` nếu chưa — **chưa xác minh** đang bật; không bật được thì so bằng chuỗi sau khi thay giá trị như dưới), trong mọi `statements[]`: đặt `elapsedMs` = 0, **xoá** key `firstRowMs` (N4 thêm mới), đặt `cursorId` khác null = 1 và `connId` = 1 (id do registry cấp tăng dần, phụ thuộc thứ tự chạy), rồi serialize lại; so **từng byte** với file golden đã chuẩn hoá cùng cách. Biến môi trường `S3B_UPDATE_GOLDEN=1` ghi lại file (chỉ dùng ở bước sinh trước N4). Sau N4: trùng hết, nếu lệch là hồi quy → rust-native sửa code, không sửa file golden |
| Đo SQLite (trước và sau N4) | rust/tests/sqlite_perf.rs (`#[ignore]`, chạy `cargo test --release --target x86_64-pc-windows-msvc -- --ignored sqlite_perf`) | Bảng 10.000 dòng × 10 cột (cùng bộ dữ liệu bench), `pageSize` 10.000; 3 lần khởi động + 15 lần đo; in min/trung vị/max `elapsedMs`. Chạy trước N4 (mốc, kỳ vọng ~8 ms — **thực tế 12–21 ms** do dữ liệu ~296 B/dòng, 10.1; chỉ dùng để so trước/sau cùng máy) và sau N4 trên cùng máy; **trung vị sau không được lớn hơn mốc** — do nhiễu đo, plan hiểu là không tăng quá 10% hoặc 1 ms (lấy giá trị lớn hơn); vượt thì báo về. Cả hai số ghi vào báo cáo |
| N4 | Mọi test SQLite hiện có (`src/**` `#[cfg(test)]`, `rust/tests/sqlite_*.rs`, `ffi_protocol.rs`, `ffi_uninit.rs`) | **Hồi quy**: toàn bộ phải qua; chỉ được đổi đường import khi hàm được chuyển sang `common.rs`, không đổi assert |
| N4 | rust/src/drivers/common.rs | `PageBuilder`: đủ `page_size`, dừng ở `max_bytes`, luôn ≥ 1 dòng, NULL không tính byte, `page_size = 0` → 1; `hold` với `Cursor` giả: fetch đúng/sai cursor, lệnh khác tới → `abandon` được gọi và trả lệnh, kênh đóng, lỗi giữa chừng; build không có `bench-timing` thì response không có `readMs`/`convertMs`, có feature thì có |
| N4 | rust/src/drivers/datetime.rs | ngày 0001-01-01, 1970-01-01, 2000-01-01, 9999-12-31, năm nhuận 2000/1900/2024, trước Công nguyên (PG `BC`), micro giây và 100 ns (MSSQL), offset âm/dương; `timestamptz` ra hậu tố `+00` |
| N4 | rust/src/drivers/tls.rs (`#[cfg(test)]` trong file) + rust/tests/ffi_tls.rs | Đủ 6 `mode` dựng đúng cấu hình (bảng 10.5): `disable` không TLS; `verify-full` từ chối cert sai hostname và CA lạ; `verify-ca` chấp nhận cert sai hostname nhưng từ chối CA lạ và cert hết hạn; `require`/`prefer`/`allow` chấp nhận cert tự ký, sai hostname nhưng vẫn từ chối chữ ký bắt tay sai (cert/khoá dựng sẵn trong `rust/tests/fixtures/`, không cần Docker); `caFile` có thì chỉ tin CA trong file; `caFile` sai đường dẫn/không phải PEM → `openFailed`; thiếu `caFile` nạp kho Windows (số root > 0) đúng một lần; cài provider `ring` hai lần không panic; cache trả cùng config cho cùng (`mode`, `caFile`) |
| N4 | rust/src/drivers/split_sql.rs | PG: `;` trong chuỗi `'..'`, `E'..'`, `"ident"`, `$$...;...$$`, `$tag$...$tag$`, comment `--` và `/* */` lồng; MySQL: `#` comment, backtick, `\'` escape, `DELIMITER $$` ... `$$` rồi `DELIMITER ;`, `DELIMITER` cuối đoạn; MSSQL: `GO` đầu dòng (hoa/thường, có khoảng trắng), `GO` trong chuỗi/comment không tách, chữ `GOTO` không tách; đoạn rỗng/chỉ comment → không câu nào; câu cuối không có `;`; tokenizer lỗi → cả đoạn một câu; byte offset đúng với text unicode |
| N4 | rust/src/registry.rs, ffi.rs | `Interrupt` giả đếm số lần gọi: cancel đúng id đang chạy → gọi 1 lần; id đã xong → không gọi (giữ case B4); `CancelSignal` đánh thức future đang chờ trong `select!`; cancel trước khi chờ vẫn bắt được (không lỡ tín hiệu) |
| N4 | rust/src/dispatch.rs, protocol (test ở rust/tests/dispatch_open.rs và `#[cfg(test)]` của `protocol/mod.rs`) | `open` driver lạ → `invalidRequest`; driver mạng thiếu `host` → `invalidRequest`; `schemaTree` trên conn không phải SQLite → `invalidRequest`; `firstRowMs` có mặt cho câu trả dòng; JSON `open` cũ của SQLite (không có field mạng/`tls`) vẫn parse được; `tls.mode` lạ → `invalidRequest`; đủ 6 giá trị `mode` parse được |
| N12 | rust/examples/spike_read.rs (tạm) | Không viết test; chỉ chạy đo và báo số (min/trung vị/max cho tiberius và mongodb), kèm cấu hình đã dùng (packet size, nodelay, batchSize) |
| N5–N9 (mỗi DB, cần Docker) | rust/tests/postgres.rs, mysql.rs (cả MySQL và MariaDB), mssql.rs, mongo.rs, redis.rs (helper ở `pg_common/`, `my_common/`, `mssql_common/`, `mongo_common/`, `redis_common/`) | open ok; sai mật khẩu → `openFailed` và message không chứa mật khẩu; cổng đóng → `openFailed` trong ≤ 11 giây; SELECT/find/LRANGE 1.201 dòng (pageSize 500 do test truyền) → 500 / 500 / 201 + `done`; kết quả rỗng → `done`; INSERT/UPDATE/DELETE → `rowsAffected` đúng; DDL; nhiều câu, câu 2 lỗi → dừng, không chạy câu 3; chỉ câu cuối giữ cursor, câu trước `truncated`; `maxPageBytes` nhỏ → trang ngắn nhưng ≥ 1 dòng; execute mới → `fetch` cursor cũ → `cursorNotFound`; `close` → `connNotFound`; huỷ câu dài (`pg_sleep(30)`, `SLEEP(30)`, `WAITFOR DELAY '00:00:30'`, Mongo truy vấn chậm, `DEBUG SLEEP 30`) → `cancelled` trong < 2 giây và connection dùng được sau đó (SQL Server: connection mới, bảng `#temp` cũ mất — đúng Q23 = A); huỷ khi đang `fetch`; bỏ cursor 100.000 dòng → lệnh kế trả kết quả trong < 1 giây |
| N5–N9 TLS (cần Docker + `test-env/certs/`, Q36 = A) | rust/tests/postgres_tls.rs, mysql_tls.rs, mssql_tls.rs, mongo_tls.rs, redis_tls.rs; rust/tests/mssql_provider.rs (không cần Docker, server giả) | Với cả 6 DB (MySQL và MariaDB riêng): `verify-full` + `caFile` đúng, host khớp SAN → ok; `verify-full` không `caFile` (CA tự ký không có trong kho Windows) → `openFailed`; host không khớp SAN (nối bằng tên/địa chỉ không có trong cert, tuỳ SAN của `gen-certs.sh`) → `verify-full` lỗi, `verify-ca` ok (trừ các xấp xỉ ở 10.5: SQL Server, MySQL/MariaDB, MongoDB `verify-ca` vẫn kiểm hostname); `require` không `caFile` → ok và phiên thật sự mã hoá (PG `pg_stat_ssl`, MySQL `Ssl_cipher`, MSSQL `sys.dm_exec_connections.encrypt_option`, Mongo `connectionStatus`/kết nối cổng TLS, Redis qua cổng 10036); `prefer` → mã hoá; `allow`/`disable` tới server TLS tuỳ chọn → không mã hoá; `require` tới cổng/server không TLS (Redis 10035) → `openFailed`; `prefer` tới server không TLS (Redis 10035) → ok không mã hoá. `mssql_provider.rs`: process chưa cài provider → `open` SQL Server tới server PRELOGIN giả trả `openFailed`, không panic, provider mặc định sau đó là `ring` |
| N5 | postgres: value.rs, array.rs (thuần, bytes nhị phân dựng tay) | Phần ghi chuỗi và phần tự giải mã (`numeric`, `interval` nếu tự viết): int2/4/8 cực trị, float NaN/±Infinity/-0, numeric 0, âm, `dscale` lớn, 1000 chữ số, NaN/±Infinity; bool; date/time/timetz/timestamp kể cả `infinity` và BC; `timestamptz` ra `+00`; interval có tháng/ngày/micro giây âm; uuid; bytea rỗng và lớn; inet v4/v6/cidr; macaddr/8; bit/varbit; mảng 1–3 chiều, có NULL, phần tử cần quote (dấu phẩy, ngoặc, khoảng trắng, `NULL` chữ, Unicode); bytes hỏng → ô `0x<hex>`, trang không lỗi |
| N5 so sánh nhị phân/text (Docker, **bắt buộc** — người dùng duyệt 2026-11-18) | rust/tests/postgres_binary_vs_text.rs | Bảng test chứa một cột cho **mỗi kiểu trong danh sách cho phép** (kể cả enum, domain, mảng), các dòng giá trị biên: NaN, `Infinity`, `-Infinity` (float4/8, numeric), `-0` (float), numeric rất lớn (1000 chữ số) và âm với `dscale` lớn, ngày BC, `timestamp`/`timestamptz`/`date` `infinity` và `-infinity`, interval có tháng (và tháng/ngày/micro giây âm), mảng chứa NULL, mảng 2–3 chiều, Unicode (tiếng Việt, CJK, emoji, ký tự cần quote trong mảng), NULL toàn dòng. Cùng câu `SELECT` chạy hai đường: (1) driver đi nhị phân; (2) đường text — simple query của chính driver hoặc `SELECT col::text` — trong phiên đặt `TimeZone = 'UTC'`. So **từng ô**; lệch ô nào là fail và in tên cột + chỉ số dòng (không in giá trị ra log của app, chỉ trong output test). Thêm: phiên `SET TimeZone='Asia/Ho_Chi_Minh'` thì `timestamptz` nhị phân vẫn `+00` (Q32 = A) |
| N5 fallback (Docker) | rust/tests/postgres.rs | Q31 = A: câu có cột composite/range/money/`point` → kết quả giống `::text` của server, câu chỉ chạy một lần (đếm bằng bảng phụ có `INSERT ... RETURNING` hoặc sequence), câu cùng batch chỉ có kiểu trong danh sách vẫn đi nhị phân; cursor của câu fallback phân trang đúng; `$$` function tạo được rồi gọi được |
| N6 | rust/tests/mysql.rs (cần Docker, mỗi test chạy cho cả MySQL và MariaDB) + `#[cfg(test)]` của `mysql/value.rs` (dùng dev-dep `mysql_common`) | NULL, TINYINT..BIGINT UNSIGNED cực trị, DECIMAL, DOUBLE, DATE/DATETIME(6)/TIMESTAMP, BIT, JSON, BLOB/BINARY → hex, VARCHAR utf8mb4 (emoji); `CREATE PROCEDURE` với `DELIMITER` rồi `CALL`; `KILL QUERY` không giết nhầm connection khác (kể cả khi connection chính dùng TLS) |
| N7 | sqlserver: value.rs (thuần) + rust/tests/mssql.rs (Docker) | Đổi ngày giờ thuần: `date`, `time(0..7)`, `datetime2(7)`, `datetimeoffset` với offset âm, `smalldatetime`, `datetime`; `money`, `decimal(38,10)`, `uniqueidentifier`, `varbinary` → hex, `nvarchar` unicode, `bit`, `xml`; batch có `GO` gồm INSERT + SELECT → hai Result; procedure tạo được; huỷ → mở lại connection (cùng cấu hình TLS, packet size, nodelay), lệnh sau chạy được; packet size đã thương lượng (đọc `sys.dm_exec_connections.net_packet_size`) gần mức tối đa server cho phép — thực tế 32576 B không TLS, 16554 B có TLS, không bằng giá trị yêu cầu |
| N8 | mongodb: command.rs, ejson.rs (thuần) + rust/tests/mongo.rs (Docker) | Parse: một lệnh, nhiều lệnh liền nhau, JSON sai → lỗi câu có vị trí, `{"$oid"}`/`{"$date"}`/`{"$numberDecimal"}`; ghi Extended JSON relaxed: ObjectId, Date (trong và ngoài khoảng 1970–9999), Decimal128, Int32/64, Double thường/NaN/Inf, Binary (subtype 0 và 4), Regex, Timestamp, MinKey/MaxKey, null, document/mảng lồng sâu, chuỗi có `"`, `\`, ký tự điều khiển, unicode; so khớp ngữ nghĩa với `bson` crate `into_relaxed_extjson()` (dùng trong test làm chuẩn); output **không chứa `\n` và không có khoảng trắng thừa** (Q33 = A) và `serde_json::from_str` đọc lại được; mỗi document một dòng, đúng một cột `document`; `batchSize` tự thêm (= pageSize) khi thiếu, giữ khi có; `find` 10.000 document không ghi `batchSize` → trang đầu đủ 10.000 dòng trong một vòng (đếm lệnh qua `getMore` = 0, ví dụ bằng `db.serverStatus().metrics.commands.getMore` trước/sau — **chưa xác minh** cách đếm, rust-tester chọn cách tương đương); `insert`/`update`/`delete` → `affected`; lệnh không cursor (`ping`, `buildInfo`) → 1 dòng; file PEM tạm từ kho Windows bị xoá sau khi dùng |
| N9 | redis: command.rs, value.rs (thuần) + rust/tests/redis.rs (Docker) | Tách token: khoảng trắng, `"a b"`, `'a b'`, `\n`, `\x41`, `\"`, ngoặc chưa đóng → lỗi câu; dòng trống bị bỏ; lệnh bị chặn (`SUBSCRIBE`, `MONITOR`) → lỗi câu; reply: nil, int, bulk, simple, error (→ lỗi câu), mảng, map (`HGETALL`) → 2 cột, set, mảng các mảng cùng độ dài (`ZRANGE WITHSCORES`) → n cột, lồng sâu → JSON, double/bool/verbatim của RESP3; `SELECT <db>` theo `database` |
| N10 | test-env/docker-compose-db.yml | verifier chạy `docker compose -f test-env/docker-compose-db.yml config` qua; cổng không trùng các stack khác; sau `gen-certs.sh` cả 6 service healthy với TLS bật |
| N11 | rust/examples/db_bench (data.rs, report.rs) — test `#[cfg(test)]` trong example (`[[example]] test = true`) hoặc hàm thuần | Sinh dữ liệu tất định (cùng seed cùng dòng, đúng tỉ lệ NULL); trung vị số lần chẵn/lẻ; cờ đạt/không đạt ở biên 20/40 ms; tính pha JSON = `callMs − elapsedMs` không âm; DB không chạy → dòng "không chạy" trong Summary, bench vẫn ra file; file `.xlsx` mở lại được và có đủ 3 sheet, Summary có cột từng pha |

Coverage Rust (thực tế R3, chỉ để tham khảo, **không đặt ngưỡng**): đo bằng `cargo-llvm-cov 0.9.1`, tổng Lines 98,02%.

Test hồi quy Go / FE: R3 không sửa Go/FE. Hồi quy Go/FE của phần bổ sung PR #43 nằm ở mục 9.7.

### 10.9 Thứ tự thực hiện R3
1. PR #43 (gồm mục 9.7) đã được người dùng merge vào `SP-19/release`.
2. `git-flow` tách `SP-19/native_db_drivers` từ `origin/SP-19/release`, sau khi kiểm `git ls-remote --heads origin 'SP-19/*'`.
3. rust-tester: golden test SQLite + test đo `sqlite_perf` trên code chưa refactor; sinh file golden (`S3B_UPDATE_GOLDEN=1`), chạy đo lấy mốc → git-flow commit riêng ("test: golden ...") trên branch (chưa push PR).
4. rust-native: N4 (chỉ refactor, không đổi hành vi) → `cargo test` toàn bộ (hồi quy SQLite + golden phải trùng) → `sqlite_perf` sau N4 so với mốc → commit refactor riêng. Golden lệch hoặc thời gian tăng quá ngưỡng (10.8) thì sửa N4, không sửa golden.
5. rust-native: N10 → **N12 spike** (sinh cert, dựng Docker, đo tiberius và mongodb, xoá code spike, khôi phục `Cargo.toml`/`Cargo.lock`). Trung vị đọc thô của crate > 40 ms → **orchestrator dừng, báo người dùng** số đo và hỏi cách xử lý trước khi làm N7/N8.
6. rust-native: N5 → N6 → N7 → N8 → N9 → N11. Mỗi task chạy `cargo fmt --check`, `cargo clippy --target x86_64-pc-windows-msvc --all-targets -- -D warnings` (thêm một lần với `--features bench-timing`), `cargo build --release --target x86_64-pc-windows-msvc`.
7. rust-tester: sinh cert bằng `sh test-env/scripts/gen-certs.sh` (Git Bash, cần openssl), dựng Docker bằng `docker compose -f test-env/docker-compose-db.yml -p s3b-db-test up -d --wait`, viết và chạy test theo 10.8 (gồm test so sánh nhị phân/text PG), báo rõ test nào skip.
8. Chạy `test-env/db-bench.ps1` một lần, đính kèm đường dẫn report và bảng tóm tắt (kèm từng pha) vào báo cáo.
9. verifier (cargo fmt/clippy/build/test, `dumpbin /dependents`, `cargo tree` một bản `rustls 0.23.46` và không có `openssl`/`native-tls` (`aws-lc-rs` do `tiberius` đã được người dùng chấp nhận, 10.6), `postgres-protocol` một bản, DLL release không bật `bench-timing`, `docker compose config`, kích thước DLL, không còn file spike) → code-reviewer → git-flow commit, push, PR vào `SP-19/release`.
10. Không có bước Go, bindings, FE. Sau PR R3 chuyển sang branch R1 (mục 5).

Trạng thái (thực tế R3): bước 1–8 đã xong, N4–N11 đã commit; còn bước 9 (verify → review → PR). **Cập nhật 2026-11-22:** bước 9 đã xong theo cách khác plan (R3 vào release không qua PR, sửa review ở #44), xem mục 11.1.

### 10.10 Rủi ro (R3 và các câu trả lời 2026-11-18)
| # | Rủi ro | Mức độ | Cách giảm thiểu |
|---|---|---|---|
| 24 | Sprint-19 có tổng 23 task (14 cũ + 9 R3 gồm spike N12), branch R3 có 5 driver mới cộng TLS đủ 6 chế độ — vượt xa ngưỡng ~10, review tốn kém | high | Người dùng đã chọn gộp vào sprint-19 và một branch (Q17 = A); golden, refactor N4 và mỗi driver một commit, review theo từng commit; nếu vòng review vượt 3 thì dừng hỏi |
| 25 | N4 sửa lại code SQLite của R2 (chuyển actor/hold/registry sang lớp chung) → hồi quy SQLite đang chạy trong app | high | (Người dùng duyệt 2026-11-18) N4 là **commit refactor riêng, không đổi hành vi**; **golden test** sinh trên code cũ và commit trước N4, sau N4 output JSON phải trùng từng byte sau chuẩn hoá (`elapsedMs` = 0, bỏ `firstRowMs`, `cursorId`/`connId` = 1); **đo SQLite 10.000 dòng trước/sau N4** trên cùng máy, trung vị không tăng (mốc ~8 ms theo PR #43, thực tế `sqlite_perf` 12–21 ms do dữ liệu ~296 B/dòng; ngưỡng nhiễu 10%/1 ms); toàn bộ test SQLite cũ qua mà không đổi assert |
| 26 | Mục tiêu < 20 ms (< 40 ms) có thể không đạt với `tiberius` (giải mã TDS, chuỗi UTF-16) và `mongodb` (BSON → JSON) | high | (Người dùng duyệt 2026-11-18) **Spike N12** ngay sau N4: đo tốc độ đọc thô 10.000 dòng của chính crate trên Docker, > 40 ms thì dừng báo về trước khi viết driver; bench tách 4 pha (server `firstRowMs`, đọc mạng + giải mã của crate `readMs`, đổi chuỗi `convertMs`, ghi JSON); MongoDB `batchSize = pageSize` + ghi JSON thẳng từ `RawDocument`; SQL Server packet size tối đa + `TCP_NODELAY` + đọc thẳng `ColumnData`. Còn lại: "đọc mạng" và "giải mã của crate" không tách được ở mức driver (10.2). **Thực tế R3**: trên Docker chỉ SQLite đạt (xem 10.11), phần lớn do sàn mạng Docker Desktop (rủi ro 37) |
| 27 | `tiberius` ít được bảo trì, có thể không báo `rowsAffected` của từng câu trong batch qua `QueryStream` (**chưa xác minh**) | high | rust-native kiểm docs.rs/nguồn trước khi code N7; không lấy được thì Result `affected` ghi `rowsAffected` rỗng và báo về (luật 6) |
| 28 | Bỏ cursor còn nhiều dòng phải đọc bỏ phần còn lại: driver có thể chặn lâu (MySQL đọc hết) | medium | Huỷ phía server trước rồi mới đọc bỏ; SQL Server đóng/mở lại (Q23 = A); test "bỏ cursor 100.000 dòng → lệnh kế < 1 giây"; không đạt thì đóng và mở lại connection, ghi vào report |
| 29 | `tokio-postgres` có thể không giới hạn bộ đệm (backpressure) khi giữ stream → RAM tăng theo cả kết quả (**chưa xác minh**) | medium | Test đo RAM khi giữ cursor 100.000 dòng; nếu không có backpressure thì đổi sang `DECLARE CURSOR` + `FETCH n` trong transaction và báo về vì đổi hành vi autocommit |
| 30 | Tách câu bằng tokenizer `sqlparser`: thân `BEGIN ATOMIC ... END` của PG 14+ có `;` bên trong bị tách sai; tokenizer có thể trả vị trí dòng/cột thay vì byte offset | medium | Ghi là giới hạn đã biết; test unicode cho phép đổi vị trí; tokenizer lỗi thì gửi cả đoạn |
| 31 | Kích thước DLL và thời gian build CI tăng (mongodb, tiberius, mysql_async, rustls/ring); DLL phát hành chứa code chưa dùng (Q30 = A) | medium | Đo kích thước và thời gian build sạch trước/sau ghi vào report; tắt feature mặc định của mọi crate; LTO/strip chỉ đề xuất. Thực tế R3: 10.397.184 → 26.103.296 B (10.6) |
| 32 | Crate kéo C dependency (openssl, aws-lc, zstd/zlib qua `cc`) phá `crt-static` hoặc cần cmake/nasm trên máy dev/CI | high | `default-features = false`, rustls + `ring` (Q19 = B); `cargo tree` kiểm không có `openssl-sys`/`native-tls`; `dumpbin /dependents` sau build. **Thực tế R3**: `aws-lc-rs`/`aws-lc-sys` có trong cây do `tiberius` (10.6), người dùng đã chấp nhận; DLL vẫn `crt-static`, không có VCRUNTIME140; CI cần kiểm build `aws-lc-sys` (cmake/nasm) — **chưa xác minh** trên runner |
| 33 | Image Docker: tag không ghim làm số đo không lặp lại được; image MSSQL ~1,5 GB, cần ≥ 2 GB RAM, chỉ x86_64; Redis debug command chỉ nên bật ở test | medium | Ghim tag patch, ghi phiên bản DB vào sheet Env; README ghi yêu cầu RAM; Redis `--enable-debug-command yes` chỉ ở test-env |
| 34 | Cổng 10030–10036 trùng dịch vụ khác trên máy | low | Đổi bằng biến môi trường như mục 4 README; `db.env` là nguồn duy nhất của cổng cho test, spike và bench |
| 35 | Mật khẩu test bị chép vào code Rust hoặc lộ trong message lỗi/log | medium | Test, spike và bench chỉ đọc `test-env/db/db.env`; test assert message `openFailed` không chứa mật khẩu; Mongo dựng `ClientOptions` bằng code, không qua URI |
| 36 | Test cần Docker bị skip im lặng làm tưởng đã qua | medium | Skip in rõ tên DB và lý do; báo cáo rust-tester ghi số test chạy/skip theo từng DB; verifier chạy khi Docker đang lên và cert đã sinh |
| 37 | Số đo dao động theo máy (Docker Desktop/WSL2, antivirus, nguồn điện) — ảnh hưởng cả ngưỡng "không tăng" của SQLite sau N4 và ngưỡng dừng 40 ms của spike | low | 3 lần khởi động + 15 lần đo, báo min/trung vị/max; đo trước/sau trên cùng máy, cùng phiên; sheet Env ghi cấu hình máy; người dùng tự chạy lại bằng một lệnh. **Thực tế R3**: Docker Desktop (WSL2) có sàn mạng ~24 ms cho 2,5 MB, nên mục tiêu < 40 ms chỉ công bằng với DB cài trực tiếp trên host |
| 38 | Driver mạng không có giới hạn thời gian khi server treo giữa chừng (sau khi kết nối) | low | Go đã có timeout 5 phút mỗi lời gọi (sẽ áp khi nối); R3 chỉ timeout kết nối 10 giây; huỷ qua `s3b_cancel` vẫn hoạt động |
| 39 | `pageSize` 10.000 (Q16 = B): trang ~2,2 MB với bảng 10 cột, bảng rộng (50 cột, chuỗi dài) có thể chạm trần 16 MiB mỗi trang; FE phải `JSON.parse` và giữ 10.000 dòng mỗi lần tải (vài chục ms trên main thread, RAM tăng ~2–20 MB mỗi trang, **chưa đo**); thời gian chờ trang đầu dài hơn với DB mạng chậm | medium | `maxPageBytes` 16 MiB vẫn chặn trần; Go chuyển nguyên JSON không decode; FE giữ row ngoài immer, DataGrid virtualize 2 chiều; test tay R2 kiểm UI không giật khi tải trang; ghi số đo vào report |
| 40 | PG nhị phân (Q20 = B): giải mã kiểu hiếm (numeric, interval, mảng nhiều chiều, ngày BC) dễ sai; hai đường đọc (nhị phân + simple query fallback Q31 = A) phải cùng hợp đồng trang/cursor; `timestamptz` UTC (Q32 = A) khác cách `psql` hiển thị | high | (Người dùng duyệt 2026-11-18) Giải mã bằng hàm của **`postgres-protocol`** (bool, số, text, bytea, ngày giờ, uuid, inet, mảng), chỉ phần ghi chuỗi tự viết; `numeric`/`interval` có thể tự giải mã (chưa xác minh); **chỉ kiểu trong danh sách cho phép** đi nhị phân, còn lại simple query; **test so sánh nhị phân/text trên Docker** cho từng ô với các giá trị biên, lệch là fail, là điều kiện xong của N5; test phân trang riêng cho câu fallback; ô giải mã lỗi hiện hex; ghi chú UTC trong report |
| 41 | TLS: các crate có thể dùng **nhiều bản rustls** (tiberius bản cũ) hoặc provider khác `ring` → DLL to, cấu hình provider lệch, `ClientConfig::builder()` panic khi có hai provider; tiberius/mongodb có thể không nhận `ClientConfig`/verifier riêng nên `verify-ca`/`require` phải ánh xạ qua tuỳ chọn của crate; verifier tự viết cho `require`/`verify-ca` sai thì mất an toàn (Q34 = A) | high | `cargo tree -i rustls` kiểm số bản; cài `ring` làm provider mặc định ở `s3b_init`; verifier gom ở `tls.rs`, test từng chế độ cả thuần và Docker (Q36 = A); crate không làm được đúng ngữ nghĩa bảng 10.5 thì dừng và báo về, không tự nới. **Thực tế R3**: một bản `rustls 0.23.46`; `aws-lc-rs 1.19.0`/`aws-lc-sys 0.47.0` có trong cây do `tiberius` (feature `rustls` bật `tokio-rustls/default`, ép chỉ `ring` không được) — **người dùng đã chấp nhận**; không có `openssl`/`native-tls`; `verify-ca` của SQL Server, MySQL/MariaDB, MongoDB là xấp xỉ có kiểm hostname, `caFile` của SQL Server cộng dồn với kho Windows (10.5); test `mssql_provider.rs` chặn panic "CryptoProvider" khi process chưa gọi `s3b_init` |
| 42 | Test TLS bằng Docker (Q36 = A) cần openssl (Git Bash) và cert đúng SAN, key đọc được bởi user trong container (PG yêu cầu quyền 0600, MSSQL cần cấu hình riêng); compose có TLS phức tạp hơn | medium | Dùng lại `gen-certs.sh` (sửa nếu thiếu SAN/quyền); test TLS skip rõ khi chưa sinh cert; README ghi cách sinh |
| 43 | MongoDB một cột JSON (Q25): FE sau này hiển thị 10.000 `JsonInput` mỗi trang — rất nặng nếu không virtualize; payload Mongo lớn hơn DB khác (có tên field trong mỗi dòng) | medium | Ghi ở 10.13: bắt buộc virtualize và chỉ mount `JsonInput` cho dòng đang hiện; Rust trả JSON gọn (Q33 = A) |
| 44 | Bổ sung PR #43 (Q15 = A) là vòng review thứ 4 của branch R2, vượt giới hạn 3 vòng của `CLAUDE.md` B4 | low | Người dùng đã đồng ý; phạm vi chỉ gồm thay đổi đã liệt kê ở 9.7 |
| 45 | Q21: cách hiểu "gửi cả đoạn cho rust xử lý hết" có thể khác ý người dùng (nếu ý là server chạy multi-statement) | low | Plan ghi rõ cách hiểu (phương án A) và người dùng đã duyệt plan 2026-11-18 |

### 10.11 Tiêu chí hoàn thành R3
- [ ] `cargo fmt --check`, `cargo clippy --target x86_64-pc-windows-msvc --all-targets -- -D warnings` (có và không có `--features bench-timing`), `cargo build --release --target x86_64-pc-windows-msvc` qua; grep `rust/src` không có `unwrap(`/`expect(` ngoài `#[cfg(test)]` (đã kiểm 2026-11-20 cho `drivers/tls.rs`: mọi `.unwrap()` nằm sau `#[cfg(test)] mod tests` ở dòng 313, không có trong code chạy thật); `unsafe` chỉ ở các chỗ liệt kê tại mục 8 (`drivers/sqlite/raw.rs`, `ffi.rs` với `#[unsafe(no_mangle)]` và `s3b_call`/`s3b_free` là `unsafe extern "C" fn`, chỗ gọi `raw::InterruptHandle::of` ở `drivers/sqlite/mod.rs`, và test `#[cfg(test)]`), driver mạng không có `unsafe`; DLL link `crt-static` và `dumpbin /dependents s3b_db.dll` (import table) không có `VCRUNTIME140.dll`; `cargo tree` chỉ có **một bản `rustls 0.23.46`**, không có `openssl`/`openssl-sys`/`native-tls` (`aws-lc-rs 1.19.0`/`aws-lc-sys 0.47.0` có mặt do `tiberius`, người dùng đã chấp nhận — 10.6); kích thước DLL ghi trong báo cáo (10.6: 10.397.184 → 26.103.296 B); branch không còn file spike.
- [ ] Golden test SQLite commit trước N4; sau N4 output JSON trùng từng byte sau chuẩn hoá; N4 là một commit refactor riêng; toàn bộ test SQLite có sẵn qua mà không sửa assert.
- [ ] `sqlite_perf` 10.000 dòng: trung vị `elapsedMs` sau N4 không lớn hơn mốc trước N4 (ngưỡng nhiễu 10%/1 ms); cả hai số có trong báo cáo.
- [ ] Spike N12 có số đọc thô 10.000 dòng (min/trung vị/max) của `tiberius` và `mongodb` trong báo cáo; nếu > 40 ms thì đã dừng và có quyết định của người dùng trước khi làm N7/N8.
- [ ] Sau `sh test-env/scripts/gen-certs.sh`: `docker compose -f test-env/docker-compose-db.yml -p s3b-db-test up -d --wait` → 6 DB healthy ở cổng 10030–10035, Redis TLS ở 10036.
- [ ] Khi Docker đang chạy và đã sinh cert: `cargo test` chạy đủ test cho cả 6 DB (MySQL và MariaDB riêng), kể cả test TLS, không skip. Với từng DB: mở connection; chạy lệnh trả dòng và không trả dòng; phân trang 500/500/201 qua `cursorId`; huỷ câu dài → `cancelled` trong < 2 giây; lỗi trả mã ổn định.
- [ ] Khi Docker tắt: `cargo test` vẫn qua, các test DB in `SKIP <db>: ...`.
- [ ] PG: giải mã nhị phân dùng hàm của `postgres-protocol` (trừ `numeric`/`interval` nếu không có hàm sẵn, ghi rõ trong báo cáo), chỉ kiểu trong danh sách cho phép; **test so sánh nhị phân/text trên Docker qua cho mọi kiểu và mọi giá trị biên** (NaN, ±Infinity, numeric rất lớn/âm, -0, ngày BC, timestamp infinity, interval có tháng, mảng chứa NULL, mảng nhiều chiều, Unicode), không lệch ô nào; `timestamptz` luôn UTC `+00` kể cả khi phiên đặt `TimeZone` khác; câu có cột composite/range/money → kết quả giống `::text` của server (simple query, không chạy hai lần); `SELECT 1; SELEC 2; SELECT 3` → 2 phần tử, câu 2 có `error`. MySQL: `DELIMITER $$ CREATE PROCEDURE ... $$ DELIMITER ; CALL p();` chạy được. SQL Server: hai batch cách nhau `GO` → hai Result; packet size thương lượng gần mức tối đa server cho phép (thực tế 32576 B không TLS, 16554 B có TLS), không đòi bằng giá trị yêu cầu. Mongo: `{"find":"bench_10000"}` → trang đầu đủ 10.000 document không cần `getMore`, mỗi document một dòng, một cột `document` chứa Extended JSON relaxed hợp lệ, gọn một dòng; `{"insert":...}` → `affected`. Redis: `HGETALL h` → 2 cột, `LRANGE l 0 -1` → 1 cột.
- [ ] TLS, với mỗi DB: `verify-full` + `caFile` của `test-env/certs` kết nối được; CA không tin cậy → `openFailed`; sai hostname → `verify-full` lỗi, `verify-ca` được (trừ các xấp xỉ đã ghi ở 10.5: SQL Server, MySQL/MariaDB, MongoDB `verify-ca` vẫn kiểm hostname); `require`/`prefer` kết nối và phiên được mã hoá; `disable` không mã hoá; không có `caFile` thì dùng kho chứng chỉ Windows (MongoDB qua file PEM tạm, Q35; SQL Server có `caFile` thì cộng dồn với kho Windows, 10.5).
- [ ] Message lỗi `openFailed` khi sai mật khẩu không chứa mật khẩu; Rust không log dữ liệu truy vấn; mật khẩu Docker chỉ có trong `test-env/`.
- [ ] Chạy `test-env/db-bench.ps1` một lần → dựng DB, nạp dữ liệu, đo, sinh file `.xlsx` trong `test-env/db/report/`. Sheet Summary có SQLite + 6 DB × 1.000/10.000/100.000: min/trung vị/max `elapsedMs` và `callMs`, trung vị từng pha (server `firstRowMs`, đọc mạng + giải mã của crate `readMs`, đổi chuỗi `convertMs`, ghi JSON), cột đạt < 40 ms / nhắm < 20 ms cho 10.000 dòng. Sheet Env có phiên bản DB, phiên bản crate driver, kích thước DLL, CPU/RAM/OS.
- [ ] Mỗi DB có `elapsedMs` trung vị trang 10.000 dòng < 40 ms trên máy local. DB nào không đạt thì report và báo cáo ghi rõ phần thời gian nằm ở pha nào.
  - **Thực tế R3 (N11, DB trong Docker Desktop/WSL2)**, trung vị `elapsedMs` trang 10.000 dòng: SQLite 13, PostgreSQL 49, MySQL 47, MariaDB 48, SQL Server 59, MongoDB 74, Redis 68 ms — **chỉ SQLite đạt**. Sàn mạng Docker Desktop ~24 ms cho 2,5 MB, nên mục tiêu < 40 ms (nhắm < 20 ms) chỉ công bằng với DB cài trực tiếp trên host; chưa đo với DB cài trên host. Kích thước JSON thật ~295–303 B/dòng (SQL), ~407 B/dòng (MongoDB/Redis).
- [ ] Kích thước `s3b_db.dll` release và thời gian build sạch trước/sau R3 ghi trong báo cáo.

### 10.12 Lệch `CLAUDE.md` cần người dùng cập nhật (luật 7, agent không tự sửa)
- §8 "Driver": PostgreSQL dùng extended protocol **nhị phân**, giải mã bằng `postgres-protocol` (tự viết phần ghi chuỗi), chỉ kiểu trong danh sách cho phép; câu có kiểu ngoài danh sách chạy simple query (text); `timestamptz` luôn hiện UTC `+00`. MongoDB trả mỗi document một dòng, một cột JSON (Extended JSON relaxed, gọn một dòng), `batchSize = pageSize`. SQL Server packet size tối đa + `TCP_NODELAY`. TLS cho DB mạng chỉ qua **rustls + `ring`** (không `openssl`/`native-tls`; `aws-lc-rs` vẫn có trong cây phụ thuộc do `tiberius`, người dùng chấp nhận), provider `ring` cài ở `s3b_init`, root CA từ kho Windows (`rustls-native-certs`) hoặc `caFile`, 6 chế độ theo `SslMode` của FE (kèm các xấp xỉ `verify-ca` ở 10.5).
- §8 "Driver" (mục tiêu hiệu năng): mục tiêu `elapsedMs` < 40 ms (nhắm < 20 ms) đo với DB cài trực tiếp trên host; DB chạy trong Docker Desktop (WSL2) có sàn mạng ~24 ms cho 2,5 MB nên chỉ là cận trên.
- §8 "Hợp đồng FFI": `open` có thêm field mạng (`host`, `port`, `database`, `username`, `password`) và `tls {mode, caFile}`; `StatementResult` có `firstRowMs` (và `readMs`/`convertMs` chỉ với feature `bench-timing`).
- §8 "Driver" (đo hiệu năng): thay đổi đường đọc dòng/refactor lớp chung phải kèm golden test và số đo trước/sau; driver mới có spike đo crate trước khi viết.
- §8 "Lệnh" → Test: thêm test tích hợp DB mạng và TLS dùng Docker trong `test-env/docker-compose-db.yml` (cert sinh bằng `test-env/scripts/gen-certs.sh`), tự skip khi DB/cert không có; golden test SQLite (`S3B_UPDATE_GOLDEN=1` để sinh lại); test đo `sqlite_perf` (`--ignored`); thêm lệnh bench `test-env/db-bench.ps1` (report Excel bằng `rust_xlsxwriter`, feature `bench-timing`).
- §10 Testing: quy tắc skip cho test Rust cần Docker/cert; quy tắc không sửa file golden để cho qua.
- §5 (B4 tối đa 3 vòng review): sprint này có ngoại lệ vòng 4 cho PR #43 do người dùng đồng ý (Q15 = A) — chỉ cần ghi nếu người dùng muốn thành quy tắc.
- Không phải `CLAUDE.md` nhưng cần sửa: `memory/MEMORY.md` mục 2 dòng sprint-19 ghi "trang kết quả 500 dòng" → 10.000 (Q16 = B) (orchestrator ghi ở B5). `requirement.md` đã được session chính sửa.

### 10.13 Việc sau (ngoài phạm vi R3, ghi để sprint nối Go/FE)
- Nối Go `modules/db` cho các driver mạng: lưu `config` theo provider mới (`mysql`, `mariadb`, `sqlserver`, `mongodb`, `redis`), `ConnectDb` cho mọi provider, câu message mới thay DBE002 ("Cannot connect to {host}:{port}") cho DB mạng.
- Nối tuỳ chọn TLS ở FE/Go: `sslMode` có sẵn cho PG → mở rộng cho mọi DB mạng, chọn `caFile` bằng hộp thoại native (mẫu `submodule_auth_files.go`); cert client (mTLS) chưa có trong hợp đồng R3.
- FE hiển thị kết quả MongoDB (Q25): mỗi document một dòng, mỗi dòng một `FieldInput` type `json` (`components/inputs/FieldInput.tsx` → Mantine `JsonInput`), chỉ đọc. **Bắt buộc virtualize** (trang 10.000 document = 10.000 `JsonInput` nếu render hết): dùng `@tanstack/react-virtual` với chiều cao dòng đo động (`measureElement`) hoặc cố định + mở rộng khi chọn, chỉ mount `JsonInput` cho dòng đang hiện (overscan nhỏ), format (thụt lề) JSON gọn của Rust khi dòng được mount (Q33 = A), đúng 3 cỡ giao diện (px × `useUiScale` + `useRemeasureOnScale`).
- Cây object/metadata (`schemaTree`, `tableInfo`, `tableRows`) cho DB mạng.
- Hỗ trợ `mongodb+srv://` (cần feature `dns-resolver` của `mongodb`).

## 11. Kết quả thực tế và lệch plan đã chấp nhận (sprint DONE 2026-11-22)

Sprint DONE 2026-11-22: PR #43–#50 đã merge vào `SP-19/release`, version beta `1.1.0-beta.19`. Mục này ghi chỗ thực tế khác mục 1–10; các mục trên giữ nguyên làm lịch sử plan.

### 11.1 Branch và PR thực tế (thay bảng mục 5)
| Branch | Yêu cầu | PR | Nội dung |
|---|---|---|---|
| `SP-19/sqlite_native_backend` | R2 | #43 | N1–N3, B1–B4, F1–F4 + bổ sung mục 9.7 |
| (không qua PR) | R3 | — | N4–N11 vào thẳng `SP-19/release` (`dc5d07e` và các commit trước), khác mục 10.9 bước 9 |
| `SP-19/r3_review_fixes` | R3 | #44 | Sửa theo review R3: 4 vòng review + 1 lần sửa test T5 — người dùng đồng ý vượt giới hạn 3 vòng |
| `SP-19/db_object_tree` | R1 | #45 | F5, F6, F7 + B7 + C1 (làm tròn chiều cao dòng) |
| `SP-19/sql_tab_close_race` | sửa lỗi (R1/R2) | #46 | Race `CloseDbTab`/`tabConnOf`; `SqlResultPanel` dùng `keepMountedMode="display-none"` |
| `SP-19/db_test_fixes` | R3 (test) | #47 | 2 test sửa sau lần chạy Docker + 2 unit test B4 MySQL `shutdown` |
| `SP-19/rust_tests_layout` | R3 (test) | #48 | Chuyển unit test Rust ra `rust/tests/unit/`, nối bằng `#[path]` |
| `SP-19/restore_settings` | ngoài phạm vi | #49 | Khôi phục deny rules của `.claude/settings.json` (người dùng tự sửa) |
| `SP-19/claude_md_update` | ngoài phạm vi | #50 | Người dùng tự sửa `CLAUDE.md` và `rust-tester.md` |

### 11.2 Lệch plan R1 người dùng đã chấp nhận
- Trạng thái expanded/selected của cây giữ ở `dbTreeStore` thay cho Mantine `useTree` (vẫn dùng `flattenTreeData`) — khác Q2/F6.
- Double click node có con (nhóm/schema/database) để mở/đóng.
- Cột Nullable/Primary key hiện Yes/No.
- `closeProfileTables` tạo tab SQL mới nếu đóng hết tab SQL.
- Thêm mục "Làm mới" ở menu chuột phải của profile đang Connect (key `contextMenu.refresh`, 7 ngôn ngữ) cùng `dbTreeStore.refreshProfile`.
- File mới ngoài plan: `hooks/useTableRows.ts` (reset khi đổi table/profile) và `utils/tableInfoRows.ts`; key mới `tree.expand`/`tree.collapse`.
- Kiểu `DbSchema` v.v. lấy từ `SchemaTreeOutput[...]`, không sửa `models/alias.go`.
- Mock PG thêm `public.audit_log` (không có PK).
- Chiều cao dòng/thẻ làm tròn `Math.round(getRowHeight * scale)`: node 25/28/32, thẻ đầu 60/68/77, thẻ sau 67/76/86 px ở small/medium/large.
- Tabs của `TableStructureDetail` và `SqlResultPanel` dùng `keepMountedMode="display-none"` (mặc định `activity` của Mantine huỷ effect của panel ẩn); effect tự mở Accordion có `activeTab` trong deps.
- Test cũ đổi có chủ ý: `DbProfiles.test.tsx` (mock `useVirtualizer`, 3 test "interface size" đổi assert), `DbProfileItem.test.tsx` (prop `onToggleTree`).

### 11.3 Đổi hành vi/quyết định R3 do review (#44, #47)
- SQL Server: chỉ báo "connection was reset" khi phiên bẩn (USE, SET, `#temp`, EXECUTE AS, `sp_*`, BEGIN TRAN/DISTRIBUTED); phiên sạch thì nối lại im lặng; `@@TRANCOUNT` đọc cùng round trip với `@@ROWCOUNT`.
- SQL Server: lần thử không TLS dùng `EncryptionLevel::Off` + `trust_cert()` (đăng nhập vẫn mã hoá); P4 packet size đã xác minh ổn.
- `close` bật `CancelSignal` cho mọi request của connection (SQL Server, MongoDB, Redis không còn treo).
- Tách câu PG chạy tuyến tính (`OffsetCursor`).
- MySQL `shutdown` luôn `disconnect()` có timeout.
- `test-env` bind 127.0.0.1.
- `S3B_REQUIRE_DB=1` biến skip thành fail (`skip_or_fail`) — bổ sung cho quy tắc skip ở 10.8.
- `postgres_binary_vs_text` chạy 200 biểu thức (có interval vô cực).

### 11.4 Kết quả kiểm tra cuối
- Test DB thật trên Docker: `S3B_REQUIRE_DB=1 cargo test` → 1491 pass / 0 fail / 5 ignored, không có SKIP.
- vitest sau R1: 177 file / 3394 test.
- QA R1: 34 case, PASS 32 / MANUAL 2 (TC-R1-33 bản dịch + hộp thoại chọn file; TC-R1-34 WebView2/DPI); banner Wails server mode được lọc ở harness.
- Chưa kiểm: nhánh `timeout(CLOSE_TIMEOUT)` của MySQL; Go `-race`.

### 11.5 Vấn đề còn lại / việc sau
- R2: Q6 (profile sqlite vẫn lưu `secret` nếu input gửi kèm); Q8 (`split.rs` cắt 500 byte có thể rơi giữa ký tự UTF-8).
- R3: P5, T3, T4, C2.
- R1: P1, B3, B4.
- #46: B2; `closeAll` không đánh dấu lần mở đang chạy.
- Nối Go/FE cho 6 DB mạng (mục 10.13).
- Hiệu năng DB mạng 47–74 ms trên Docker (sàn mạng ~24 ms); chưa đo với DB cài trên host.
- Các list S3 cũ chưa làm tròn `estimateSize`.
