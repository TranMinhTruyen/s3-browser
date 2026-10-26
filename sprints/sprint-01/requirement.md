# Sprint 01: Kiểm tra lại chức năng drag drop để upload file

## Mục tiêu
Kiểm tra độ hoàn thiện của chức năng drag drop để upload file

## Yêu cầu

### R1: Drag drop để up load file
- **Mô tả:** Người dùng kéo file thả vào app ứng dụng sẽ upload file lên profile của tab đang đang được chọn
- **Nền tảng:** Windows
- **Màn hình liên quan:** Trang ObjectListView
- **Tiêu chí chấp nhận:**
  - [x] Kéo thả 1 file và upload file lên được
  - [x] Kéo thả nhiều file và upload tất cả các file lên được
  - [x] Kéo thả 1 folder chứa nhiều file thì tất cả các file trong folder điều upload lên được với prefix là lên folder
  - [x] Viết unit test cho go yêu cầu là C1

### R2: Một UploaderWindow giống với DownloaderWindow để cho user biết quá trình upload file
- **Mô tả:** Hiện 1 windows ở dưới cùng bên trái giống với DownloaderWindow
- **Nền tảng:** Windows
- **Màn hình liên quan:** Trang ObjectListView
- **Tiêu chí chấp nhận:**
  - [x] Hiện 1 Float windows giống với DownloaderWindow sẽ hiện tiến trình các file đang upload lên
  - [x] Nếu đóng thì sẽ hiện 1 Float button giống với DownloaderWindow luôn
  - [x] Nếu vừa có download vủa có upload thì UploaderWindow khi mở sẽ nằm bên trái của DownloaderWindow và nếu đóng thì button của UploaderWindow sẽ nằm trên DownloaderWindow
  - [x] Viết unit test cho go yêu cầu là C1

## Ngoài phạm vi

## Ràng buộc / ghi chú
- Tối đa kéo thả được 5 file
- Nếu 5 file mà có 1 file nào có dung lượng hơn 5gb thì hiện cảnh báo cho user, lúc đó chỉ được upload có dung lượng lớn nhất

## Câu hỏi đã biết
