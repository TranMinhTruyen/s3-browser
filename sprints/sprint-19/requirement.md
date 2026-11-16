# Sprint 19: Chế độ SQL — cây đối tượng DB, tab TableStructure và backend SQLite đầu tiên

## Mục tiêu
Khi Connect một profile DB, người dùng duyệt được các đối tượng của DB (Tables, Views, Indexes, Triggers) dưới dạng cây ngay trong thẻ profile, và double click vào một table để mở tab xem cấu trúc và dữ liệu của table đó, tham khảo Navicat và A5:SQL Mk-2. Sprint này cũng dựng phần backend đầu tiên của chế độ SQL theo kiến trúc ở mục 8 `CLAUDE.md` (Rust `s3b_db.dll` + Go `internal/modules/db`), làm trước cho **SQLite**: Connect vào file `.db` thật, chạy câu SQL và xem kết quả. PostgreSQL vẫn dùng dữ liệu mock.

## Yêu cầu

### R1: Cây đối tượng DB trong thẻ profile và tab TableStructure
- **Mô tả:**
  - Khi profile đã Connect, thẻ profile trong navbar SQL có **Accordion**. Mở Accordion thì hiện một cây đối tượng của DB, dùng component [Mantine Tree](https://mantine.dev/core/tree/). Cây giống Navicat: SQLite là `main` → nhóm **Tables**, **Views**, **Indexes**, **Triggers** → từng đối tượng; PostgreSQL là database → schema → các nhóm đó → từng đối tượng. Nhiều Accordion profile được mở cùng lúc.
  - Khi chuyển sang một tab SQL đang gắn với một profile đã Connect, nếu Accordion của profile đó đang đóng thì tự mở ra.
  - Double click vào một table trong cây thì mở một **tab đặc biệt `TableStructure`** cho table đó. Tab có các tab con:
    - **Data**: lưới các row dữ liệu, chỉ xem.
    - **Column**: cấu trúc cột (tên, kiểu, null, default, khoá chính).
    - **Index**: danh sách index.
    - **Constraint**: danh sách constraint (PK, unique, check).
    - **FK**: khoá ngoại.
    - **Source**: câu `CREATE TABLE` (DDL).
  - Profile SQLite lấy cây và dữ liệu table **thật** qua backend R2. Profile PostgreSQL vẫn dùng **mock**.
- **Nền tảng:** SQLite (dữ liệu thật), PostgreSQL (mock)
- **Màn hình liên quan:** navbar chế độ SQL (`pages/sql/navbar/DbProfiles.tsx`, `DbProfileItem.tsx`), dải tab SQL (`pages/sql/SqlTabPage.tsx`), component tab mới `TableStructure`.
- **Tiêu chí chấp nhận:**
  - [ ] Profile chưa Connect thì không có Accordion, hoặc Accordion không mở được; thẻ profile vẫn giống sprint-18.
  - [ ] Profile đã Connect có Accordion mở/đóng được, độc lập với profile khác (mở cùng lúc được); bên trong là Mantine `Tree`: SQLite `main` → Tables / Views / Indexes / Triggers → đối tượng, PostgreSQL database → schema → các nhóm đó → đối tượng, mỗi nút có icon riêng (lucide), giống ảnh tham khảo Navicat. Không có nhóm Queries và Backups.
  - [ ] Disconnect thì Accordion của profile đó đóng lại và cây bị bỏ; các tab `TableStructure` của profile đó đóng theo. Xoá profile cũng đóng các tab `TableStructure` của profile đó.
  - [ ] Click đơn vào một node chỉ chọn (tô sáng), không mở tab. Double click vào View, Index, Trigger không làm gì.
  - [ ] Chọn một tab đang gắn với một profile đã Connect: nếu Accordion của profile đó đang đóng thì tự mở. Nếu đang mở thì giữ nguyên, không đóng các Accordion khác.
  - [ ] Double click một table mở tab `TableStructure` cho table đó. Table đã có tab đang mở thì chuyển tới tab đó, không mở thêm tab.
  - [ ] Tab `TableStructure` hiện tên table trên dải tab, có icon khác với tab SQL thường; đóng, kéo thả, sắp xếp được như tab SQL.
  - [ ] Tab `TableStructure` có 6 tab con: Data, Column, Index, Constraint, FK, Source.
    - Data hiện lưới row dữ liệu, chỉ xem, có số thứ tự dòng, ô `NULL` hiển thị khác ô có giá trị.
    - Bảng dài hoặc nhiều cột phải virtualize, cuộn ngang được. Với SQLite, row tải theo trang qua `cursorId` như R2.
  - [ ] SQLite: cây, cột, index, constraint, FK, DDL và row lấy từ file `.db` thật qua R2.
  - [ ] PostgreSQL: dữ liệu mock khai báo ở chỗ dễ thay bằng backend (cạnh profile mock của sprint-18), có ít nhất một table nhiều cột và nhiều row để kiểm virtualize.
  - [ ] Đúng cả 3 cỡ giao diện small/medium/large và cả theme sáng/tối; chuỗi UI đủ 7 ngôn ngữ.

### R2: Backend chạy SQL cho SQLite (Rust `s3b_db.dll` + Go `modules/db`)
- **Mô tả:**
  - Dựng thư viện native `s3b_db.dll` trong `rust/` (cdylib, `x86_64-pc-windows-msvc`) theo đúng hợp đồng FFI ở mục 8 `CLAUDE.md`: 4 hàm `s3b_init`, `s3b_call`, `s3b_cancel`, `s3b_free`; phân lớp `ffi.rs` → `dispatch.rs` → `drivers/sqlite.rs`; payload JSON camelCase. Driver SQLite dùng `sqlx` với libsqlite3 bundled, runtime `tokio`.
  - Go: module `internal/modules/db` load DLL không dùng cgo, handler mới làm Wails service, message code `DBE<NNN>` đủ 7 ngôn ngữ. Task `build:native` build DLL trước Go và copy cạnh exe, vào bản portable và NSIS.
  - Profile SQLite **lưu vào SQLite của app** (migration goose + query sqlc), giữ sau khi tắt app. Tạo/sửa profile chọn file `.db` bằng hộp thoại native, có tuỳ chọn mở chỉ đọc (mặc định tắt). Profile PostgreSQL mock vẫn ở RAM.
  - Connect profile SQLite mở connection thật tới file; mỗi tab một connection riêng.
  - Ctrl+E / nút Execute chạy SQL thật (phần đang chọn, hoặc toàn bộ):
    - Chạy được mọi loại câu: SELECT trả row; INSERT/UPDATE/DELETE/DDL trả số dòng bị ảnh hưởng.
    - Nhiều câu cách nhau bằng `;` chạy lần lượt, dừng ở câu lỗi đầu tiên; Rust tách câu theo cơ chế của SQLite.
    - Autocommit, không có nút Commit/Rollback.
    - Có nút **Huỷ** khi đang chạy (ctx Go huỷ → `s3b_cancel`, trả `Result=false` im lặng).
  - Panel kết quả dưới editor của tab SQL: mỗi câu một tab **Result 1, 2…**, và một tab **Messages** (câu đã chạy, số dòng ảnh hưởng, thời gian, lỗi).
  - Kết quả SELECT tải **theo trang qua `cursorId`**, mỗi lần 500 row; cuộn tới cuối lưới thì tải tiếp. Không đọc cả kết quả vào RAM.
  - Backend có thêm lệnh đọc schema (danh sách table/view/index/trigger, cột, index, constraint, FK, DDL) và đọc row của một table để R1 dùng cho SQLite.
- **Nền tảng:** SQLite (Windows)
- **Màn hình liên quan:** modal profile DB (`DbProfileModal`), navbar SQL (Connect/Disconnect), tab SQL (`SqlTabDetail`, panel kết quả mới), backend `rust/`, `internal/modules/db`, `internal/handlers`, migration và query DB của app.
- **Tiêu chí chấp nhận:**
  - [ ] `cargo fmt --check`, `cargo clippy ... -D warnings`, `cargo build --release` qua; mọi hàm export bọc `catch_unwind`, không `unwrap`/`expect` ngoài test; buffer Rust chỉ giải phóng qua `s3b_free`.
  - [ ] `go build ./...`, `go vet ./...`, golangci-lint qua với `CGO_ENABLED=0`; bindings sinh lại bằng skill `wails3-bindings`.
  - [ ] Tạo, sửa, xoá profile SQLite lưu vào DB của app, còn sau khi khởi động lại app.
  - [ ] Connect vào file `.db` thật; file không tồn tại hoặc không phải SQLite thì báo lỗi bằng message `DBE<NNN>`.
  - [ ] Ctrl+E chạy SELECT hiện lưới kết quả; INSERT/UPDATE/DELETE/DDL hiện số dòng ảnh hưởng ở Messages; nhiều câu ra nhiều tab Result, dừng ở câu lỗi đầu tiên và báo lỗi ở Messages.
  - [ ] SELECT trên table lớn (ví dụ 100.000 row) không treo UI, tải 500 row mỗi trang khi cuộn, RAM không tăng theo toàn bộ kết quả.
  - [ ] Huỷ khi đang chạy dừng được câu lệnh, không hiện lỗi; đóng tab hoặc Disconnect thì đóng connection và cursor của tab đó.
  - [ ] Không log secret hay dữ liệu truy vấn.
  - [ ] Test: `cargo test` có commit cho protocol, dispatch và driver SQLite (dùng file DB tạm), do `rust-tester` viết; Go test hồi quy tạm do `go-tester`; FE C1 ≥ 95% từng file.

## Ngoài phạm vi
- Backend PostgreSQL và MongoDB; profile PostgreSQL vẫn là mock.
- Sửa dữ liệu trong lưới (thêm/xoá/sửa row, commit), filter, sort, export kết quả: dự định làm ở sprint sau, theo cách lấy dữ liệu của Navicat và A5:SQL Mk-2.
- Mở cấu trúc của View, Index, Trigger (chỉ hiện trong cây, double click không làm gì).
- Nút mở tab SQL với `SELECT * FROM <table>` từ tab `TableStructure`.
- Nhóm Queries và Backups của Navicat.
- Import/export profile DB ra file, lịch sử câu lệnh, lưu/mở file `.sql`.
- Tài liệu (README, user guide): làm khi PostgreSQL cũng có backend.

## Ràng buộc / ghi chú
- Theo các nguyên tắc của sprint-18: code SQL ở frontend nằm trong thư mục riêng, không sửa code S3, store SQL tách khỏi store S3, lazy load chế độ SQL.
- Backend theo đúng mục 8 `CLAUDE.md` (luồng React → `callIPC` → binding Go → `modules/db` → `s3b_call` → Rust; frontend không biết Rust tồn tại). DLL load bằng đường dẫn tuyệt đối cạnh exe; chỉ build Windows.
- Thay code tạm của sprint-18 (toast "chưa có backend", Connect giả) bằng gọi backend thật cho SQLite; PostgreSQL giữ hành vi tạm.
- Cây và lưới dữ liệu là danh sách có thể lớn: virtualize theo quy tắc trong `CLAUDE.md`, kích thước viết bằng rem, hằng px của virtualizer nhân `useUiScale()`.
- Tham khảo UI: Navicat (cây đối tượng, ảnh 1) và A5:SQL Mk-2 (tab xem table với các tab con Data / Column / Index / Constraint / FK / Source, ảnh 2).
- R1 (phần SQLite) dùng API của R2, nên hai yêu cầu phụ thuộc nhau: planner đề xuất gộp chung một branch hoặc làm R2 trước rồi R1, ghi thành câu hỏi kèm phương án.
- Test FE C1 ≥ 95% cho từng file đã đổi hoặc mới; chạy toàn bộ `vitest run` để chắc chế độ SQL của sprint-18 và S3 không bị hồi quy.

## Câu hỏi đã biết
- Đã chốt 2026-11-16 (người dùng chọn qua poll):
  - R1: cây gồm Tables, Views, Indexes, Triggers (không có Queries, Backups); nhiều Accordion mở cùng lúc; PostgreSQL database → schema → nhóm, SQLite `main` → nhóm; `TableStructure` có 6 tab con riêng như A5:SQL Mk-2; Disconnect hoặc xoá profile thì đóng các tab `TableStructure` của profile đó; click đơn chỉ chọn node; double click View/Index/Trigger không làm gì; chưa làm nút `SELECT * FROM <table>`.
  - R2: kiến trúc Rust DLL + Go theo `CLAUDE.md` mục 8; Ctrl+E chạy thật và có lưới kết quả; chạy mọi loại câu, nhiều câu một lần, dừng ở câu lỗi đầu tiên; Rust có `cargo test` commit; profile SQLite lưu vào SQLite của app; SQLite dùng dữ liệu thật cho R1; kết quả tải theo trang qua `cursorId`; mỗi câu một tab Result và có nút Huỷ.
  - Profile PostgreSQL mock vẫn ở RAM, chỉ profile SQLite lưu vào DB của app.
  - Profile SQLite có tuỳ chọn mở chỉ đọc (`mode=ro`), mặc định tắt; bật thì câu ghi báo lỗi.
  - Câu lệnh chạy autocommit; muốn transaction thì người dùng tự viết `BEGIN`/`COMMIT`.
  - Rust tách nhiều câu theo cơ chế của SQLite (phần còn lại sau `prepare`), đúng cả với `;` trong chuỗi, comment, thân trigger.
