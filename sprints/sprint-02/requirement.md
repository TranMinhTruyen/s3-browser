# Sprint 02: Thêm chức năng delete prefix và tất cả các object con của prefix đó, chỉnh sửa để có thể upload tất cả các sub folder trong 1 folder

## Mục tiêu
Thêm chức năng delete prefix và tất cả các object con của prefix đó
Chỉnh sửa phần upload folder để có thể upload tất cả các sub folder và file của sub folder được drag drop vào

## Yêu cầu

### R1: Chức năng delete prefix và tất cả các object con của prefix đó
- **Mô tả:** Thêm 1 button cho Object item là folder có thể mở menu giống với object bình thường như menu chỉ hiện mỗi delete thôi
- **Nền tảng:** Windows
- **Màn hình liên quan:** Trang ObjectListView
- **Tiêu chí chấp nhận:**
  - [x] 1.Mở được menu của ObjectItem là loại folder
  - [x] 2.Menu chỉ hiện item là delete
  - [x] 3.Nhấn delete sẽ delete folder và tất cả các object và sub folder bên trong

### R2: chỉnh sửa lại upload folder để có thể upload tất cả các sub folder và file của sub folder
- **Mô tả:** Sửa lại upload folder để có thể upload tất cả các sub folder và file của sub folder
- **Nền tảng:** Windows
- **Màn hình liên quan:** Trang ObjectListView
- **Tiêu chí chấp nhận:**
  - [x] 1.Upload được tất cả các sub folder bên trong folder được drag drop vào
  - [x] 2.Nếu có từ 5 file có dung lượng 10gb trở lên thì dừng lại và hiện modal cảnh báo cho user
  - [x] 3.Nếu được thì từng folder cha và các sub folder là từng goroutine upload riêng được không ?
  - [x] 4.Nếu sub folder nhiều hơn 50 file thì đưa ra modal cảnh báo chỉ upload 50 file đầu tiên
  - [x] 5.Nếu sub folder nhiều file mà có từ 5 file có dung lượng là 10gb trở lên thì đưa ra modal cảnh báo chỉ cho upload 5 file có dung lượng từ 10gb trở xuống
  - [x] 6. Nếu cả 2 check 4 và 5 đều vi phạm thì giúp tôi hiện trong cùng modal được không ? sử dụng Accordion của mantine được không ?

## Ngoài phạm vi
Chỉnh sửa lại giới hạn upload cho tối đa là 50 file
Nếu upload nhiều file mà có từ 5 file có dung lượng là 10gb trở lên thì dừng lại và hiện modal cảnh báo cho user chỉ cho upload 5 file có dung lượng từ 10gb trở xuống
Nâng mức dung lượng tối đa cho 1 file được upload từ 5gb -> 10gb
Giúp tôi kiểm tra xem có thể upload object với prefix hay không ?

## Ràng buộc / ghi chú

## Câu hỏi đã biết
