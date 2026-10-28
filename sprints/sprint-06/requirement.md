# Sprint 06: Modal chọn file để upload

## Mục tiêu

Thêm button mở modal cho phép người dùng chọn file (qua hộp thoại chọn file hoặc kéo thả), xem trước danh sách, tick chọn file cần upload rồi upload lên S3, thay vì chỉ upload được bằng cách thả file vào danh sách object.

## Yêu cầu

### R1: Button upload và modal chọn file

- **Mô tả:**
  - Button upload đặt ngay cạnh button search.
  - Người dùng click button upload để mở modal chọn file.
  - Trong modal có button mở hộp thoại chọn file của hệ điều hành (File Explorer), hoặc người dùng kéo thả file vào modal. File được thêm vào danh sách xem trước trong modal.
  - Chọn được số lượng file tuỳ ý; mỗi file có checkbox để người dùng chọn file nào sẽ upload.
  - Khi upload, áp dụng cùng các giới hạn tối đa đang có trong chức năng thả file để upload (số file mỗi folder, số file lớn, tổng số file...).
  - Ở ObjectListView: upload vào bucket và prefix hiện tại.
  - Ở BucketListView: modal có thêm ô chọn bucket đích; phải chọn bucket mới upload được.
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** ObjectListView, BucketListView, modal upload mới
- **Tiêu chí chấp nhận:**
  - [x] Có button upload cạnh button search ở ObjectListView và BucketListView; click vào mở được modal
  - [x] Trong modal có thể mở hộp thoại chọn file hoặc kéo thả file vào để xem trước danh sách
  - [x] Mỗi file trong danh sách có checkbox để chọn/bỏ chọn upload
  - [x] Ở BucketListView, chọn được bucket đích trong modal
  - [x] Click button upload trong modal để upload các file đã chọn; click cancel để huỷ và đóng modal
  - [x] Giới hạn tối đa giống chức năng thả file để upload
  - [x] Danh sách file trong modal dùng virtual list để cuộn mượt với danh sách lớn
  - [x] Ưu tiên hiệu năng để tăng trải nghiệm người dùng

## Ngoài phạm vi

- Viết unit test của Go

## Ràng buộc / ghi chú

- Tái sử dụng luồng upload hiện có (`UploadObject`, `uploadingTabId`, cảnh báo đang có upload khác) và giới hạn từ `FilesDroppedOutput` / `UploadLimitModal`.
- Danh sách file trong modal phải virtualize (`@tanstack/react-virtual`).

## Câu hỏi đã biết

- Backend `UploadObject` cần đường dẫn file trên máy (`path`), nhưng `<input type="file">` trong webview không trả về đường dẫn. Có lẽ cần dùng hộp thoại chọn file native của Wails v3 qua backend; planner xác nhận cách làm.
- Kéo thả vào modal: drop file hiện được xử lý ở mức window qua Wails. Cần làm rõ cách phân biệt thả vào modal với thả vào danh sách object khi modal đang mở.
- Hộp thoại chọn file có cho chọn cả folder không, hay chỉ file?
- Khi vượt giới hạn: tự bỏ các file vượt và cảnh báo, hay chặn button upload cho đến khi người dùng bỏ tick bớt?
