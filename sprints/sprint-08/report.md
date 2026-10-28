# Báo cáo Sprint 08: Setting của app (R1)

**Trạng thái: HOÀN TẤT (2026-10-28).** R2 (kéo thả tab) và R3 (ghi nhớ tab) đã chuyển sang `sprints/sprint-09/requirement.md` theo quyết định của người dùng (phân tích sẵn ở `plan.md` mục 8).

## Kết quả

- Modal **Setting** (nút bánh răng bên trái nút Download history): theme (`light` / `dark` / `auto`), font (Nunito, System UI, Segoe UI, Arial, Monospace, JetBrains Mono), ngôn ngữ (en / vi / ja), khởi động cùng Windows.
- Setting lưu ở `settings.json` cạnh `data.db`, ghi atomic. `main.tsx` nạp setting trước khi render; lỗi thì dùng mặc định.
- Thay đổi được preview ngay. Các nút:
  - **Save** ghi file.
  - **Apply** giữ đến khi tắt app và không đổi autostart; modal vẫn mở.
  - **Cancel/X** quay về giá trị Apply/Save gần nhất.
  - **Reset to default** đưa form về mặc định, chưa ghi.
- Autostart ghi registry `HKCU\...\Run`, chỉ ở bản Windows thường. Bản portable và OS khác thì ẩn option. Lưu sẽ ghi file trước rồi mới ghi registry; registry lỗi thì cảnh báo `STE003` và file giữ giá trị cũ.
- Dark theme: rà toàn bộ màu hard-code, đổi sang `var(--mantine-color-*)` / `light-dark()`. Màu nền cửa sổ native theo theme.
- Bỏ `SegmentedControl` EN/VI/JA trên header. Ngôn ngữ giờ được ghi nhớ, nên đã giải quyết lỗi "Ngôn ngữ không được lưu" còn tồn từ sprint-07.

### Thay đổi theo phản hồi của người dùng (sau review)

| Việc | File |
|---|---|
| Thêm nút **Apply** (state `applied` trong `settingStore`) | `settingStore.ts`, `SettingModal.tsx`, locale `settingModal.json` x3 |
| Trạng thái kết nối profile dùng màu light: xanh nhạt / đỏ nhạt (trước là xanh đậm / nền trống) | `ConnectionProfiles.tsx` |
| Thân modal Setting có viền (`Paper withBorder`) giống modal upload; modal rộng `560px` | `SettingModal.tsx` |
| Footer không xuống dòng khi đổi ngôn ngữ/font (`wrap="nowrap"`) | `SettingModal.tsx` |
| Quy tắc footer modal: **Hủy bên trái**, nút thao tác bên phải | `SettingModal`, `ConfirmModal`, `UploadPickerModal`, `UploadLimitModal`, `HistoryModal` (`ConnectModal` không có nút Hủy) |

## Quy trình

| Vòng | Nội dung | Kết quả |
|---|---|---|
| 1 | Go (B1–B5) → bindings → FE (F0–F5, F9) → test → verify → review | Review **ĐẠT**, không có must-fix |
| 2 | Sửa should-fix: quoting giá trị registry (`%q` nhân đôi `\`), thứ tự ghi file/registry và luôn gọi `setAutostart`, wrapper `SelectInput`/`SwitchInput`, `onClickReset` | Verify PASS |

## Kiểm tra cuối

| Kiểm tra | Kết quả |
|---|---|
| `go build` / `go vet` / `golangci-lint` | PASS, 0 issues |
| Bindings | Sinh mới `settinghandler.ts`, `models/setting`; `tsc --noEmit` PASS |
| biome / oxlint / tsc | PASS |
| vitest | PASS, 64 file, 740 test (sprint-07: 683) |
| Coverage per-file (C1 / Lines) | 100% / 100% cho `settingStore`, `settingUtils`, `SettingModal`, `SelectInput`, `SwitchInput`, `lazyModals`, `modalColors`, `connectSchema`, `MainLayout`, `ConnectionProfiles`. Các modal chỉ đổi vị trí nút: `HistoryModal` 97.43%, `UploadPickerModal` 96.96% (nhánh cũ), các modal khác 100% |
| `vite build` | PASS (top-level await trong `main.tsx` hợp lệ) |
| Chạy app thật / smoke test | **Chưa làm, chờ người dùng** |

## Thống kê (so với HEAD, không tính `frontend/bindings`, `sprints/`)

| Nhóm | File | Dòng thêm | Dòng xoá |
|---|---|---|---|
| Go | 13 | +415 | −2 |
| Frontend production | 26 | +601 | −63 |
| Frontend test | 11 | +596 | −24 |
| Locale | 9 | +90 | 0 |
| Docs (README, CHANGELOG, ARCHITECTURE, user guide) | 12 | +162 | −24 |

### File mới
- Go: `internal/handlers/setting_handler.go`, `internal/modules/setting/{module.go, submodule_file_mng.go, submodule_setting_mng.go, autostart_windows.go, autostart_other.go}`, `models/setting/{setting_input.go, setting_output.go}`.
- Frontend: `common/cnst/settingConst.ts`, `common/stores/settingStore.ts`, `common/utils/settingUtils.ts`, `components/modals/SettingModal.tsx`, `components/inputs/{SelectInput,SwitchInput}.tsx`, `locales/{en,vi,ja}/components/modals/settingModal.json`, `assets/fonts/JetBrainsMono-{Regular,Medium,SemiBold,Bold}.woff2`, `assets/fonts/OFL-JetBrainsMono.txt`.
- Test: `settingStore.test.ts`, `settingUtils.test.ts`, `SettingModal.test.tsx`, `SettingModalClear.test.tsx`, `SelectInput.test.tsx`, `SwitchInput.test.tsx`.
- Message code: `STE001`–`STE004` (module `setting`).

## Tài liệu đã cập nhật

- `README{,.vi,.ja}.md`: thêm tính năng Setting và module `setting`.
- `CHANGELOG{,.vi,.ja}.md`: thêm mục `[Unreleased]`.
- `docs/ARCHITECTURE{,.vi,.ja}.md`: thêm module `setting` vào cây thư mục, mục 2.7 (setting backend) và 3.8 (setting/theme FE, quy ước màu), quy ước footer modal ở 3.3, thêm `settingStore` và `showSettingModal`.
- `docs/user-guide/{en,vi,ja}/user-guide.md`: mục 9 đổi thành "Cài đặt", mô tả header cập nhật.

## Chưa làm / cần người dùng

| Mục | Ghi chú |
|---|---|
| R2 kéo thả tab, R3 ghi nhớ tab | Chuyển sang sprint-09; đã duyệt cài `@dnd-kit/core`, `sortable`, `utilities`, `modifiers` |
| Chạy app, xem cả light/dark | Màu hover và một số màu nhấn đổi sang biến Mantine, có thể lệch nhẹ so với trước |
| Theme `auto` trên OS dark | Nền cửa sổ native vẫn trắng lúc mở, có thể nháy trắng |
| Ảnh chụp và PDF user guide | Chưa chụp lại. Ảnh `02-language-switch.png` không còn được dùng trong user guide nhưng `docs/scripts/shots.mjs` vẫn chụp nó; cần thêm ảnh modal Setting, chụp lại ảnh có header/profile/modal (đổi vị trí nút, màu trạng thái), rồi `bun run --cwd docs build:pdf` |
| Trong lúc Save, nút Hủy/Reset/Apply vẫn bấm được | Chỉ nút Save bị khoá (`useAutoLoading`) |
| `go mod tidy` | `golang.org/x/sys` đã bỏ `// indirect` nhưng còn nằm trong khối indirect; `go.sum` bị chặn ghi |
| `JetBrainsMono-2.304.zip` ở gốc `App/S3Browser` | Xoá hoặc không đưa vào commit |
| Git index | Agent đã lỡ chạy `git add -N .`: các file mới đang ở trạng thái intent-to-add (gồm cả file zip). Bỏ bằng `git restore --staged <file>` |

## Cần cập nhật `CLAUDE.md` (agent không tự sửa)

Mục 6, Component, thêm:
- Màu: dùng `var(--mantine-color-*)` và `light-dark(<light>, <dark>)`, không hard-code hex/rgb (trừ màu lưu như dữ liệu).
- Modal: Hủy bên trái, nút thao tác bên phải (`<Group p="8px" justify="space-between" wrap="nowrap">`); nội dung chính bọc `<Paper withBorder>`.
