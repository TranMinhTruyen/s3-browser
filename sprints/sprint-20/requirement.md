# Sprint 20: Nối DB mạng cho chế độ SQL và lưu dữ liệu bảng

## Mục tiêu
Hoàn tất các việc còn lại của sprint-19: chế độ SQL dùng được với các DB mạng (driver Rust đã có), lưu được thay đổi ở tab Data, dọn các known issue mức low và viết tài liệu cho chế độ SQL.

## Yêu cầu

### R1: Nối Go/FE cho 6 DB mạng
- **Mô tả:** Người dùng tạo profile MySQL, MariaDB, PostgreSQL, SQL Server, MongoDB, Redis, Connect, chạy SQL/lệnh, xem cây object và dữ liệu bảng như SQLite hiện nay. Driver Rust đã có từ sprint-19 R3; sprint này nối Go (`modules/db`) và FE theo `sprints/sprint-19/plan.md` mục 10.13.
- **Nền tảng:** chế độ SQL (6 DB mạng)
- **Màn hình liên quan:** modal profile DB, navbar SQL (cây object), tab SQL, tab TableStructure
- **Tiêu chí chấp nhận:**
  - [ ] Lưu `config` theo provider (host, port, database, user, TLS 6 chế độ, `caFile`...), secret mã hoá như hiện nay.
  - [ ] `ConnectDb` chạy với mọi provider; PostgreSQL bỏ dữ liệu mock (Connect, cây, dữ liệu là thật).
  - [ ] Cây object cho DB mạng (database/schema/nhóm như PostgreSQL mock hiện tại).
  - [ ] Hiển thị kết quả MongoDB (một cột JSON, `FieldInput` type `json`, Q25/Q33) và Redis (RESP3 quy đổi cột, Q26).
  - [ ] Fetch all data, Refresh, Loaded rows hoạt động với DB mạng.
  - [ ] Đo `elapsedMs` trang 10.000 dòng với DB cài trên máy (không qua Docker) theo mục tiêu ở `CLAUDE.md` mục 8.

### R2: Commit dữ liệu bảng ở tab Data
- **Mô tả:** Nút **Commit** của tab Data (hiện bị khoá) ghi các thay đổi đang chờ (sửa ô, thêm dòng, xoá dòng) xuống DB qua Rust, trong một transaction.
- **Nền tảng:** SQLite và các DB mạng của R1 (MongoDB/Redis tuỳ plan)
- **Màn hình liên quan:** tab TableStructure → Data
- **Tiêu chí chấp nhận:**
  - [ ] Tìm dòng theo primary key; bảng không có PK thì theo mọi cột (`ChangeSet` trong `useTableEdits.ts`).
  - [ ] Lỗi một câu thì rollback cả transaction, giữ thay đổi trên lưới và báo lỗi.
  - [ ] Commit xong thì nạp lại dữ liệu, `Changed rows` về 0.
  - [ ] Profile read-only thì không Commit được.

### R3: Known issues mức low từ sprint-19
- **Mô tả:** Sửa các vấn đề đã ghi trong `sprints/sprint-19/report.md` mục "Vấn đề còn lại".
- **Nền tảng:** chế độ SQL, một phần S3
- **Màn hình liên quan:** nhiều màn
- **Tiêu chí chấp nhận:**
  - [ ] R1 sprint-19: P1 (re-render `DbTreeRow` mỗi lần toggle), B3 (cursor tab Data giữ read transaction SQLite), B4 (cây lỗi gọi lại `GetSchemaTree` + toast mỗi lần đổi tab).
  - [ ] #46: B2 (tab đóng mà `open` lỗi thì trả lỗi gốc), `closeAll` không đánh dấu lần mở đang chạy.
  - [ ] R3 sprint-19: T3, T4, C2, P5.
  - [ ] R2 sprint-19: Q6, Q8.
  - [ ] Làm tròn `estimateSize` của virtualizer các list S3 cũ (`ConnectionProfiles`, `BucketListView`, `ObjectListView`, `DataGrid`, `UploadFileList`, `HistoryModal`) như `DbProfiles`.

### R4: Tài liệu chế độ SQL
- **Mô tả:** README, user guide (+ PDF) và ARCHITECTURE có phần chế độ SQL, đủ 7 ngôn ngữ, ảnh có ghi chú bằng `shots.mjs`.
- **Nền tảng:** tài liệu
- **Màn hình liên quan:** toàn bộ chế độ SQL
- **Tiêu chí chấp nhận:**
  - [ ] Viết bản `en` trước rồi dịch, nhãn UI lấy nguyên văn từ locale app.
  - [ ] Ảnh mới có khoá trong `docs/scripts/annotations.json` đủ 7 ngôn ngữ.

## Ngoài phạm vi
- Export/import dữ liệu bảng, sửa cấu trúc bảng (DDL qua giao diện).
- Build macOS/Linux.

## Ràng buộc / ghi chú
- Theo `CLAUDE.md` mục 8: mọi việc với DB người dùng do Rust làm, Go chỉ là interface.
- Plan chi tiết R1 đã có ở `sprints/sprint-19/plan.md` mục 10.13 và các câu Q25–Q36 đã chốt.
- Test DB thật chạy với `test-env/docker-compose-db.yml`, `S3B_REQUIRE_DB=1`.
- Chưa xác minh từ sprint-19 (test tay): TC-R1-33/34 (bản dịch, WebView2, DPI 125/150%), hộp thoại chọn file native, NSIS/portable có DLL, Go `-race` của #46.

## Câu hỏi đã biết
- Thứ tự làm và chia branch giữa R1–R4 (R4 nên làm sau R1).
- R2 có áp dụng cho MongoDB/Redis không, hay chỉ DB SQL.
- R3: mục nào thực sự cần sửa, mục nào giữ là known issue.
