# Sprint 01: Kiểm tra lại chức năng drag drop để upload file

## Mục tiêu
Kiểm tra độ hoàn thiện của chức năng drag drop để upload file

## Yêu cầu

### R1: Drag drop để up load file
- **Mô tả:** Người dùng kéo file thả vào app ứng dụng sẽ upload file lên profile của tab đang đang được chọn
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** Trang ObjectListView
- **Tiêu chí chấp nhận:**
  - [x] Kéo thả 1 file và upload file lên được
  - [x] Kéo thả nhiều file và upload tất cả các file lên được
  - [x] Kéo thả 1 folder chứa nhiều file thì tất cả các file trong folder điều upload lên được với prefix là lên folder
  - [x] Viết unit test cho go yêu cầu là C1

## Ngoài phạm vi

## Ràng buộc / ghi chú
- Tối đa kéo thả được 5 file
- Nếu 5 file mà có 1 file nào có dung lượng hơn 5gb thì hiện cảnh báo cho user, lúc đó chỉ được upload có dung lượng lớn nhất

## Câu hỏi đã biết
