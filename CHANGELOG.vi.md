# Nhật ký thay đổi

[English](CHANGELOG.md) | **Tiếng Việt** | [日本語](CHANGELOG.ja.md) | [简体中文](CHANGELOG.zh-CN.md) | [繁體中文](CHANGELOG.zh-TW.md) | [Русский](CHANGELOG.ru.md) | [Deutsch](CHANGELOG.de.md)

Mọi thay đổi đáng chú ý của dự án được ghi trong file này.
Định dạng dựa theo [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Chưa phát hành]

## [0.1.0] - Chưa phát hành

### Thêm mới

- Hộp thoại Cài đặt (nút bên trái nút Lịch sử tải xuống): giao diện (sáng / tối / theo hệ thống), phông chữ (Nunito, System UI, Segoe UI, Arial, Roboto, Be Vietnam Pro, Verdana, Meiryo UI, Monospace, JetBrains Mono), ngôn ngữ và khởi động cùng Windows (chỉ bản cài đặt trên Windows).
- Cài đặt được lưu trong `settings.json` cạnh `data.db` và nạp trước khi hiện giao diện, nên ngôn ngữ giờ đã được ghi nhớ.
- Thay đổi được xem trước ngay. **Áp dụng** giữ thay đổi đến khi đóng app, **Lưu** ghi vào file, **Đặt lại mặc định** đưa form về mặc định.
- Giao diện tối.
- Đóng gói sẵn phông JetBrains Mono, Roboto và Be Vietnam Pro.
- Kéo thả để sắp xếp lại tab. App ghi nhớ số lượng, thứ tự và hồ sơ của các tab đang mở khi đóng app.
- Nhiều phương thức xác thực cho mỗi hồ sơ kết nối, chọn trong hộp thoại kết nối:
  - AWS S3: access key (kèm session token tuỳ chọn), AWS CLI profile, assume role (kèm MFA tuỳ chọn), AWS SSO, default chain và truy cập ẩn danh vào các bucket bạn nhập.
  - MinIO: access key, MinIO STS, LDAP / Active Directory, OpenID Connect (đăng nhập bằng trình duyệt hệ thống, authorization code với PKCE), chứng chỉ client TLS (mTLS) và truy cập ẩn danh.
  - File CA tuỳ chọn cho máy chủ MinIO có chứng chỉ do một tổ chức cấp chứng chỉ riêng cấp.
  - Credential tạm thời được làm mới tự động trước khi hết hạn, và hiện cảnh báo khi sắp hết hạn trong lúc đang truyền file.
  - Secret (gồm mật khẩu LDAP và passphrase của key) được lưu mã hoá. Phiên đăng nhập OIDC chỉ nằm trong bộ nhớ; app không bao giờ lưu token.
- Tạo bucket (AWS S3 có chọn region, MinIO), có thể đặt chế độ truy cập ngay khi tạo.
- Quyền của bucket: riêng tư (không có bucket policy), công khai chỉ đọc, hoặc policy tuỳ chỉnh sửa dạng JSON, có cảnh báo khi Block Public Access sẽ từ chối policy công khai.
- Ngăn chi tiết bucket.
- Xoá bucket sau khi gõ tên bucket. Bucket không rỗng sẽ được làm rỗng trước, gồm mọi version và delete marker. Bucket không rỗng có Object Lock thì không xoá được.
- Mỗi dòng bucket hiện badge loại policy (Riêng tư / Công khai / Tuỳ chỉnh), chỉ tải lười cho các dòng đang hiển thị.
- Bucket không truy cập được, hoặc chỉ đọc với tài khoản hiện tại, được đánh dấu trong danh sách.
- Hộp thoại kết quả sau khi xoá nhiều object, liệt kê những mục không xoá được.
- Kiểm tra và cài đặt bản cập nhật từ GitHub Releases: có cài đặt tự động kiểm tra và tải bản cập nhật, thanh tiến trình tải, kiểm tra SHA-256 của file đã tải, và xác nhận trước khi app thoát để chạy bộ cài. Công tắc beta cho phép nhận các bản thử nghiệm.
- Giao diện tiếng Trung giản thể, tiếng Trung phồn thể, tiếng Nga và tiếng Đức, bên cạnh tiếng Anh, tiếng Việt và tiếng Nhật (tổng cộng 7 ngôn ngữ). Ngôn ngữ được tải khi cần.

### Thay đổi

- Nút chuyển EN / VI / JA trên thanh trên cùng được chuyển vào hộp thoại Cài đặt.
- Màu dùng biến theme nên mọi màn hình hiển thị đúng ở cả giao diện sáng và tối. Trạng thái kết nối của hồ sơ dùng xanh nhạt / đỏ nhạt.
- Nút trong hộp thoại: Hủy nằm bên trái, các nút thao tác bên phải (xác nhận, tải lên, lịch sử, cài đặt).
- Màu nền cửa sổ khi khởi động theo giao diện đã lưu.
- Cuộn mượt hơn ở danh sách object dài và danh sách hồ sơ kết nối.
- Sự kiện tiến trình tải lên và tải xuống được gộp theo lô, nên giao diện vẫn mượt khi truyền file lớn.
- Đổi ngôn ngữ hoặc phông chữ không còn làm giao diện bị khựng, và bố cục tab chỉ được lưu khi có thay đổi.
- Thông báo tự ẩn sau 10 giây.
- File cơ sở dữ liệu được sao lưu trước khi chạy migration.
- Dọn dẹp nội bộ backend và frontend (gom hàm dùng chung, xoá code chết), bổ sung thêm unit test.

### Loại bỏ

- Bản build cho macOS và Linux. S3Browser giờ chỉ phát hành cho Windows 10/11 (x64).

## [0.0.1-beta.1] - 2026-10-28

Bản beta đầu tiên.

### Thêm mới

- Hồ sơ kết nối: tạo, sửa, xoá, tự động kết nối, secret được mã hoá.
- Kết nối AWS S3 và MinIO (endpoint, region, path style), nhiều kết nối cùng lúc trong các tab.
- Duyệt bucket, thư mục và object với danh sách phân trang.
- Tìm kiếm bucket và object, kết quả phân trang.
- Ngăn chi tiết object.
- Tải lên file và thư mục bằng hộp thoại chọn hoặc kéo thả, có giới hạn tải lên và cửa sổ tiến độ.
- Tải xuống một hoặc nhiều object theo từng đoạn song song, có cửa sổ tiến độ, huỷ và lịch sử tải xuống được lưu lại.
- Xoá object và thư mục, có bước xác nhận.
- Giao diện tiếng Anh, tiếng Việt và tiếng Nhật.
- Bản portable cho Windows, lưu dữ liệu cạnh file exe và kèm WebView2 riêng.
- Tài liệu: tài liệu kiến trúc và hướng dẫn sử dụng (PDF) bằng ba ngôn ngữ.

### Thay đổi

- Khởi động nhanh hơn: các hộp thoại nặng chỉ được tải khi cần, mã tải lúc khởi động nhẹ hơn khoảng 24%.
- Danh sách tải 20 mục mỗi trang thay vì 10, ít lượt gọi hơn khi duyệt bucket lớn.
- Chọn object không còn vẽ lại toàn bộ tab.
- Dọn dẹp nội bộ backend và frontend (gom hàm dùng chung, xoá code chết và dependency không dùng), bổ sung thêm unit test.
