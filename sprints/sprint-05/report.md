# Sprint 05: Tìm kiếm object và bucket — Báo cáo

Sprint được tách làm 2 phần theo yêu cầu: **05a** (tìm object) và **05b** (tìm bucket). Cả hai đã triển khai xong, qua verify và review.

## Quyết định đã chốt

| # | Quyết định |
|---|---|
| Q1 | 100 kết quả khớp mỗi lần, quét tối đa 20 trang × 1000 key |
| Q2 | Chỉ tìm trong folder hiện tại |
| Q3 | Chứa chuỗi, không phân biệt hoa thường |
| Q4 | So khớp trên Key đầy đủ, áp dụng cả folder |
| Q5 | API riêng `SearchBucket`, lọc trong Go |
| Q6 | Ô search đặt ngay sau nút Refresh |
| Q7 | Chỉ tìm khi bấm nút hoặc Enter; bấm lại cùng từ khoá thì tìm lại từ đầu |
| Q8 | Có phân trang qua `nextCursor`; scroll tới cuối tự tải tiếp (kể cả khi list chưa đầy viewport); nút "Tìm tiếp" khi list rỗng còn cursor hoặc trang kế lỗi |
| Q9 | Sau xoá / Refresh thì tìm lại với từ khoá hiện tại |
| Q10 | Đổi profile / bucket / folder / view thì reset từ khoá |

## Thay đổi

Tổng: **30 file, +1687 / −44 dòng** (không tính bindings sinh tự động, không tính `ObjectDetailDrawer` là thay đổi cũ chưa commit).

### Backend (Go)
- File mới:
  - `internal/modules/bucket/submodule_search_mng.go`: `searchObject` (cursor = key cho `StartAfter`, folder đổi "/" cuối thành "0"), `searchBucket` (cursor = base64 JSON `{token, skip}`), merge tuyến tính CommonPrefixes + Contents, so khớp không phân biệt hoa thường không cấp phát với key ASCII, cursor luôn tiến.
  - `models/bucket/search_object_input.go`, `search_object_output.go`, `search_bucket_input.go`, `search_bucket_output.go`
- File sửa: `internal/modules/bucket/module.go` (API `SearchObject`, `SearchBucket`, mã `S3E026`, `S3E027`, `S3E028`), `internal/handlers/bucket_handler.go`, `models/alias.go`
- Bindings đã sinh lại (`SearchObject`, `SearchBucket` và 4 model).

### Frontend
- File mới: `components/inputs/SearchInput.tsx`
- File sửa: `components/layouts/tab/components/TabDetail.tsx`, `pages/object/ObjectListView.tsx`, `pages/bucket/BucketListView.tsx`
- i18n en/vi/ja: `components/tabLayout.json`, `pages/object/page.json`, `pages/bucket/page.json`, `messages/ipcMessage.json`

### Test
- File mới: `test/components/inputs/SearchInput.test.tsx`
- File sửa: `TabDetail.test.tsx`, `ObjectListView.test.tsx`, `BucketListView.test.tsx`

## Kiểm tra

| Kiểm tra | Kết quả |
|---|---|
| go build / go vet / golangci-lint | PASS |
| tsc --noEmit / oxlint / biome | PASS |
| vitest | PASS (45 file, 454 test) |

| File | Branches (C1) | Lines |
|---|---|---|
| SearchInput.tsx | 100% | 100% |
| TabDetail.tsx | 96.59% | 100% |
| BucketListView.tsx | 97.33% | 100% |
| ObjectListView.tsx | 96.37% | 98.95% |

Nhánh không test được: callback `getScrollElement` / `estimateSize` của virtualizer (jsdom không có layout), một số nhánh phòng thủ không tới được từ UI trong `TabDetail` và `BucketListView`.

## Lỗi phát hiện và đã sửa trong sprint
- Từ khoá không reset khi rời objectList rồi mở lại đúng bucket đó.
- Xoá tìm kiếm không bỏ chọn file (có thể xoá nhầm file không còn hiển thị).
- Cursor không tiến khi trang chỉ có key bị lọc bỏ (nguy cơ lặp vô hạn).
- Đổi từ khoá / folder / bucket khi còn cursor cũ thì auto-load gửi cursor sai nguồn, huỷ request trang đầu, loader quay mãi.

## Chưa làm được / cần người dùng kiểm tra tay
- Backend Go không có unit test, logic cursor chỉ được kiểm tra bằng đọc code. Cần thử tay trên **cả AWS và MinIO**:
  - Object: dừng giữa trang, dừng đúng ở một folder, bucket lớn quét hết 20 trang chưa đủ 100 kết quả.
  - Bucket: hơn 100 bucket khớp, kiểm tra tải tiếp không trùng / sót; MinIO trả toàn bộ danh sách không kèm token.
- Bucket rất lớn với kết quả khớp thưa sẽ tự quét liên tục khi list chưa đầy viewport (theo quyết định của người dùng).
- `ObjectListView` và `BucketListView` có logic phân trang/tìm kiếm tương tự nhau, chưa tách hook dùng chung.
