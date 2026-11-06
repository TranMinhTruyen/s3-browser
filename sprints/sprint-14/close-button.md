# Sprint 14: Đồng bộ UI nút đóng (X)

## Mục tiêu
Mọi nút đóng (X) trong app trông và phản hồi giống nút đóng cửa sổ trên header.

## Yêu cầu

### R3: Nút đóng thống nhất theo nút close trên header
- **Mô tả:** Nút X trên modal, drawer chi tiết và panel upload/download dùng cùng kiểu với nút close của `WindowControls`: `ActionIcon` variant light màu đỏ qua `tintedColor('red', 'ai')`, icon `X` của lucide, hover nền `var(--mantine-color-red-6)` chữ trắng (`WindowControls.module.css`). Nút trên modal/drawer/panel có thể nhỏ hơn nút header một chút.
- **Nền tảng:** Không phụ thuộc S3/MinIO (UI)
- **Màn hình liên quan:**
  - 12 modal đang dùng `Modal.CloseButton size="md"`: `BucketPolicyModal`, `CreateBucketModal`, `DeleteBucketModal`, `ConfirmModal`, `ConnectModal`, `MfaCodeModal`, `DeleteConfirmModal`, `DeleteResultModal`, `HistoryModal`, `SettingModal`, `UploadLimitModal`, `UploadPickerModal`.
  - Drawer: `BucketDetailDrawer`, `ObjectDetailDrawer` (đang là `ActionIcon` xám).
  - `TransferPanel` (cửa sổ Uploader/Downloader, đang là `CloseButton` Mantine).
- **Tiêu chí chấp nhận:**
  - [ ] Một component dùng chung (đề xuất `components/buttons/CloseButton`, bọc wrapper `ActionIcon`), nút header trong `WindowControls` dùng lại cùng style, không lặp CSS.
  - [ ] Giữ hành vi hiện có: tooltip/`aria-label` đã dịch, `disabled` (`SettingModal` khi đang lưu), ẩn khi đang xoá (`DeleteBucketModal`), modal vẫn đóng đúng như `Modal.CloseButton`.
  - [ ] Đúng cả light và dark theme, không hard-code màu.
  - [ ] Không nhảy layout header của modal/drawer/panel.

## Ngoài phạm vi
- Nút X đóng tab (`SortableTab`, `TabDragPreview`).
- Nút xoá chữ trong ô search/combobox (`SearchInput`, `ComboboxClearButton`).

## Ràng buộc / ghi chú
- Người dùng chốt: làm sau R1, trước R2, gộp vào branch `SP-14/bucket_policy_badge` với commit riêng.
