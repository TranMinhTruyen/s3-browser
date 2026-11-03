## Kết quả sprint-10
- Trạng thái: Hoàn thành (còn smoke test S3/MinIO và kiểm tra bằng mắt U8, U9, U10, U14 do người dùng chạy, xem "Vấn đề còn lại")
- Tổng thay đổi (10 branch, so với `origin/master` 1cb43ebc): +2.682 / -679 dòng
- Ghi chú: 8 branch đầu làm ở session trước (đã push lên origin). Session này làm tiếp branch 9 (`fe_setting_modal`, từ commit WIP b83febf5) và branch 10 (`cleanup_messages_config`). Số vòng review và coverage chi tiết của 8 branch đầu không có trong session này; số liệu file/dòng lấy bằng `git diff --numstat origin/master origin/SP-10/<branch>`.

### Branch
| Branch | Yêu cầu | Số vòng review | Commit | Trạng thái |
|---|---|---|---|---|
| SP-10/be_setting_cleanup | R1, R2 | (session trước) | f3a1e19e | Đạt, đã push |
| SP-10/be_core_refactor | R1, R3 (U8) | (session trước) | 2402afc0 | Đạt, đã push |
| SP-10/be_bucket_perf | R1, R2 | (session trước) | a6e30168 | Đạt, đã push |
| SP-10/fe_common_utils | R1, R2 | (session trước) | 415a5ede | Đạt, đã push |
| SP-10/fe_startup_profiles | R1, R2, R3 | (session trước) | 1d20d3e2 | Đạt, đã push |
| SP-10/fe_tabs_layout | R1, R2, R3 | (session trước) | e1b9d082 | Đạt, đã push |
| SP-10/fe_bucket_object | R1, R2, R3 | (session trước) | c761bee3 | Đạt, đã push |
| SP-10/fe_transfer_modals | R1, R2, R3 | (session trước) | 4eb6da60 | Đạt, đã push |
| SP-10/fe_setting_modal | R1, R3 | 2/3 | b83febf5 (WIP) + b3776c51 | Đạt, commit local |
| SP-10/cleanup_messages_config | R1 | 1/3 | (commit kèm report này) | Đạt, commit local |

### File sửa đổi
| Branch | File | +/- |
|---|---|---|
| be_setting_cleanup | `internal/handlers/setting_handler.go` | +0 / -5 |
| be_setting_cleanup | `internal/modules/setting/module.go` | +0 / -8 |
| be_setting_cleanup | `internal/modules/setting/submodule_file_mng.go` | +4 / -39 |
| be_setting_cleanup | `internal/modules/setting/submodule_setting_mng.go` | +1 / -1 |
| be_setting_cleanup | `internal/modules/setting/submodule_tab_mng.go` | +3 / -14 |
| be_core_refactor | `main.go` | +5 / -4 |
| be_bucket_perf | `internal/modules/bucket/module.go` | +1 / -1 |
| be_bucket_perf | `internal/modules/bucket/submodule_{bucket,cfg,connection,object,search}_mng.go`, `uploader_items.go` | +1 / -0 mỗi file |
| be_bucket_perf | `internal/modules/bucket/submodule_downloader_mng.go` | +8 / -0 |
| be_bucket_perf | `internal/modules/bucket/submodule_uploader_mng.go` | +3 / -2 |
| fe_common_utils | `.gitignore` | +3 / -0 |
| fe_common_utils | `frontend/src/common/stores/downloaderStore.ts` | +1 / -1 |
| fe_common_utils | `frontend/src/common/stores/modalStackStore.ts` | +5 / -3 |
| fe_common_utils | `frontend/src/common/stores/tabListStore.ts` | +17 / -17 |
| fe_common_utils | `frontend/src/common/utils/stringUtils.ts` | +1 / -1 |
| fe_common_utils | `frontend/src/components/buttons/{ActionIcon,Button}.tsx`, `useAutoLoading.ts` | +4 / -1 mỗi file |
| fe_startup_profiles | `frontend/src/App.tsx` | +15 / -3 |
| fe_startup_profiles | `frontend/src/main.tsx` | +3 / -8 |
| fe_startup_profiles | `frontend/src/common/stores/profileStore.ts` | +9 / -1 |
| fe_startup_profiles | `frontend/src/common/utils/tabPersistence.ts` | +9 / -1 |
| fe_startup_profiles | `frontend/src/components/layouts/navbar/components/ConnectionProfiles.tsx` | +14 / -15 |
| fe_startup_profiles | `frontend/src/components/layouts/tab/components/TabDetail.tsx` | +7 / -11 |
| fe_startup_profiles | `frontend/src/components/layouts/tab/useTabPersistence.ts` | +2 / -1 |
| fe_startup_profiles | `frontend/src/components/modals/ConnectModal.tsx` | +8 / -2 |
| fe_startup_profiles | `frontend/src/components/modals/connectSchema.ts` | +2 / -0 |
| fe_startup_profiles | `frontend/src/components/modals/lazyModals.ts` | +42 / -10 |
| fe_startup_profiles | `frontend/src/pages/object/useFilesDroppedUpload.ts` | +3 / -2 |
| fe_startup_profiles | `locales/{en,vi,ja}/common.json`, `components/navbar/connectionProfiles.json` | +2/-1, +3/-0 mỗi ngôn ngữ |
| fe_tabs_layout | `frontend/src/common/cnst/motionConst.ts` | +6 / -0 |
| fe_tabs_layout | `frontend/src/components/layouts/MainLayout.tsx` | +0 / -1 |
| fe_tabs_layout | `frontend/src/components/layouts/tab/TabLayout.tsx` | +34 / -11 |
| fe_tabs_layout | `frontend/src/components/layouts/tab/components/SortableTab.tsx` | +44 / -10 |
| fe_tabs_layout | `frontend/src/components/layouts/tab/components/TabScroller.tsx` | +4 / -1 |
| fe_tabs_layout | `frontend/src/components/providers/MotionProvider.tsx` | +5 / -1 |
| fe_tabs_layout | `locales/{en,vi,ja}/components/tabLayout.json` | +1 / -1 mỗi ngôn ngữ |
| fe_bucket_object | `frontend/src/components/inputs/FieldInput.tsx`, `SearchInput.tsx` | +4/-0, +1/-0 |
| fe_bucket_object | `frontend/src/components/inputs/combobox/BucketPicker.tsx` | +4 / -18 |
| fe_bucket_object | `frontend/src/pages/bucket/BucketItem.tsx` | +10 / -11 |
| fe_bucket_object | `frontend/src/pages/bucket/BucketListView.tsx` | +14 / -5 |
| fe_bucket_object | `frontend/src/pages/object/ObjectItem.tsx` | +91 / -116 |
| fe_bucket_object | `frontend/src/pages/object/ObjectListView.tsx` | +3 / -2 |
| fe_bucket_object | `locales/{en,vi,ja}/pages/{bucket,object}/page.json` | +1 / -0 mỗi file |
| fe_transfer_modals | `frontend/src/components/layouts/downloader/DownloaderItem.tsx` | +2 / -1 |
| fe_transfer_modals | `frontend/src/components/layouts/downloader/DownloaderWindow.tsx` | +9 / -8 |
| fe_transfer_modals | `frontend/src/components/layouts/uploader/UploaderItem.tsx` | +2 / -1 |
| fe_transfer_modals | `frontend/src/components/layouts/uploader/UploaderWindow.tsx` | +7 / -39 |
| fe_transfer_modals | `frontend/src/components/modals/ConfirmModal.tsx` | +1 / -1 |
| fe_transfer_modals | `frontend/src/components/modals/HistoryModal.tsx` | +63 / -58 |
| fe_transfer_modals | `frontend/src/components/modals/UploadFileList.tsx` | +62 / -16 |
| fe_transfer_modals | `frontend/src/components/modals/UploadLimitModal.tsx` | +23 / -20 |
| fe_transfer_modals | `frontend/src/components/modals/UploadPickerModal.tsx` | +37 / -59 |
| fe_setting_modal | `frontend/src/common/stores/settingStore.ts` | +1 / -0 |
| fe_setting_modal | `frontend/src/common/utils/settingUtils.ts` | +12 / -1 |
| fe_setting_modal | `frontend/src/components/inputs/{CheckBoxInput,SegmentedControl,SelectInput,SwitchInput}.tsx` | +1 / -0 mỗi file |
| fe_setting_modal | `frontend/src/components/modals/SettingModal.tsx` | +27 / -8 |
| fe_setting_modal | `frontend/src/components/modals/modalColors.ts` | +5 / -5 |
| cleanup_messages_config | `biome.json` | +1 / -1 |
| cleanup_messages_config | `locales/{en,vi,ja}/messages/validateMessage.json` | +1 / -2 mỗi ngôn ngữ |

File test đã sửa (mọi branch FE) nằm trong `frontend/src/test/**`, tương ứng với file production ở trên.

### File thêm mới
| Branch | File | Số dòng |
|---|---|---|
| be_setting_cleanup | `internal/modules/setting/json_file.go` | 47 |
| be_core_refactor | `os_theme_windows.go` | 11 |
| be_core_refactor | `os_theme_other.go` | 8 |
| fe_startup_profiles | `frontend/src/common/hooks/useConnectProfile.ts` | 23 |
| fe_startup_profiles | `frontend/src/common/utils/startup.ts` | 12 |
| fe_transfer_modals | `frontend/src/components/layouts/VirtualItemList.tsx` | 56 |
| fe_transfer_modals | `frontend/src/components/layouts/transferItem.ts` | 2 |
| test | `test/common/hooks/useConnectProfile.test.tsx` (48), `test/common/utils/startup.test.ts` (100), `test/components/layouts/tab/TabLayoutA11y.test.tsx` (34), `test/components/layouts/VirtualItemList.test.tsx` (105) | 287 |

### Danh sách refactor (R1)
| # | File | Lý do | Branch |
|---|---|---|---|
| A1 | `tabListStore.ts` | Gom khối reset view lặp lại thành `resetTabView` | fe_common_utils |
| A2 | `useConnectProfile.ts` (mới), `TabDetail.tsx`, `ConnectionProfiles.tsx` | Gom lời gọi IPC kết nối profile bị trùng | fe_startup_profiles |
| A3 | `setting/json_file.go` (mới), `submodule_file_mng.go`, `submodule_tab_mng.go` | Gộp `path()` trùng thành `dataFilePath`, tách `writeJSONAtomic` ra file riêng | be_setting_cleanup |
| A4 | `tabListStore.ts` | `in` → `Object.hasOwn`, tránh coi key kế thừa (`toString`) là tab | fe_common_utils |
| A5 | `MainLayout.tsx` | Xoá `Group` rỗng | fe_tabs_layout |
| A6 | `App.tsx` | Key route theo `path` | fe_startup_profiles |
| A7 | `setting_handler.go`, `setting/module.go` | Xoá `ResetSettings` không có nơi gọi; bindings sinh lại | be_setting_cleanup |
| A8 | `validateMessage.json` x3 | Xoá `V000003` không dùng (đã grep trên master và mọi `origin/SP-10/*`) | cleanup_messages_config |
| A9 | `SelectInput`, `SwitchInput`, `CheckBoxInput`, `SegmentedControl` | Giữ wrapper, thêm JSDoc | fe_setting_modal |
| A10 | `lazyModals.ts` | Tách lỗi tải chunk khỏi lỗi `show()`, bỏ `console.error` | fe_startup_profiles |
| A11 | `ObjectItem.tsx` (gom markup thành `ObjectRow`), `UploaderWindow`/`DownloaderWindow` (chung `VirtualItemList`), `UploadPickerModal`/`UploadLimitModal` (chung `GroupRow`), `BucketPicker` (dùng lại `ComboboxClearButton`), `BucketListView` (hằng số thay số ma thuật) | Giảm code trùng, file ngắn lại | fe_bucket_object, fe_transfer_modals |
| A12 | Go: setting, bucket submodule; FE: `Button`, `ActionIcon`, `tabListStore`, `TabScroller`, `MotionProvider`, `FieldInput`, `SearchInput`, `settingStore`, `settingUtils`, input wrapper | Bổ sung doc comment/JSDoc | nhiều branch |
| - | `useAutoLoading.ts` | Xử lý promise sinh ra từ `.finally`, hết unhandled rejection | fe_common_utils |
| - | `downloaderStore.ts`, `modalStackStore.ts`, `stringUtils.ts` | Sửa nhãn devtools, dùng hằng `SCOPE`, bỏ template literal thừa | fe_common_utils |
| - | `bucket/submodule_downloader_mng.go` | Return sớm khi `input.Objects` rỗng (tránh panic index out of range) | be_bucket_perf |
| - | `SettingModal.tsx` | `save()` reject được coi là lưu thất bại (không còn unhandled rejection); bỏ guard `saving` chết trong `onCloseModal` | fe_setting_modal |
| - | `biome.json` | `biome migrate`: schema 2.6.3 → 2.6.4 (bỏ `"root": false` do migrate thêm vì làm config không áp dụng) | cleanup_messages_config |

Kiểm chứng không còn code chết/key thừa:
- `ipcMessage.json`: 59 key mỗi ngôn ngữ = 58 mã Go (trên master và mọi `origin/SP-10/*`, regex `[A-Z][A-Z0-9]{1,3}[SEW]\d{3}`) + `CME001` (chỉ frontend, `ipcUtils.ts`). Không có key mồ côi, không có mã Go thiếu key.
- en/vi/ja cùng tập file và cùng tập key; mọi namespace đã đăng ký trong `resource.ts` (script tạm, không commit).
- Key không dùng của các namespace khác: không phát hiện (phép kiểm heuristic theo tên cuối của key, có thể lọt key trùng tên chuỗi khác).
- `tsc --noEmit`, oxlint, `biome check src` sạch trên branch 9, 10.

### Hiệu năng (R2)
| # | Vấn đề | Mức | Xử lý | Kết quả |
|---|---|---|---|---|
| P1 | Khởi động 3 IPC tuần tự | Trung | `loadStartupData` nạp settings + tab state song song | Đã làm (fe_startup_profiles) |
| P2 | `loadConnectionProfiles` chạy 2 lần | Trung | Nạp 1 lần ở `App`, cleanup `reset()`, an toàn StrictMode | Đã làm (fe_startup_profiles) |
| P3 | Selector `useTabPersistence` | Thấp | Giữ nguyên | Không đổi |
| P4 | `UploadPickerModal`, `UploadLimitModal` trong bundle chính | Trung | Lazy qua `lazyModals` | Đã làm (fe_startup_profiles) |
| P5 | i18n nạp cả 3 ngôn ngữ | Thấp | Deferred | Không đổi |
| P6 | `Set` O(n) trong store | Thấp | Chỉ đổi nếu đo thấy chậm | Không đổi |
| P7 | `ConnectionProfiles` chọn nguyên map | Thấp | Chấp nhận | Không đổi |
| P8 | `DownloaderWindow` chưa virtualize | Trung | `VirtualItemList` dùng chung với uploader | Đã làm (fe_transfer_modals) |
| P9 | `memo(FileRow)` vô tác dụng | Thấp | Truyền `top`, `useRowStyle` giữ style ổn định | Đã làm (fe_transfer_modals) |
| P10 | Download concurrency, `os.Stat` tuần tự | Thấp | Ghi lý do quyết định bằng comment tại chỗ, không đổi logic | Ghi lại (be_bucket_perf) |
| P11 | `writeJSONAtomic` không `Sync()` | Thấp | Thêm `Sync()` trước Close/Rename | Đã làm; Save ~0,50 ms → ~0,96 ms/lần (be_setting_cleanup) |
| P12, P13 | `MaxKeys`, phân trang history/profile | Thấp | Deferred | Không đổi |
| P14, P15 | Listener, settings I/O | Thấp | Đã xác minh, không cần sửa | Không đổi |

Mọi mục mức Trung đã xử lý; không có mục mức Cao. **Chưa có `baseline.md`**: số đo trước/sau theo mục 6 của plan (thời gian khởi động, số lần gọi `loadConnectionProfiles`, bundle gzip, mở bucket 1.000 object, số render `TabDetail`) chưa được ghi lại, chỉ có số đo Save settings ở P11.

### UX/UI (R3)
| # | Màn hình | Trước | Sau | Branch |
|---|---|---|---|---|
| U1 | Danh sách profile | Vùng trống khi chưa có profile | Trạng thái rỗng có chữ hướng dẫn (`profile.empty`) | fe_startup_profiles |
| U2 | Danh sách bucket / object | Vùng trống khi bucket/thư mục rỗng | "No buckets yet" / "This folder is empty" khi đã tải xong và không có keyword | fe_bucket_object |
| U3 | Thanh tab | Kéo thả bật cả khi 1 tab; Space/Enter bắt đầu kéo | Kéo thả chỉ bật khi ≥ 2 tab; đổi chỗ bằng Ctrl+Shift+←/→; hướng dẫn cho screen reader | fe_tabs_layout |
| U4 | Thanh tab | Đóng tab làm tab khác nhảy chỗ | Animation thu gọn khi đóng tab | fe_tabs_layout |
| U7 | Modal Setting | Lúc Save chỉ khoá nút Save | Khoá Cancel/Reset/Apply/X/Esc/click ngoài, Save có loading; vẫn giữ guard `isTopmost` của modal stack | fe_setting_modal |
| U8 | Khởi động (theme `auto`, OS dark) | Nền cửa sổ trắng, có thể nháy | Native: màu nền cửa sổ theo dark mode của OS (registry trên Windows). FE: `applySettings` đặt `data-mantine-color-scheme` ngay khi có setting | be_core_refactor + fe_setting_modal; **chưa xác minh bằng chạy app** |
| U9 | Màu header modal | Hex trong `light-dark()` | `light-dark(var(--mantine-color-*), …)`; `DEFAULT_PROFILE_COLOR` giữ hex (dữ liệu) | fe_setting_modal; màu light lệch nhẹ (R-09), cần xem bằng mắt |
| U10 | Đổi ngôn ngữ/font | Footer modal có thể nhảy | Footer `Group justify="space-between" wrap="nowrap"` ở ConnectModal và các modal transfer; SettingModal đã đúng | nhiều branch; **chưa rà bằng mắt 3 ngôn ngữ x 3 font** |
| U11 | Toast khởi động | Toast lỗi tải profile có thể không hiện | Nạp profile trong `App` sau khi `Toaster` mount, có toast khi lỗi | fe_startup_profiles |
| U12 | Cửa sổ Downloading | Render mọi item | Virtualize, giữ layout | fe_transfer_modals |
| U13 | Modal lazy | Chunk tải chậm không có phản hồi | Toast loading khi chunk tải chậm | fe_startup_profiles |
| U14 | Trạng thái kết nối profile | Chưa kiểm tương phản ở dark | Commit của fe_startup_profiles không ghi nhận thay đổi cho U14 | **Chưa xác minh**, cần người dùng kiểm khi chạy app |

### Đối chiếu yêu cầu
| Yêu cầu | Trạng thái | Ghi chú |
|---|---|---|
| R1 Refactor | Hoàn thành | Danh sách ở trên; không đổi hành vi ngoài các điểm UX/UI |
| R2 Hiệu năng | Hoàn thành một phần | Mục mức Trung đã xử lý; thiếu `baseline.md` và số đo trước/sau (trừ P11) |
| R3 UX/UI | Hoàn thành một phần | 10/12 mục đã làm; U8, U9, U10 cần xác minh bằng mắt; U14 chưa có bằng chứng đã làm |

### Kết quả kiểm tra
Branch 9 (`fe_setting_modal`, vòng 2) và branch 10 (`cleanup_messages_config`) do verifier chạy trong session này:
- go build / go vet: PASS (không đổi Go ở 2 branch này)
- golangci-lint: bỏ qua (không đổi Go)
- biome check: PASS (branch 10 hết notice schema 2.6.3 vs 2.6.4)
- oxlint: PASS
- tsc --noEmit: PASS (sau khi sinh lại bindings local, xem "Vấn đề còn lại")
- vitest: branch 9: 72 file / 914 test pass; branch 10: 72 file / 892 test pass; console sạch ở cả hai
- code-reviewer: branch 9 vòng 1 có 1 lỗi medium (Esc/click ngoài ghi đè `isTopmost`), đã sửa và vòng 2 Đạt; branch 10 Đạt
- 8 branch đầu: theo commit message và session trước, không chạy lại trong session này

### Coverage frontend (ngưỡng ≥ 95%)
| File | Lines | Branches (C1) | Đạt |
|---|---|---|---|
| `components/modals/SettingModal.tsx` | 100% | 100% | Có |
| `components/modals/modalColors.ts` | 100% | 100% | Có |
| `common/utils/settingUtils.ts` | 100% | 100% | Có |
| `common/stores/settingStore.ts` | 100% | 100% | Có |
| `components/inputs/SelectInput.tsx` | 100% | 100% | Có |
| `components/inputs/SwitchInput.tsx` | 100% | 100% | Có |
| `components/inputs/CheckBoxInput.tsx` | 100% | 100% | Có |
| `components/inputs/SegmentedControl.tsx` | 100% | 100% | Có |

Branch 10 chỉ đổi JSON/config, nằm ngoài coverage. Coverage của 8 branch đầu không đo lại trong session này.

### Vấn đề còn lại
- **Smoke test S3 + MinIO** do người dùng chạy (tiêu chí R1), kèm xem bằng mắt U8 (OS dark + theme auto, không nháy trắng), U9 (màu header modal ở light), U10 (3 ngôn ngữ x System UI/Monospace/JetBrains Mono), U14 (tương phản trạng thái kết nối ở dark).
- **Thiếu `baseline.md`** và số đo hiệu năng trước/sau (trừ P11).
- **`frontend/bun.lock` lệch `package.json`**: `bun install --frozen-lockfile` báo lockfile cần cập nhật. Session này cài bằng `bun install` rồi khôi phục `bun.lock` gốc, không commit thay đổi lockfile. Nên cập nhật lockfile trong một commit riêng.
- Môi trường local trước đó thiếu package test (`vitest`, `@testing-library/*`, `jsdom`) và bindings cũ (chưa có `settinghandler`); đã cài và sinh lại (bindings nằm trong `.gitignore`).
- Branch 9 có commit WIP `b83febf5` "Branch 9 unfinished code" không theo Conventional Commits; không sửa vì cần force push. Có thể squash khi merge PR.
- Low từ review branch 9: `save().catch(() => false)` nuốt lỗi (đã có comment, vì `callIPC` đã báo lỗi); test "stacked modal" chưa chứng minh bằng mutation test.
- 8 branch đầu và 2 branch cuối đều tách từ `origin/master` 1cb43ebc, không phụ thuộc nhau; khi merge cần kiểm lại tổng thể trên master (ví dụ chạy lại toàn bộ vitest).

### Đề xuất cập nhật tài liệu (làm ở sprint-11)
- `CLAUDE.md`: nhắc chạy `bun install` và skill `wails3-bindings` trước khi verify trên máy mới (bindings bị gitignore); không có quy ước nào bị lệch trong sprint này.
- `docs/ARCHITECTURE*.md`: luồng khởi động mới (`loadStartupData`, nạp profile ở `App`), `useConnectProfile`, `VirtualItemList` dùng chung, `lazyModals` cho upload modal, `setting/json_file.go` + `dataFilePath`, theme native theo OS (`os_theme_*.go`), tab/`motion`/`tabs.json`.
