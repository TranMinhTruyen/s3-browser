# Sprint 15: Cập nhật tài liệu cho bản release v0.1

## Mục tiêu
Tài liệu cho người dùng và README trên GitHub phản ánh đúng tính năng hiện có của app, sẵn sàng cho bản release v0.1.

## Yêu cầu

### R1: README trên GitHub
- **Mô tả:** Cập nhật `README.md`, `README.vi.md`, `README.ja.md`: giới thiệu, danh sách tính năng, ảnh minh hoạ, cách tải bản cài (GitHub Releases, kênh stable/beta), yêu cầu hệ thống, build từ source, link tới user guide.
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** Không (tài liệu)
- **Tiêu chí chấp nhận:**
  - [x] Danh sách tính năng khớp app hiện tại (sprint-01 → sprint-14)
  - [x] Hướng dẫn cài đặt và build từ source chạy đúng (đối chiếu nội dung, chưa chạy lại lệnh build khi đóng sprint)
  - [x] Ba bản ngôn ngữ cùng nội dung (mở rộng thành 7 bản, Q1-B)

### R2: User guide
- **Mô tả:** Cập nhật `docs/user-guide/{en,vi,ja}/user-guide.md`: kết nối AWS/MinIO (access key, STS/LDAP, OIDC, file CA), tạo/xoá bucket, bucket policy, drawer chi tiết bucket, badge policy type, upload/download, cài đặt (ngôn ngữ, theme, kênh cập nhật).
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** Toàn app
- **Tiêu chí chấp nhận:**
  - [x] Mỗi tính năng có mục hướng dẫn kèm ảnh
  - [x] Ảnh chụp lại theo UI hiện tại (bằng `shots.mjs`, xem R5)
  - [x] PDF sinh lại bằng `bun run --cwd docs build:pdf`

### R3: Tài liệu kiến trúc (ARCHITECTURE)
- **Mô tả:** Cập nhật `docs/ARCHITECTURE{,.vi,.ja}.md` theo code hiện tại (còn nợ từ sprint-11).
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** Không (tài liệu)
- **Tiêu chí chấp nhận:**
  - [x] Module, luồng xác thực, auto-update được mô tả đúng với code

### R4: CHANGELOG 0.1.0
- **Mô tả:** Thêm mục `0.1.0` vào `CHANGELOG.md`, `CHANGELOG.vi.md`, `CHANGELOG.ja.md`.
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** Không (tài liệu)
- **Tiêu chí chấp nhận:**
  - [x] Có mục 0.1.0 ở cả 3 ngôn ngữ (mở rộng thành 7 bản, Q1-B)

### R5: Mở rộng script chụp màn hình tự động
- **Mô tả:** Bổ sung bước vào `docs/scripts/shots.mjs` (Playwright, app chạy server mode) cho các màn hình mới từ sprint-08 trở đi: modal kết nối (STS/LDAP, OIDC, file CA), tạo bucket kèm quyền, sửa bucket policy, drawer chi tiết bucket, badge policy type, xoá bucket, cài đặt kênh cập nhật. Cập nhật `docs/seed/seed.mjs` nếu cần dữ liệu demo mới (ví dụ bucket có policy public/custom). Agent tự chạy script để chụp lại toàn bộ ảnh cho mọi ngôn ngữ tài liệu.
- **Nền tảng:** MinIO local (`test-env/`)
- **Màn hình liên quan:** Toàn app
- **Tiêu chí chấp nhận:**
  - [x] Một lần chạy `bun run --cwd docs shots` chụp đủ ảnh cho R1, R2
  - [x] Profile demo được tạo rồi xoá trong script, không để lại dữ liệu
  - [x] Credential chỉ truyền qua env, không ghi ra file hay hiện trong ảnh
  - [x] Màn hình không chụp được ở server mode (hộp thoại native, kéo thả, bước đăng nhập trên trình duyệt ngoài) được ghi rõ trong report

## Ngoài phạm vi
- Không sửa code app; không thay đổi version hay workflow release.

## Ràng buộc / ghi chú
- Chỉ sửa tài liệu và script trong `docs/`, không cần unit test.
- Quy trình chụp theo `sprints/sprint-07/report.md`: build `go build -tags server,production,portable -o <thư mục tạm>/S3Browser-server.exe .`, chạy với `WAILS_SERVER_PORT=8090`, MinIO seed bằng `node docs/seed/seed.mjs`. DB nằm cạnh exe tạm, không đụng `%APPDATA%`.
- Agent sẽ chạy Docker (`test-env/`), build exe và mở port local; cần người dùng cho phép ở B4.
- Màn hình không chụp được ở server mode thì tiêm event Wails (`window._wails.dispatchWailsEvent`) như `shots.mjs` đang làm: UI thật, dữ liệu giả.

## Câu hỏi đã biết
- Có mở rộng tài liệu sang zh-CN, zh-TW, ru, de (app hỗ trợ 7 ngôn ngữ) hay giữ en/vi/ja?
- "User doc" và "user guide" có phải hai tài liệu khác nhau không? Hiện hiểu: user guide = `docs/user-guide/`, user doc = `docs/ARCHITECTURE*`.
- Server mode (`-tags server`) còn chạy ổn với Wails `v3.1.0` hiện tại không? Chưa kiểm lại từ sprint-07.
- Màn hình OIDC/LDAP: có chạy Keycloak/LDAP trong `test-env/` để chụp không, hay chỉ chụp modal cấu hình? Bước đăng nhập OIDC mở trình duyệt ngoài nên có thể không chụp được.
- Chọn region khi tạo bucket chỉ có với AWS thật: có chụp màn hình này với AWS không, hay chỉ chụp với MinIO?
- Sprint-14 đã xong hẳn chưa (có `plan.md`, R1/R3 đã merge qua PR #7, chưa có `report.md`)? Sprint-15 có cần chờ không?
