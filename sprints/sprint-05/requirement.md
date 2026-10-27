# Sprint 05: Tìm kiếm object

## Mục tiêu

Thêm 1 input và icon button search để tìm kiếm object trong ObjectListView và BucketListView

## Yêu cầu

### R1: Input và icon button search để tìm kiếm object

- **Mô tả:** Người dùng nhập tên Name hoặc Key của object sau đó nhấn search sẽ hiện ra các object trùng với điều kiện tìm kiếm
- **Nền tảng:** AWS S3 | MinIO | Cả hai
- **Màn hình liên quan:** ObjectListView, BucketListView
- **Tiêu chí chấp nhận:**
  - [ ] Người dùng nhập tên Name hoặc Key của object sau đó nhấn search
  - [ ] List Object hoặc Bucket sẽ hiện ra có tên gần giống với điều kiện tìm kiếm
  - [ ] Chỉ cần tìm kiếm 100 item đầu tiên
  - [ ] Ưu tiên hiệu năng để tăng trải nghiệm người dùng

## Ngoài phạm vi

- Viết unit test của go

## Ràng buộc / ghi chú

- Tìm kiếm tối đa 100 item đầu tiên

## Câu hỏi đã biết

- Không rõ AWS sdk hoặc MinIO sdk có hỗ trợ api tìm kiếm không vi trên client lazy load nên tôi sợ tìm trên client sẽ không chính xác
