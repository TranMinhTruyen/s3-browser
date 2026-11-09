## Kết quả sprint-16
- Trạng thái: **DONE** (2026-11-09, người dùng báo sau khi test). R4, R1+R2, R3 đã nằm trên `SP-16/release` (đỉnh `925ee61`); PR docs (`SP-16/sprint_docs`) và PR `SP-16/release` → `staging` tạo khi đóng sprint, người dùng tự merge (docs trước, rồi promote).
- Tổng thay đổi so với `origin/staging` (4 commit trên release): 392 file, +3207 / -119 dòng. Trong đó code và test (không tính docs/README/CHANGELOG): 89 file, +2712 / -86; docs (user guide 7 ngôn ngữ, ảnh, 7 PDF, README, CHANGELOG, `shots.mjs`): 289 file, +481 / -33 (ảnh PNG và PDF là nhị phân).
- Không có task Rust native trong sprint này.

### Branch / commit
| Branch / PR | Yêu cầu | Commit trên release | File | Dòng |
|---|---|---|---|---|
| `SP-16/setting_update_live` (#17) | R4 | `25d19b0` | 21 | +638 / -30 |
| `SP-16/profile_export_import` (#18, 7 commit gộp một lần) | R1 + R2 (+ các việc ngoài plan, xem dưới) | `4763377` | 70 | +2059 / -45 |
| commit thẳng lên `SP-16/release` (người dùng làm, không qua PR) | ngoài plan: khoảng cách trên/dưới danh sách profile | `a372dbe` | 2 | +15 / -11 |
| `SP-16/user_guide_profile_transfer` (#19) | R3 | `925ee61` | 303 | +495 / -33 |

Các commit nhỏ trong #18 trước khi gộp: `92da194` (export), `11f7b9c` (import), `a6e2ee7` (tên file gợi ý snake_case ASCII), `54e1f95` (chuyển bảng tên file sang `cnst`, tránh tên dành riêng của Windows), `80975af` (xác nhận C000011), `b35895c` (AAD gồm provider/endpoint/authType), `475e7d2` (gộp toast `PFW001`). Commit `3c2246e` là commit R4 trong #17. Commit của PR #19 trước khi gộp: `bc95235`, `26235f7`.

### File sửa đổi (code, không tính docs)
| File | Ghi chú |
|---|---|
| `internal/modules/profile/module.go` | `ExportProfile`, `ChooseImportFile`, `ImportProfile`, `createProfile(input, allowMissingCertKey)` tách từ `CreateProfile`; mã `PFE010`–`PFE015`, `PFS004`, `PFW001`; import có trường bị xoá chỉ trả `PFW001` |
| `internal/modules/profile/submodule_auth_mng.go` | `prepare`/`validateAuthConfig` thêm tham số `allowMissingCertKey` (Q6) |
| `internal/handlers/profile_handler.go`, `internal/handlers/update_handler.go` | thêm handler export/import và `SetUpdateOptions` |
| `internal/modules/update/module.go` | `SetOptions(beta, autoUpdate)`, không ghi `settings.json` |
| `models/alias.go` | re-export 3 model mới |
| `frontend/src/common/stores/settingStore.ts`, `settingUtils.ts`, `useAppUpdate.tsx` | công tắc cập nhật có hiệu lực ngay (`syncUpdater`), `apply` giữ hai công tắc, `isSettingDirty`, `isUpdateOptionsChanged` |
| `SettingModal.tsx`, `lazyModals.ts` | đóng modal khi còn thay đổi chưa lưu thì hiện cảnh báo; `showExportProfileModal`, `showUnsavedSettingModal` |
| `ConnectionProfiles.tsx`, `HeaderButtonGroup.tsx` | mục Export trong menu profile, nút Import cạnh nút tạo; khoảng cách danh sách profile (`a372dbe`) |
| Locales ×7 | `confirmModal.json` (`C000011`), `connectionProfiles.json`, `ipcMessage.json`, `validateMessage.json` (`V000011`, `V000012`), `settingModal.json` (`unsaved.*`), `resource.ts` |
| Test (11 file) | `useAppUpdate`, `settingStore`, `settingUtils`, `ConnectionProfiles`, `HeaderButtonGroup`, `lazyModals`, `SettingModal` và 4 file test của modal mới |
| README ×7, CHANGELOG ×7, `docs/user-guide/<7>/user-guide.md` (mục 4.1, 4.2, 10.1), `docs/scripts/shots.mjs`, `annotations.json`, 7 PDF | R3 và bổ sung theo yêu cầu người dùng |

### File thêm mới
| File | Số dòng |
|---|---|
| `internal/modules/profile/submodule_file_mng.go` | 397 |
| `internal/modules/profile/profile_file.go` | 76 |
| `internal/pkg/utils/password_cipher.go` | 96 |
| `internal/pkg/cnst/file_name.go` | 37 |
| `models/profile/{export_profile_input,import_profile_input,import_file_output}.go` | 9 / 8 / 9 |
| `frontend/src/components/modals/profile/ExportProfileModal.tsx` | 164 |
| `frontend/src/components/modals/profile/ImportPasswordModal.tsx` | 138 |
| `frontend/src/components/modals/setting/UnsavedSettingModal.tsx` | 76 |
| Locale `exportProfileModal.json` (15), `importPasswordModal.json` (10) ×7 | |
| Test: `ExportProfileModal` (259), `ImportPasswordModal` (188), `UnsavedSettingModal` (66) | |
| `docs/user-guide/<7>/images/37-profile-export-menu.png`, `38-profile-export-modal.png`, `39-profile-import-button.png`, `40-profile-import-password.png` | 28 PNG |

### Đối chiếu yêu cầu
| Yêu cầu | Trạng thái | Ghi chú |
|---|---|---|
| R1 Export profile | Đã làm | Menu profile → Export; modal với tuỳ chọn kèm secret (tắt khi profile không lưu secret), mật khẩu ≥ 8 ký tự nhập hai lần; file `{"format":"s3browser-profile","version":1,"profile":{...},"secret":{...}}` không có id/ngày; hộp thoại lưu native, huỷ thì giữ modal mở (Q8), ghi file quyền 0o600 |
| R2 Import profile | Đã làm | Nút Import ở header; file ≤ 1 MB; hỏi mật khẩu khi có secret (sai thì nhập lại); validate như tạo profile; id mới, mã hoá lại bằng `KeyManager`; tên trùng thêm ` (2)`… (Q7); đường dẫn không tồn tại hoặc là đường dẫn mạng/thiết bị bị xoá trống và vẫn nhập kèm cảnh báo `PFW001` (Q6=A); không tự kết nối (Q9) |
| R3 User guide | Đã làm | 7 bản có mục 4.1 và 4.2 mới, 4 ảnh mới (37–40) có ghi chú ở 7 ngôn ngữ, ảnh cũ chụp lại (header có nút Import, menu có Export), mục 10.1 sửa theo R4 (không chụp modal cảnh báo, Q3), 7 PDF sinh lại; README và CHANGELOG 0.1.0 thêm một dòng ở 7 bản |
| R4 Công tắc cập nhật | Đã làm | Gạt công tắc có hiệu lực ngay với updater, không ghi `settings.json`; Apply giữ hai công tắc; đóng modal khi có thay đổi chưa lưu hiện cảnh báo 3 nút (Quay lại / Bỏ thay đổi / Lưu); nút Huỷ revert, không cảnh báo; Reset to default đẩy mặc định xuống updater (Q10); banner cập nhật đọc `applied.autoUpdate` (Q11) |

### Thay đổi ngoài plan đã duyệt (người dùng yêu cầu giữa sprint)
- Tên file gợi ý khi export là snake_case ASCII (chữ thường, bỏ dấu, `đ` thành `d`, ký tự ngoài `[a-z0-9]` thành `_`, nén và cắt `_`, rỗng thì `profile`); bảng chuẩn hoá nằm ở `cnst.ASCIIFolds`, tên dành riêng của Windows nằm ở `cnst.WindowsReservedNames` và được thêm `_` ở cuối (`CON` thành `con_.json`).
- Export không kèm secret mà profile có secret đã lưu thì phải xác nhận (`ConfirmModal`, mã `C000011`); Huỷ giữ modal export mở.
- AAD của AES-GCM gồm hằng định dạng và metadata profile (`provider`, `endpoint`, `authType`, ghép bằng JSON). Sửa một trong ba trường trong file thì import báo `PFE014` như sai mật khẩu; sửa `name`, `color`… vẫn mở được. `version` giữ 1. File export từ bản dev trước đó (AAD cũ) không mở được.
- Import có trường đường dẫn bị xoá trống chỉ trả một message `PFW001`, không kèm `PFS001`.
- Khoảng cách trên/dưới danh sách profile ở navbar đều nhau (`a372dbe`): người dùng commit thẳng lên `SP-16/release`, không qua PR; thay đổi nằm ở `ConnectionProfiles.tsx` (`estimateSize` bằng chiều cao thẻ, `gap` bằng 8) cùng test cũ đã cập nhật theo hành vi mới.
- Bổ sung R3 theo yêu cầu: README và CHANGELOG (7 bản mỗi loại) nhắc export/import; sửa 7 điểm low của reviewer trong user guide (nhãn khớp locale, đường dẫn mạng/thiết bị, mục Export trong danh sách menu, mô tả Reset to default, ảnh 39 có tooltip và mũi tên không đè tên profile).

### Câu hỏi đã chốt
- Q1: R1+R2 chung branch `SP-16/profile_export_import`, mỗi yêu cầu một commit. Q2: R3 làm cuối sau khi người dùng merge #17 và #18. Q3: sửa chữ mục 10.1 ở 7 ngôn ngữ, không chụp ảnh mới cho modal cảnh báo.
- Q4: stdlib `crypto/pbkdf2` SHA-256 600.000 vòng, salt 16 byte, AES-256-GCM nonce 12 byte, không đổi `go.mod`. Q5: mật khẩu tối thiểu 8 ký tự.
- Q6=A: cert/key bị xoá trống thì vẫn nhập, cảnh báo `PFW001`. Q7–Q11: theo đề xuất trong plan (tên trùng, huỷ hộp thoại, không tự kết nối, Reset đẩy mặc định, banner đọc `applied`).
- Hai câu mở lúc đầu đã chốt: AAD có metadata; gộp toast thành một `PFW001`.

### Kết quả kiểm tra
- go build / go vet / golangci-lint: sạch (0 issues). tsc, biome, oxlint, knip: sạch.
- go test hồi quy tạm (go-tester, `-tags portable`, không `-race` vì không có cgo), đã xoá: PASS; không còn `*_test.go` trong repo. Coverage khi chạy: package `profile` 48,7%, `utils` 15,8% (Go không có ngưỡng).
- vitest toàn bộ (lần cuối): 127 file, 2373 test pass, console sạch. Coverage C1 và Lines ≥ 95% cho mọi file đã đổi, thấp nhất `ConnectionProfiles.tsx` 97,43% (lúc ở #18); `ExportProfileModal.tsx` 100%.
- Docs: biome sạch với `shots.mjs`; `annotations.json` đủ 7 ngôn ngữ; 7 user guide cùng tập heading, link ảnh không hỏng; 7 PDF sinh lại sau lần sửa cuối.
- Review: R4 vòng 1 (chỉ mức low); R1+R2 đạt ở vòng 3 (vòng 1–2 có finding medium về đường dẫn UNC/NT bị `Stat`, đã sửa bằng allowlist `isUnsafePath`); các việc ngoài plan và R3 đạt không còn mức medium.

### Phần chưa test tay / chưa xác minh
- Hộp thoại lưu file native trên Windows: hành vi ghi đè file có sẵn chưa kiểm tay; chưa xác minh `AddFilter`/`AttachToWindow` của `SaveFile()` ngoài việc `go build` qua (docs Wails v3 trả 403).
- Tốc độ thực tế của 600.000 vòng PBKDF2 trên máy cấu hình thấp chưa đo.
- Import/export bằng hộp thoại thật chưa chụp ảnh (server mode không điều khiển được hộp thoại native); ảnh 40 dùng file giả qua `page.route`.
- Các mục test tay của sprint-13 vẫn chưa có kết quả (xem memory mục 1).

### Vấn đề còn lại
- Bản dịch vi, ja, zh-CN, zh-TW, ru, de của mục guide mới, README/CHANGELOG và ghi chú ảnh do agent viết, chưa có người bản ngữ duyệt (zh-TW chỗ dùng 密鑰, chỗ dùng 金鑰 theo locale app).
- `ExportProfileModal` chưa chặn đóng modal khi đang gửi (đang submit).
- Race nhỏ giữa `CheckUpdate` và `SetUpdateOptions`.
- `launchOnStartup` vẫn bị tính là chưa lưu sau Apply.
- Thuật ngữ trong câu confirm `C000011` chưa đồng nhất hoàn toàn với `exportProfileModal.json` ở ja (`認証情報`/`シークレット`), zh-TW (`金鑰`/`密鑰`), vi (Profile/hồ sơ).
- `WarningIcon.test.tsx` thỉnh thoảng fail khi chạy cả bộ lúc máy tải, pass khi chạy riêng (flaky có từ trước).
- Commit ngoài sprint trên release: `a372dbe` (đã nêu ở trên); không có commit nào khác ngoài các PR.
