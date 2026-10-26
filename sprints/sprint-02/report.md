# Báo cáo sprint-02

Ngày 2026-10-26. Kết quả: **R1 và R2 hoàn thành.** Mỗi phần qua verify và review, kết luận ĐẠT, trong một vòng duy nhất.

## Số liệu

Số liệu không tính `frontend/package.json`, `go.mod`, `go.sum` (đã thay đổi từ trước sprint) và `frontend/bindings/**` (sinh tự động, bị gitignore).

| | File | Dòng |
|---|---|---|
| Sửa | 23 | +1092 / −373 |
| Tạo mới | 4 | +596 |

### File tạo mới
- `models/bucket/delete_prefix_input.go`
- `models/bucket/delete_prefix_output.go`
- `internal/modules/bucket/submodule_object_prefix.go`
- `internal/modules/bucket/submodule_object_prefix_test.go`

### File sửa
- **Go:**
  - `models/alias.go`
  - `models/bucket/files_dropped_output.go`
  - `internal/handlers/bucket_handler.go`
  - `internal/modules/bucket/` gồm `module.go`, `submodule_object_mng.go`, `submodule_uploader_mng.go`, `uploader_expand.go`
  - Test: `helpers_test.go`, `submodule_uploader_mng_test.go`, `uploader_expand_test.go`
- **Frontend:**
  - `components/modals/UploadLimitModal.tsx`
  - `components/layouts/uploader/UploaderWindow.tsx`
  - `pages/object/components/ObjectItem.tsx`
  - `pages/object/components/views/ObjectListView.tsx`
- **Locale (en/vi/ja):** `confirmModal.json`, `uploadLimitModal.json`, `ipcMessage.json`

## R1: xoá folder (prefix)
- Folder có nút `...`, menu chỉ có mục Delete.
- Xác nhận một lần bằng `C000006`.
- Backend `DeletePrefix`:
  - Chặn prefix rỗng hoặc `/`.
  - Liệt kê object theo trang, mỗi trang xoá bằng `DeleteObjects` với tối đa 1000 key.
  - Nếu provider không hỗ trợ `DeleteObjects` thì chuyển sang xoá từng key.
  - Timeout 30 phút.
  - Chỉ xoá bản hiện tại.
  - Trả một message tổng: `S3S007`, `S3E020` hoặc `S3E021`.
- Sửa lỗi xoá object thường phải xác nhận 2 lần. Chặn bấm xoá folder lặp.

## R2: upload folder đệ quy
- Nhóm file theo từng thư mục trực tiếp chứa file, ở mọi độ sâu. Thư mục rỗng bị bỏ qua.
- Giới hạn:
  - 50 file mỗi nhóm.
  - Tối đa 4 file > 10 GiB mỗi nhóm.
  - 1000 file mỗi lần thả.
- Bỏ quy tắc cũ (5 file tổng, chỉ upload file lớn nhất).
- Khi có vi phạm, hiện `UploadLimitModal`:
  - `Accordion` gồm 2 mục, mỗi file một checkbox.
  - Mặc định tick sẵn phần hợp lệ.
  - Nút Upload bị khoá nếu lựa chọn còn vi phạm.
  - Danh sách được virtualize.
- Backend kiểm tra lại giới hạn dựa trên size đọc từ đĩa và trả `S3E018`, `S3E022` hoặc `S3E023` khi vi phạm.
- Mỗi nhóm có một goroutine điều phối, tất cả dùng chung semaphore 5 file đồng thời.
- `UploaderWindow` được virtualize.

## Kiểm tra
- **Go:** `go vet`, `go build`, `go test -count=1 ./internal/...`, `golangci-lint` (0 issues) đều đạt.
- **Frontend:** `tsc --noEmit`, oxlint, biome đều sạch.
- **i18n:** en/vi/ja có cùng tập key.

## Chưa làm / chưa xác minh
- Chưa chạy app, chưa thử bằng tay modal và virtualizer.
- Chưa chạy thật với S3/MinIO: `DeleteObjects` và fallback, upload theo nhóm.
- Chưa chạy `go test -race` vì máy không bật cgo.
- Low chưa sửa (không chặn):
  - `UploaderWindow` thiếu `scrollMargin` (lệch khoảng 8px).
  - Nhãn "10.00 GB" trong modal nên là GiB.
  - `memo(FileList)` ít tác dụng.
- Mã `S3E018` và `S3W007` được dùng lại với nghĩa mới thay vì cấp mã mới.
- Xoá prefix trên bucket có versioning chỉ tạo delete marker. Xoá mọi version để sprint sau.
