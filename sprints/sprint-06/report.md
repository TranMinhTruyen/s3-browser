# Báo cáo Sprint 06: Modal chọn file để upload

**Trạng thái: DONE (2026-10-28).** Người dùng đã chạy app, kiểm thủ công và xác nhận ổn.

## Kết quả

- Hoàn thành R1 sau 2 vòng B4. Review vòng 2: **ĐẠT**. Verify vòng 2: **PASS** toàn bộ.
- Quyết định của người dùng:
  - Q1: hộp thoại chỉ chọn file.
  - Q2: khi vượt giới hạn, tự tick đến giới hạn kèm toast; nếu người dùng tick tay vượt thì khoá Upload.
  - Q4: `BucketPicker` đầy đủ, có tìm kiếm debounce và nút tải thêm.
  - Q3, Q5, Q6: theo đề xuất trong plan.

## Thống kê thay đổi (không tính `CLAUDE.md`, `.claude/**`, `sprints/sprint-07/`)

- 30 file: +2388 / −40 dòng. Trong đó code Go/FE và locale +890 / −37, test +1366 / −3, tài liệu sprint +132.

### File sửa

- Go:
  - `internal/handlers/bucket_handler.go`: thêm `PickFiles`.
  - `internal/modules/bucket/module.go`: thêm `S3E029` và `Module.PickFiles`.
  - `internal/modules/bucket/events.go`: thêm `uploader:picker-files-dropped`.
  - `internal/modules/bucket/submodule_uploader_mng.go`:
    - thêm `pickFiles` và `buildFilesDropped`;
    - `handleDrop` đọc `data-drop-kind`;
    - dialog dùng `AttachToWindow(app.Window.Current())`;
    - sort ổn định.
- Frontend:
  - `frontend/src/components/layouts/tab/components/TabDetail.tsx`: button upload cạnh search, refresh có điều kiện.
  - `frontend/src/pages/object/ObjectListView.tsx`: `onFilesDropped` dùng `ensureUploadIdle` và `runUpload`.
  - `frontend/src/components/layouts/uploader/UploaderItem.tsx`: trạng thái "Đang hoàn tất…".
  - `frontend/src/locales/{en,vi,ja}/resource.ts`, `components/tabLayout.json`, `components/uploaderWindow.json`, `messages/ipcMessage.json`.
- Test:
  - `frontend/src/test/components/layouts/tab/components/TabDetail.test.tsx`
  - `frontend/src/test/components/layouts/uploader/UploaderItem.test.tsx`
- Bindings sinh lại (không track): `buckethandler.ts`, `events/index.ts`, `eventcreate.ts`, `eventdata.d.ts`.

### File mới

- `frontend/src/common/utils/uploadUtils.ts`: `ensureUploadIdle`, `runUpload`, `mergePickedFiles`, `removePickedFiles`.
- `frontend/src/components/inputs/combobox/BucketPicker.tsx`.
- `frontend/src/components/modals/UploadPickerModal.tsx`, `UploadPickerModal.module.css`.
- `frontend/src/locales/{en,vi,ja}/components/bucketPicker.json`, `components/modals/uploadPickerModal.json`.
- Test:
  - `frontend/src/test/common/utils/uploadUtils.test.ts`
  - `frontend/src/test/components/inputs/combobox/BucketPicker.test.tsx`
  - `frontend/src/test/components/modals/UploadPickerModal.test.tsx`
- `sprints/sprint-06/plan.md`, `report.md`.

## Kiểm tra

| Kiểm tra | Kết quả |
|---|---|
| go build / go vet / golangci-lint | PASS (0 issues) |
| Bindings + tsc --noEmit | PASS (bindings mới hơn mọi file Go) |
| biome / oxlint | PASS |
| vitest | PASS 580/580; có lần `ConnectModal.test.tsx`, `UploadLimitModal.test.tsx` timeout flaky do tải máy, chạy lại pass |
| Kiểm thủ công trong app (Windows) | PASS, người dùng xác nhận |
| LF, i18n en/vi/ja | PASS |

| File | Branches (C1) | Lines |
|---|---|---|
| `uploadUtils.ts` | 100% | 100% |
| `BucketPicker.tsx` | 100% | 100% |
| `UploadPickerModal.tsx` | 97.22% | 100% |
| `TabDetail.tsx` | 97.19% | 100% |
| `ObjectListView.tsx` | 96.32% | 98.88% |
| `UploaderItem.tsx` | 100% | 100% |

## Diễn biến review

- **Vòng 1: CHƯA ĐẠT.**
  - A1: race do closure cũ khi hộp thoại đang mở, dialog chưa gắn cửa sổ, bấm Chọn file 2 lần.
  - B1–B7: gộp file O(n²), memo `GroupRow`, identity `onAddFiles`, `useCallback` trong `BucketPicker`, `isLoading` kẹt, mất toast `skipped`, sort không ổn định.
- **Vòng 2: ĐẠT.** Đã sửa toàn bộ A1 và B1–B7.
- **Chỉnh theo phản hồi người dùng sau khi chạy app: ĐẠT.**
  - Modal bị trong suốt khi kéo file vào: tạo `UploadPickerModal.module.css` riêng, nền giữ opaque (`var(--mantine-color-body)`) và phủ tint bằng `background-image`.
  - Vùng danh sách cao `max(280px, 40vh)` cả khi chưa có file và khi đã có file (khi trống, text căn giữa).
  - Header modal màu `#d0ebff` giống `ConnectModal`.
  - Cửa sổ Uploading (`UploaderItem.tsx`): khi `uploaded >= total` mà chưa có event finished thì hiện trạng thái "Đang hoàn tất…" (vòng 100% + Loader, key `label.finalizingLbl`) thay vì đứng ở 99%. Nguyên nhân: tiến độ đếm byte SDK đã đọc từ file, không phải byte S3 đã nhận. Coverage `UploaderItem.tsx` 100%.
  - Khi kéo file vào: nét đứt và tint chỉ bao vùng danh sách (`.dropArea`), kèm overlay "Thả file vào đây" (key `dropHere` en/vi/ja). Drop target vẫn là cả `Modal.Content`.
  - Mỗi hàng có nút xoá file ở ngoài cùng bên phải; thêm nút "Xoá đã chọn (n)" cạnh "Chọn file" để xoá các file đang tick (hàm thuần `removePickedFiles` trong `uploadUtils.ts`).
  - i18n thêm key `remove`, `removeSelected` cho en/vi/ja.

## Phần chưa làm / còn lại

- Người dùng đã kiểm thủ công trên Windows và xác nhận ổn: hộp thoại chọn nhiều file, kéo thả vào modal và vào danh sách object, kéo thả folder, cửa sổ Uploading.
- Khi hộp thoại chọn file đang mở, app không phản hồi thao tác (hộp thoại đã gắn vào cửa sổ chính bằng `AttachToWindow`). Vì vậy kịch bản "đóng modal khi hộp thoại đang mở rồi toast hiện sau khi modal đã đóng" (`UploadPickerModal.tsx` ~dòng 293-302) không xảy ra, không cần sửa.
- Gợi ý low cho sprint sau: `removePickedFiles` giữ nguyên `overMaxFiles`/`overLargeCount` cũ của nhóm (hiện không chỗ nào đọc nên không gây lỗi; modal tự tính vi phạm từ `stats` và `limits`).
- Giới hạn theo thiết kế: file chọn qua hộp thoại đều vào nhóm gốc, nên tối đa `maxFilesPerFolder` (50) file mỗi lần. Muốn nhiều hơn thì kéo thả folder.
- Nhánh chưa phủ (đều trong ngưỡng):
  - `UploadPickerModal.tsx`: guard `!targetBucket` không chạm được qua UI.
  - `TabDetail.tsx` 80/182/240 và `ObjectListView.tsx` 392-393: code cũ.
