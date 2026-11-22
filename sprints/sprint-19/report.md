## Kết quả sprint-19
- Trạng thái: DONE 2026-11-22 (người dùng báo `sprint-19 DONE`; còn test tay TC-R1-33/34 ghi ở "Vấn đề còn lại"). Version beta `1.1.0-beta.19`. PR #43–#50 đã merge vào `SP-19/release` (đỉnh `6616668`); PR `SP-19/sprint_docs` (docs, CHANGELOG 7 bản, memory, version) vào release và PR `SP-19/release` → `staging` chờ người dùng merge (docs trước, promote sau).
- Tổng thay đổi: R2 +9713 / -401 (119 file); R3 (vào release không qua PR) 0be6739..dc5d07e ~83 file rust/ + test-env/ (~30.000 dòng gồm golden và bench); #44 +1335 / -164 (34 file); #45 +3909 / -60 (55 file) + c43e421 +43 / -4 (3 file); #46 2 commit (Go +47 / -7, FE +53 / -3); #48 +13748 / -13762 (60 file, chỉ chuyển test); #47, #49, #50 nhỏ

### Branch
| Branch | Yêu cầu | Số vòng review | Commit | PR vào SP-19/release | Trạng thái |
|---|---|---|---|---|---|
| SP-19/sqlite_native_backend | R2 | 3/3 (+ vòng bổ sung mục 9.7) | c508a6b, 150cbc8, 1555464, 109a6c6, 44e65ec | #43 (đã merge 2026-11-18) | Đạt |
| SP-19/native_db_drivers | R3 | không qua PR; verifier + code-reviewer chạy sau khi code đã vào release | 0be6739, b02b281, 0825e56, 9a54124, d73ce52, f81768e, 83bb97a, 2e1c364, a5f5645, caeb63d, dc5d07e | không có (người dùng đẩy thẳng vào release) | Đã vào release, sửa ở #44 |
| SP-19/r3_review_fixes | R3 sửa review | 4 vòng + 1 sửa test T5 (người dùng đồng ý vượt ngưỡng 3) | cf6c4ca | https://github.com/TranMinhTruyen/s3-browser/pull/44 (đã merge 2026-11-22) | Đạt, test DB thật đã chạy sau (xem mục Test DB thật R3) |
| SP-19/db_object_tree | R1 + B7 + C1 | 2/3 (+ sửa C1 theo người dùng) | 2a84b2a, c43e421 | https://github.com/TranMinhTruyen/s3-browser/pull/45 (đã merge 2026-11-22) | Đạt, chưa xem tay |
| SP-19/sql_tab_close_race | sửa vấn đề có sẵn từ review R1 (người dùng chọn sửa) | 2/3 | 47bc7ea, 688fe9e | https://github.com/TranMinhTruyen/s3-browser/pull/46 (đã merge 2026-11-22) | Đạt, chưa kiểm `-race` |
| SP-19/db_test_fixes | R3 (test sau lần chạy Docker) | 1/3 (review ngắn ×2) | 744b817, 07d38f0 | https://github.com/TranMinhTruyen/s3-browser/pull/47 (đã merge 2026-11-22) | Đạt (chỉ test) |
| SP-19/rust_tests_layout | R3 (bố cục test Rust, người dùng yêu cầu thêm) | 1/3 (review 1 vòng ĐẠT) | 88d2a87 | https://github.com/TranMinhTruyen/s3-browser/pull/48 (đã merge 2026-11-22) | Đạt (không đổi hành vi) |
| SP-19/restore_settings | khôi phục cấu hình do commit tạm dc5d07e | không cần review (người dùng tự sửa, diff 2 dòng) | 4d9cce6 | https://github.com/TranMinhTruyen/s3-browser/pull/49 (đã merge 2026-11-22) | Đạt |
| SP-19/claude_md_update | cập nhật quy ước (người dùng tự sửa `CLAUDE.md`, `.claude/agents/rust-tester.md`) | không cần review (docs do người dùng viết) | 6582da0 | https://github.com/TranMinhTruyen/s3-browser/pull/50 (đã merge 2026-11-22) | Đạt |
| SP-19/sprint_docs | docs sprint (requirement, plan, testcases, evidence, report, memory, CHANGELOG 7 bản, version `1.1.0-beta.19`) | - | xem PR | PR vào `SP-19/release` (chờ merge) | Chờ merge |

### Commit (R2)
| Commit | Nội dung | Số liệu |
|---|---|---|
| c508a6b | feat(native): Rust `s3b_db.dll` + driver SQLite | 22 file, +4419 |
| 150cbc8 | build: task build/copy DLL, NSIS, dev_mode ignore `rust` | 6 file, +45 / -3 |
| 1555464 | feat(db): module Go `modules/db`, bảng `db_profiles`, sqlc | 32 file, +1947 |
| 109a6c6 | feat(sql): FE nối backend SQLite, test, locale 7 ngôn ngữ, xoá `dbProfileMock.ts` | 59 file, +3302 / -398 |

### Đối chiếu yêu cầu
| Yêu cầu | Trạng thái | Ghi chú |
|---|---|---|
| R1 cây object trong thẻ profile + tab TableStructure | Đã làm (SQLite thật, PostgreSQL mock) | Mantine `flattenTreeData` danh sách phẳng virtualize; Làm mới ở menu chuột phải; 6 tab con; PG mock có wide_events (32 cột × 25.000 row) và audit_log (không PK); chiều cao dòng cây làm tròn nguyên px. QA bằng Playwright 3 cỡ × sáng/tối PASS, chưa xem tay trên WebView2 |
| R2 backend SQLite | Đã làm | `pageSize` 10.000 (Q16 = B) |
| R3 driver Rust 6 DB + bench Excel | Đã làm (Rust, chưa nối Go/FE) | Chỉ SQLite đạt < 40 ms (13 ms); PG 49, MySQL 47, MariaDB 48, SQL Server 59, Mongo 74, Redis 68 ms trên Docker Desktop (sàn mạng ~24 ms) |
| B7 `useSqlRunner` abort sau Connect | Đã làm | PR #45 |
| Sửa race `CloseDbTab` + `SqlResultPanel` display-none | Đã làm (ngoài yêu cầu, người dùng chọn) | PR #46 |
| Q6 (sqlite lưu `secret`), Q8 (`split.rs` cắt 500 byte) | Chưa sửa | mức low của R2 |

### Lệch plan người dùng đã chấp nhận (đã cập nhật plan.md mục 11)
- Trạng thái expanded/selected của cây ở `dbTreeStore` thay Mantine `useTree` (vẫn `flattenTreeData`).
- Double click node có con (nhóm/schema/database) để mở/đóng.
- Cột Nullable/Primary key hiện Yes/No.
- `closeProfileTables` tạo tab SQL mới nếu đóng hết tab SQL.
- Thêm "Làm mới" ở menu chuột phải (`contextMenu.refresh` 7 ngôn ngữ), `hooks/useTableRows.ts` (reset khi đổi table/profile), `utils/tableInfoRows.ts`, key `tree.expand`/`tree.collapse`.
- Kiểu `DbSchema` v.v. lấy từ `SchemaTreeOutput[...]`, không sửa `alias.go`.
- Test cũ đổi có chủ ý: `DbProfiles.test.tsx` sửa mock `useVirtualizer` (`estimateSize(index)`, `item.size`) và 3 test "interface size" đổi assert (không chỉ mock) vì gộp gap 8px vào chiều cao card từ thứ hai, rồi đổi tiếp theo C1 (small [60, 67], medium [68, 76], large [77, 86]); `DbProfileItem.test.tsx` thêm prop bắt buộc `onToggleTree`.
- Đổi hành vi R3 có chủ ý: SQL Server chỉ báo "connection was reset" khi phiên bẩn (USE, SET, #temp, EXECUTE AS, sp_*, BEGIN TRAN/DISTRIBUTED); lần thử không TLS dùng `EncryptionLevel::Off` + `trust_cert()`; `S3B_REQUIRE_DB=1` biến skip thành fail; test-env bind 127.0.0.1.
- Người dùng chốt sửa thêm trong sprint: C1 (làm tròn chiều cao dòng) và vấn đề có sẵn race `CloseDbTab` + `SqlResultPanel`.

### Kết quả kiểm tra
- Rust (#44): cargo fmt / clippy `-D warnings` (thường và `bench-timing`) / build release PASS; cargo test 1489 pass / 0 fail / 5 ignored, 468 test DB SKIP lúc đó, đã chạy lại với Docker thật (mục Test DB thật R3); DLL 26.064.896 B, không VCRUNTIME140; một bản rustls 0.23.46, postgres-protocol, libsqlite3-sys; không openssl/native-tls (có `aws-lc-rs` do tiberius).
- Frontend (#45): biome / oxlint / tsc / knip PASS; vitest 177 file / 3394 test, 0 fail, console sạch (một lần timeout ngẫu nhiên ở `ConnectModal.auth.test.tsx`, chạy lại pass); go build / vet PASS.
- #46: go build / vet / golangci-lint PASS (0 issues); go-tester tạm PASS `-count=20` (đã xoá); vitest 165 file / 3204 test, 0 fail.

### Test DB thật R3 (sau khi merge #44, #45, #46; release de2f9ef; Docker 6 DB)
- Chạy trên release de2f9ef: `S3B_REQUIRE_DB=1 cargo test --target x86_64-pc-windows-msvc --no-fail-fast` = 1487 pass / 2 fail / 5 ignored, không SKIP; hai test fail đều lỗi code test, sửa ở PR #47: `postgres_binary_vs_text` assert 197 → 200 theo fixture (3 dòng interval vô cực); `close_of_a_broken_connection_disconnects_it` (mariadb) bỏ giả định thread server còn sống.
- Sau sửa + thêm 2 unit test B4 (`shutdown_of_a_broken_mysql_connection_quits_cleanly`, `..._mariadb_...`, kiểm `shutdown` luôn gửi COM_QUIT: `Aborted_clients` không tăng): 1491 pass / 0 fail / 5 ignored, không SKIP; `--features bench-timing --test mongo` 54 pass; fmt + clippy (thường và bench-timing) sạch; test B4 FAIL khi tạm khôi phục nhánh cũ (thả `Conn` thô khi broken).
- Đã xác minh bằng DB thật: B2 (interval vô cực binary = text trên PG 17), P4 (packet size SQL Server `disable` với `EncryptionLevel::Off`: hai test pass, đóng), B7 (7 cổng bind 127.0.0.1), TLS 6 DB, huỷ/close của SQL Server, MongoDB, Redis, MySQL/MariaDB.
- Hạn chế: nhánh `timeout(CLOSE_TIMEOUT)` hết hạn (server không phản hồi COM_QUIT) và mạng đứt thật chưa test (không có seam trên `mysql_async::Conn`); test B4 nhánh MariaDB (`mysql.rs`) chỉ khoá close < 3 s và thread biến mất (phần phân biệt `disconnect()` do unit test ở `actor.rs`); nhánh mysql dùng `KILL`; commit `07d38f0` tiêu đề ~81 ký tự (vượt 72), đã push nên giữ nguyên.

### QA R1 (qa-tester, người dùng yêu cầu): `testcases.md` + `evidence/sp-19-r1-db-object-tree/` + `evidence/sprint-19_evidence.xlsx`
- 34 case (auto-ui 32, manual 2): PASS 32 / FAIL 0 / BLOCKED 0 / MANUAL 2. Ba cỡ small/medium/large × sáng/tối đo Playwright PASS (dòng cây 25/28/32 px, lệch tâm ≤ 1 px, không cuộn ngang). Dữ liệu SQLite thật (users, orders, big_events 25.000 row, no_pk, wide 41 cột, view, index, trigger).
- Console sạch (TC-R1-32): banner `@wailsio/runtime` "Browser Environment Detected" (console.warn ở server mode, ngoài code app, app desktop WebView2 không in, không có cờ tắt trong v3.1.0, chưa xác minh docs Wails v3) bị lọc ở harness QA theo quyết định của người dùng (`page.addInitScript`; 68 lần bị nuốt); không có warning/error nào khác.
- Cần test tay: TC-R1-33 (bản dịch 6 ngôn ngữ, hộp thoại chọn file native), TC-R1-34 (WebView2, DPI 125/150%, đổi cỡ cửa sổ).
- Quan sát nhỏ: Nullable = Yes cho `INTEGER PRIMARY KEY` (rowid alias); Default/Name không có giá trị hiện `NULL`; thẻ profile bị cắt tên ở large (layout sprint-18).

### Chuyển unit test Rust ra `rust/tests/unit/` (người dùng yêu cầu, PR #48)
- 30 file `rust/src/**` có `#[cfg(test)] #[path = "..."] mod tests;` ở cuối, ~790 test chuyển nguyên văn sang `rust/tests/unit/<cây src>.rs`; không đổi code production/visibility/hành vi; không `tests/unit/main.rs` (không có target lạ).
- Kiểm tra: số test từng suite trước/sau giống hệt (lib 787, 789 với `bench-timing`), tên test khớp, `S3B_REQUIRE_DB=1 cargo test` với Docker thật 0 fail không SKIP, fmt + clippy (2 bản) PASS, DLL 26.064.896 B không đổi.
- Hai file chỉ khác cú pháp do rustfmt (`unit/drivers/sqlite/raw.rs`, `unit/drivers/tls.rs`), 10 file khác chỉ xuống dòng lại; chuỗi nhiều dòng giữ nguyên từng byte.
- Người dùng đã tự cập nhật `CLAUDE.md` và `.claude/agents/rust-tester.md` (PR #50).

### Coverage frontend (ngưỡng ≥ 95%)
| File | Lines | Branches (C1) | Đạt |
|---|---|---|---|
| mock/dbObjectMock.ts, utils/dbObjectSource.ts, utils/tableInfoRows.ts, stores/dbTreeStore.ts, stores/sqlTabStore.ts, hooks/useTableRows.ts, navbar/DbTreeRow.tsx, components/SqlTabDetail.tsx, SqlTabLabel.tsx, SqlTabPage.tsx, tableStructure/TableDataView.tsx, TableStructureDetail.tsx | 100 | 100 | Có |
| hooks/useSqlRunner.ts | 100 | 97,61 | Có |
| navbar/DbProfileItem.tsx | 100 | 96,42 | Có |
| navbar/DbProfiles.tsx | 98,95 | 98,8 | Có |
| sqlResult/SqlResultPanel.tsx (#46) | 100 | 95,65 | Có |

### Vấn đề còn lại
- Chưa xác minh: Go `-race` của #46 (máy không cgo); WebView2/DPI 125–150% và bản dịch (MANUAL TC-R1-33/34); chạy app thật với DLL qua NSIS/portable, hộp thoại chọn file native; docs Wails v3 không truy cập được (banner).
- Banner Wails server mode "Browser Environment Detected": lọc ở harness QA, không đổi code app.
- Nhánh `timeout(CLOSE_TIMEOUT)` của MySQL `shutdown` không test được (không có seam).
- R3 known (không sửa): T3, T4, C2 (commit dc5d07e tên "chore(temp file)" nhưng sửa production code 5 actor), P5, Q13, T6, Q9, `BEGIN ... END` của T-SQL coi như mở transaction (thận trọng).
- R1 known (không sửa): P1 (re-render `DbTreeRow` mỗi lần toggle), B3 (cursor tab Data giữ read transaction trên SQLite journal `delete`: ghi từ tab khác có thể chờ `busy_timeout` 5 s), B4 (cây `error` thử lại `GetSchemaTree` + toast mỗi lần đổi tab cùng profile).
- #46 known (không sửa): B2 (tab đóng mà `open` cũng lỗi thì trả lỗi gốc), `closeAll` không đánh dấu lần mở đang chạy, hai lần mở song song cùng tab không có `closeTab` thì lần sau đóng connection lần trước.
- `.claude/settings.json` (dc5d07e comment out deny rules): người dùng sửa lại ở PR #49 (đã merge).
- Có sẵn, chưa quyết: comment đầu `000003_db_profiles.sql` sai đường dẫn; `libsqlite3-sys = "*"`; bản dịch vi/ja/zh-CN/zh-TW/ru/de chưa có người bản ngữ duyệt (kể cả CHANGELOG beta.19); `biome.json` schema 2.6.6 lệch CLI 2.6.8; hint `knip.json` về stylelint; virtualizer các list S3 cũ (`ConnectionProfiles`, `BucketListView`, `ObjectListView`, `DataGrid`, `UploadFileList`, `HistoryModal`) chưa làm tròn `estimateSize` như `DbProfiles` mới.
- Máy dev đã áp bản cũ migration 000003 phải xoá bảng `db_profiles` hoặc `goose down` một bậc.
- `CLAUDE.md` và `.claude/agents/rust-tester.md`: người dùng đã tự sửa ở PR #50 (đã merge) (quy ước test Rust `rust/tests/unit/`, `S3B_REQUIRE_DB=1`, `Tabs` `display-none`, virtualizer `Math.round`, ngữ nghĩa SQL Server, mục tiêu hiệu năng đo với DB local). Còn mở nếu muốn: plan 10.12 phần hợp đồng FFI `open` (field mạng, `tls`, `firstRowMs`); ngoại lệ vòng review thứ 4 thành quy tắc ở §5.
- Lỗi quy trình của orchestrator trong sprint này: báo reviewer thoả thuận chưa được người dùng xác nhận (hoãn C1); gọi hai agent viết code song song một lần (T5 + C3).
- Việc sau sprint này: nối Go/FE cho MySQL, MariaDB, PostgreSQL, SQL Server, MongoDB, Redis (plan 10.13: lưu `config` theo provider, `ConnectDb` mọi provider, TLS ở FE/Go, hiển thị MongoDB/Redis, cây object cho DB mạng); đo hiệu năng DB cài trực tiếp trên host; tài liệu README/user guide chế độ SQL khi PostgreSQL có backend.
