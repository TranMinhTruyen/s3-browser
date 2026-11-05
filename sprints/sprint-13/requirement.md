# Sprint 13: Tạo mới bucket và chỉnh sửa quyền bucket

## Mục tiêu
Cho phép người dùng tạo bucket mới và chỉnh sửa quyền của bucket có sẵn ngay trong app, thay vì phải dùng console AWS/MinIO.

## Yêu cầu

### R1: Tạo mới bucket
- **Mô tả:** Trên trang danh sách bucket, người dùng bấm nút tạo bucket, nhập tên (và các tuỳ chọn cần thiết), app tạo bucket rồi cập nhật danh sách.
- **Nền tảng:** Cả hai (AWS S3 và MinIO)
- **Màn hình liên quan:** trang bucket (`pages/tab/bucket`), modal tạo bucket mới
- **Tiêu chí chấp nhận:**
  - [ ] Có nút tạo bucket trên view danh sách bucket.
  - [ ] Validate tên bucket theo quy tắc đặt tên của S3 trước khi gửi.
  - [ ] Tạo thành công thì bucket mới hiện trong danh sách, không cần reload tay.
  - [ ] Lỗi (tên đã tồn tại, không có quyền, ...) hiện message rõ ràng, đủ 7 ngôn ngữ.

### R2: Chỉnh sửa bucket: đổi quyền
- **Mô tả:** Người dùng xem và thay đổi quyền truy cập của bucket.
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** trang bucket, modal chỉnh sửa bucket
- **Tiêu chí chấp nhận:**
  - [ ] Hiển thị quyền hiện tại của bucket.
  - [ ] Thay đổi và lưu quyền mới, lưu xong hiển thị lại đúng trạng thái.
  - [ ] Chỉ account có quyền mới thực hiện được (xem R3).

### R3: Kiểm soát quyền chỉnh sửa
- **Mô tả:** Chỉ những account có quyền tương ứng mới được chỉnh sửa bucket; account không có quyền không thể thực hiện thao tác.
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** trang bucket, modal chỉnh sửa bucket
- **Tiêu chí chấp nhận:**
  - [ ] Account không có quyền: nút/chức năng chỉnh sửa bị ẩn hoặc disable, hoặc thao tác bị từ chối với message rõ ràng.
  - [ ] Không để bucket ở trạng thái dở dang khi bị từ chối quyền giữa chừng.

### R4: Xem chi tiết bucket
- **Mô tả:** Menu của `BucketItem` có mục "Chi tiết", mở drawer bên phải giống `ObjectDetailDrawer` của danh sách object, hiển thị thông tin bucket (chỉ đọc).
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** trang bucket, menu `BucketItem`, drawer chi tiết bucket
- **Tiêu chí chấp nhận:**
  - [ ] Thông tin cơ bản: tên, ngày tạo, region, ARN/URL endpoint (có nút copy).
  - [ ] Quyền truy cập: chế độ policy (private / public chỉ đọc / custom) và trạng thái Block Public Access (AWS).
  - [ ] Cấu hình bucket (chỉ đọc): versioning, mã hoá mặc định, object lock, tag.
  - [ ] Số lượng object ở gốc bucket: mỗi folder chỉ tính là 1 object (list với delimiter `/`, không đếm đệ quy).
  - [ ] Mục nào bị từ chối quyền hoặc không hỗ trợ thì hiện `-`, không làm hỏng cả drawer.
  - [ ] Load lười, huỷ được khi đóng drawer hoặc đổi bucket, giống `ObjectDetailDrawer`.

### R5: Xoá bucket (thêm 2026-11-05)
- **Mô tả:** Menu của `BucketItem` có mục "Xoá" (Delete). Người dùng xác nhận bằng cách gõ lại tên bucket rồi app xoá bucket và cập nhật danh sách.
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** trang bucket, menu `BucketItem`, modal xác nhận xoá bucket
- **Tiêu chí chấp nhận:**
  - [ ] Kết nối anonymous: luôn ẩn mục Xoá (backend cũng chặn).
  - [ ] Chỉ ẩn mục Xoá khi biết chắc account bị từ chối `s3:DeleteBucket` (MinIO, policy `AccountInfo` đơn giản, giống `policyEditDenied`). Không xác định được (AWS, policy có Condition/biến, `AccountInfo` lỗi) thì vẫn hiện; xoá bị từ chối thì báo message rõ ràng, đủ 7 ngôn ngữ.
  - [ ] Luôn xác nhận bằng modal yêu cầu gõ đúng tên bucket thì nút Xoá mới bật.
  - [ ] Bucket còn object: modal hiện cảnh báo bucket không rỗng và toàn bộ object bên trong sẽ bị xoá; user gõ đúng tên bucket mới bắt đầu xoá hết object rồi xoá bucket.
  - [ ] Xoá xong bucket biến mất khỏi danh sách, không cần reload tay; tab đang mở bucket đó (nếu có) không bị hỏng.
  - [ ] Bị từ chối hoặc lỗi giữa chừng thì báo message rõ ràng; không xoá bucket khi chưa xoá hết object.

### R6: Đặt quyền ngay khi tạo bucket (thêm 2026-11-05)
- **Mô tả:** Modal tạo bucket (R1) có thêm phần chọn quyền truy cập, dùng đúng 3 chế độ của R2: private / public chỉ đọc / custom JSON. App tạo bucket rồi đặt policy theo lựa chọn.
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** `CreateBucketModal`
- **Tiêu chí chấp nhận:**
  - [ ] Mặc định chọn private (không đặt policy, giữ hành vi R1).
  - [ ] Chọn public hoặc custom: sau khi `CreateBucket` thành công thì đặt policy (dùng lại logic của R2, custom validate JSON trước khi gửi giống `BucketPolicyModal`).
  - [ ] Đặt policy lỗi: GIỮ bucket đã tạo (private), báo cảnh báo rõ ràng "bucket đã tạo nhưng chưa đặt được quyền" (7 ngôn ngữ), danh sách vẫn refresh; người dùng sửa sau bằng "Access permission". Không rollback xoá bucket.
  - [ ] AWS: chọn public/custom thì cảnh báo Block Public Access mặc định có thể chặn policy public (không sửa BPA).
  - [ ] Anonymous không mở được modal (giữ R1/R3).

## Ngoài phạm vi
- Đổi tên bucket (người dùng quyết định bỏ, 2026-11-05: S3/MinIO không có API rename, copy + xoá có rủi ro mất dữ liệu).
- Sửa các cấu hình bucket khác: versioning, lifecycle, encryption, CORS, tag, object lock (R4 chỉ hiển thị chỉ đọc versioning, encryption, object lock, tag).

## Ràng buộc / ghi chú
- Tên bucket AWS là duy nhất toàn cầu; bucket AWS gắn với region.
- Danh sách bucket hiện có thể lớn (đã virtualize), không làm chậm view danh sách.

## Câu hỏi đã biết (đã chốt 2026-11-05)
- Đổi tên: bỏ khỏi sprint.
- "Quyền" = bucket policy với 3 chế độ: private (không policy), public chỉ đọc (policy sinh sẵn), custom (sửa JSON). Không làm ACL; Block Public Access AWS chỉ hiển thị + cảnh báo, không cho sửa.
- Kiểm soát quyền theo đề xuất của planner: kết nối anonymous ẩn nút tạo/sửa (backend cũng chặn); modal quyền gọi `GetBucketPolicy`, nhận 403 thì chỉ đọc và disable Lưu; MinIO có credential kiểm trước qua policy `AccountInfo`; AWS thực hiện rồi báo AccessDenied.
- Tạo bucket: chỉ chọn region với AWS thật, không có object lock/versioning.
- Làm 1 branch cho cả sprint.
- Nút trên `BucketItem`: ActionIcon mở Menu giống `ObjectItem` (giữ menu để thêm thao tác sau).
- Tạo bucket AWS ở region khác `us-east-1` mà lỗi: chỉ hiện modal error, không xử lý thêm.
- Thêm R4 (2026-11-05): drawer chi tiết bucket mở từ menu `BucketItem`; số object chỉ đếm ở gốc, folder tính 1.
- Đếm object ở gốc: tối đa 10 trang (10.000 mục), chạm giới hạn thì hiện `10,000+`.
- Kết nối anonymous: vẫn hiện menu `BucketItem` nhưng chỉ có mục "Chi tiết" (ẩn "Quyền truy cập"); backend cho anonymous gọi chi tiết bucket.
- Giữ R4 trong sprint-13, 1 branch `SP-13/bucket_create_policy_detail`.
- Thêm R5 xoá bucket (2026-11-05), làm tiếp trên cùng branch `SP-13/bucket_create_policy_detail` (đã có commit R1-R4, chưa push). Quyền: ẩn khi biết chắc bị từ chối, không chắc thì hiện rồi báo lỗi. Xác nhận: luôn gõ tên bucket; bucket còn object thì cảnh báo rồi xoá hết object trước.
- Thêm R6 đặt quyền khi tạo bucket (2026-11-05), cùng branch. Chọn cả 3 chế độ private/public/custom; đặt policy lỗi thì giữ bucket và cảnh báo, không rollback.
