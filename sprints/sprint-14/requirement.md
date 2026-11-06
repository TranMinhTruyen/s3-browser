# Sprint 14: Hiển thị policy type trên từng bucket

## Mục tiêu
Người dùng nhìn danh sách bucket là biết ngay bucket nào private, public chỉ đọc hay custom policy, không phải mở "Access permission" hay drawer "Chi tiết" của từng bucket.

## Yêu cầu

### R1: Badge policy type trên `BucketItem`
- **Mô tả:** Mỗi dòng bucket hiện một badge chế độ policy (private / public / custom) cạnh dòng "Create date". Danh sách bucket vẫn hiện ngay như hiện tại; badge được load lười và hiện sau khi có kết quả.
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** trang bucket (`pages/tab/bucket`), `BucketItem`, `BucketListView`
- **Tiêu chí chấp nhận:**
  - [ ] Badge dùng đúng 3 chế độ và cách nhận diện của sprint-13 R2 (`readPolicyMode`, so policy theo ngữ nghĩa), cùng nhãn i18n đủ 7 ngôn ngữ.
  - [ ] Không làm chậm lần hiện danh sách đầu: `ListBuckets` không chờ đọc policy.
  - [ ] Chỉ đọc policy cho các dòng đang hiện trên màn hình (danh sách đã virtualize), gộp chung vào lần gọi kiểm tra quyền lười sẵn có (`CheckBucketAccess`) để không thêm lượt IPC.
  - [ ] Backend gọi song song có giới hạn (`errgroup` + `SetLimit`), cache kết quả theo bucket (TTL 5 phút, giống `AccessCache`); cuộn lại không gọi lại.
  - [ ] AWS thật: đọc policy theo region của bucket (giống sprint-13 Q33), không lỗi 301 với bucket khác region profile.
  - [ ] Khi đang load: hiện placeholder/skeleton, không nhảy layout dòng (`LIST_ROW_HEIGHT` giữ nguyên).
  - [ ] Không đọc được (403, không hỗ trợ, lỗi mạng): hiện `-` hoặc ẩn badge, không hiện toast lỗi, không làm hỏng dòng.
  - [ ] Kết nối anonymous: không đọc policy (ẩn badge).
  - [ ] Sau khi tạo bucket kèm quyền, lưu policy trong `BucketPolicyModal` hoặc xoá bucket: xoá cache của bucket đó để badge hiện đúng ngay.
  - [ ] Kết quả tìm kiếm bucket (`SearchBucket`) cũng có badge theo cùng cơ chế.

## Ngoài phạm vi
- Trạng thái Block Public Access trên badge (xem trong drawer "Chi tiết").
- Lọc hoặc sắp xếp danh sách theo policy type.
- Sửa policy ngay từ badge (vẫn qua "Access permission").

## Ràng buộc / ghi chú
- Danh sách bucket có thể lớn (đã virtualize); số request thêm tỉ lệ với số dòng hiện trên màn hình, không phải tổng số bucket.
- Mỗi bucket chưa có trong cache tốn khoảng 1 `GetBucketPolicy` (AWS khác region cần thêm 1 lần lấy region).
- `BucketItem` đã `memo`: chỉ dòng có kết quả mới render lại.
- Badge variant light truyền màu gốc `var(--mantine-color-<c>-6)` (CLAUDE.md mục 8).

## Câu hỏi đã biết
- Màu và icon cho từng chế độ (ví dụ private xám, public cam/đỏ, custom xanh)? Có tooltip giải thích không?
- Không đọc được policy thì hiện `-` hay ẩn hẳn badge?
- Có cần một tuỳ chọn trong Settings để tắt badge (tránh request thêm với account bị tính phí theo request) không?
- MinIO: có đọc policy được qua `AccountInfo`/admin API rẻ hơn gọi từng bucket không, hay vẫn `GetBucketPolicy` từng bucket?
- Cache policy dùng chung `AccessCache` (thêm kind mới) hay cache riêng?
