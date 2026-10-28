# Nhật ký thay đổi

[English](CHANGELOG.md) | **Tiếng Việt** | [日本語](CHANGELOG.ja.md)

Mọi thay đổi đáng chú ý của dự án được ghi trong file này.
Định dạng dựa theo [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
