## Kết quả sprint-17
- Trạng thái: **DONE** (2026-11-10, người dùng báo sau khi test). Sáu PR #25–#30 đã merge vào `SP-17/release` (đỉnh `03d1fec`). PR docs (`SP-17/sprint_docs`: report, memory, CHANGELOG 7 bản, version `1.0.1-beta.17`) và PR `SP-17/release` → `staging` tạo khi đóng sprint, người dùng tự merge (docs trước, rồi promote).
- Tổng thay đổi so với `origin/staging` (`81e09ca`, 6 commit trên release): 104 file, +983 / -308 dòng, gồm 35 ảnh PNG và 7 PDF (nhị phân).
- Không có task Rust native trong sprint này. Không có commit nào trên release nằm ngoài 6 PR.

### Branch / commit
| Branch / PR | Yêu cầu | Commit trên release | File | Dòng | Vòng review |
|---|---|---|---|---|---|
| `SP-17/bucket_delete_fixes` (#25) | R1 | `66d32f0` | 10 | +71 / -25 | 1/3 |
| `SP-17/update_race` (#26) | R2 | `4a6268f` | 1 | +34 / -12 | 2/3 |
| `SP-17/settings_export_fixes` (#27) | R3 | `0dce396` | 15 | +388 / -53 | 2/3 |
| `SP-17/bucket_policy_ui` (#28) | R4 + R5e | `e987657` | 15 | +390 / -168 | 1/3 |
| `SP-17/misc_cleanup` (#29) | R5a–c | `48e03dc` | 6 | +48 / -10 | 2/3 |
| `SP-17/size_units` (#30) | R5d | `03d1fec` | 71 | +52 / -40 | 1/3 |

### File sửa đổi (code, không tính test và docs)
| File | Ghi chú |
|---|---|
| `internal/modules/bucket/submodule_bucket_delete.go`, `module.go` | Vòng `ListObjectVersions` dừng khi truncated mà marker nil hoặc lặp (`S3E060`); fallback V2 gặp `BucketNotEmpty` báo `S3E064` |
| `internal/modules/bucket/submodule_object_prefix.go` | `failedIndex` thay `idKey`: lỗi `DeleteObjects` không có `VersionId` khớp đúng một id, không đếm trùng `deleted` |
| `internal/modules/bucket/submodule_bucket_policy.go` | `canonicalPolicy` sắp xếp `Statement` |
| `internal/modules/update/submodule_update_mng.go` | `runCheck` giữ kênh `beta` lúc bắt đầu; kênh đổi thì bỏ kết quả, về `idle`, check lại một lần sau khi nhả lock |
| `internal/modules/setting/module.go`, `internal/handlers/setting_handler.go` | `SetLaunchOnStartup` cho Apply |
| `internal/modules/profile/module.go`, `submodule_file_mng.go`, `internal/pkg/logger/logger.go` | Comment và chuỗi lỗi đổi "1 MB" thành "1 MiB" |
| `settingStore.ts`, `SettingModal.tsx` | `apply` async ghi `launchOnStartup`; modal khoá khi Apply đang chạy |
| `ExportProfileModal.tsx` | Ẩn X, khoá Huỷ, bỏ qua Esc/click ngoài khi đang submit |
| `tabListStore.ts`, `BucketDetailDrawer.tsx`, `TabDetail.tsx`, `BucketPolicyModal.tsx` | Drawer cập nhật policy sau khi lưu (`setBucketDetailPolicyMode`); `cancelValue: false` |
| `BucketListView.tsx`, `BucketItem.tsx` | `labels` dịch sẵn bằng `useMemo`, bỏ `useTranslation` mỗi dòng |
| `connectSchema.ts` | `isSecureIssuerUrl` khớp `utils.IsSecureUrl` (từ chối `http://127.1`, `\` trong authority) |
| `stringUtils.ts`, `UpdateProgress.tsx` | Nhãn `KiB/MiB/GiB` |
| Locales ×7 | `ipcMessage.json` (`S3E064`, `PFE011` 1 MiB); `confirmModal.json` ja/zh-TW/vi (thuật ngữ `C000011`) |
| User guide ×7, 35 ảnh, 7 PDF | Mục 10.1 (Apply ghi khởi động cùng Windows), nhãn đơn vị; chụp lại 5 ảnh mỗi ngôn ngữ |
| CHANGELOG ×7, `build/config.yml` | Mục `[1.0.1-beta.17]` → Fixed; version `1.0.1-beta.17` (trong `SP-17/sprint_docs`) |

### File thêm mới
| File | Ghi chú |
|---|---|
| `frontend/src/test/_helpers/bucketItemLabels.ts` | Helper `labels` cho test `BucketItem` |

### Đối chiếu yêu cầu
| Yêu cầu | Trạng thái | Ghi chú |
|---|---|---|
| R1 Xoá bucket | Đã làm | B1, B2, B3 theo plan; mã mới `S3E064` (Q5) |
| R2 Updater race | Đã làm | Theo Q3=B. Lệch plan: không cần bỏ qua `setAutoUpdate` khi đang check, vì code đã đọc `autoUpdate` dưới lock sau fetch nên không tự tải khi vừa tắt |
| R3 Settings / Export | Đã làm | Q2=A: Huỷ sau Apply không hoàn tác `launchOnStartup`; test cũ của `apply` đổi có chủ ý |
| R4 Policy UI | Đã làm | Policy public đảo thứ tự statement giờ hiện Public |
| R5a Issuer URL | Đã làm | |
| R5b Thuật ngữ `C000011` | Đã làm | |
| R5c `WarningIcon` flaky | Đã làm một phần | Bỏ phụ thuộc transition; vẫn thấy timeout một lần khi chạy cả thư mục lúc máy tải |
| R5d KiB/MiB/GiB | Đã làm | Q1, Q7; test cũ assert KB/MB/GB đổi có chủ ý (10 file) |
| R5e `BucketItem` labels | Đã làm | Q4 |

### Câu hỏi đã chốt
- Q1–Q7 xem `plan.md` mục 2. Khi đóng sprint: version beta `1.0.1-beta.17`, CHANGELOG ghi mục `[1.0.1-beta.17]` → Fixed đủ 7 bản; mục Known issues của 1.0.0 giữ nguyên làm lịch sử.

### Kết quả kiểm tra
- go build / go vet / golangci-lint: sạch. tsc, biome, oxlint, knip: sạch. i18n 7 ngôn ngữ cùng tập key và placeholder.
- go test hồi quy tạm (go-tester, không `-race` vì không có cgo) ở R1, R2, R3 (`SetLaunchOnStartup`), R4 (`canonicalPolicy`), R5d (đọc file 1 MiB): PASS, đã xoá, không còn `*_test.go`.
- vitest toàn bộ (branch cuối): 128 file, 2426 test pass, console sạch. Coverage C1 và Lines ≥ 95% cho mọi file đã đổi.
- Cả 6 branch qua verifier và code-reviewer, không còn finding mức medium trở lên.

### Phần chưa test tay / chưa xác minh
- Ảnh docs của 6 ngôn ngữ ngoài `en` mới so pixel, chưa mở xem từng ảnh.
- Các mục test tay của sprint-13 và sprint-16 vẫn chưa có kết quả (xem memory mục 1).

### Vấn đề còn lại (mức low)
- Test flaky khi máy tải: `WarningIcon`, `ConnectModal.auth`, `ExportProfileModal`, `SettingModal` (chạy riêng đều pass); verifier và reviewer chạy vitest song song làm tăng timeout.
- `SetLaunchOnStartup` đọc và ghi không nằm trong cùng một lock; `STE003` ghi "các cài đặt khác đã được lưu" cả khi dùng cho Apply; Select/Switch chưa khoá khi Apply đang chạy.
- Nhánh https của `isSecureIssuerUrl` chưa kiểm `\` (backend vẫn từ chối).
- `stringUtils`: giá trị `1024*1024-1` hiện `1024.00 KiB` (làm tròn có từ trước).
- `docs/scripts/shots.mjs:270` còn comment "~1.5 GB".
- Bản dịch vi/ja/zh-CN/zh-TW/ru/de của `S3E064`, mục 10.1, nhãn đơn vị (ru «КиБ/МиБ/ГиБ») và CHANGELOG chưa có người bản ngữ duyệt.
