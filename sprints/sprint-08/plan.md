# Plan sprint-08

Trạng thái: **HOÀN TẤT** (2026-10-28, xem `report.md`). Plan đã được duyệt (người dùng đã trả lời toàn bộ câu hỏi). Phạm vi sprint-08 chỉ còn **R1**; R2 và R3 dời sang sprint sau (xem mục 8).

## 1. Tóm tắt yêu cầu
- R1: Modal Setting (nút bên trái nút Download history trên app header): theme, font chữ, ngôn ngữ, khởi động cùng Windows. Lưu vào 1 file json, nạp trước khi hiện UI, có nút reset về mặc định.
- R2, R3: dời sang sprint sau.

Hiện trạng đã kiểm chứng trong code:
- Header nằm trong `frontend/src/components/layouts/MainLayout.tsx`: chỉ có `ActionIcon` Download history (`RotateCcwClock`) và `SegmentedControl` EN/VI/JA (`i18n.changeLanguage`, `defaultValue="en"`). Ngôn ngữ **không được lưu ở đâu**, mỗi lần mở app là `lng: 'en'` (`frontend/src/locales/i18n.ts`), nên không cần migrate.
- Theme: `frontend/src/main.tsx` dùng `<MantineProvider>` mặc định (chưa có `defaultColorScheme`).
- Màu hard-code (grep, loại trừ test và svg), cần rà soát toàn bộ ở F5:
  - `frontend/src/style.css`: `color: black` (html, body).
  - `frontend/src/components/modals/modalColors.ts`: `INFO_BG_COLOR #d0ebff`, `INFO_COLOR #2600fdbe`, `WARNING_BG_COLOR #f6ffd0`, `WARNING_COLOR #dfc21e` (được `MainLayout`, `ConnectionProfiles`, các modal dùng).
  - `frontend/src/pages/object/page.module.css`, `frontend/src/pages/bucket/page.module.css`: `#000000`, `#3b48ff`, `rgba(59,72,255,0.05)`.
  - `frontend/src/components/modals/UploadPickerModal.module.css`: `#3b48ff`, `rgba(59,72,255,0.05)`.
  - `frontend/src/components/layouts/layout.module.css`: `#000000`.
  - `frontend/src/components/layouts/navbar/components/ConnectionProfiles.tsx`: `'#000000'`, `'#FFFFFF'`, `'#83f175'`, `value.color ?? '#FFFFFF'` (dòng 181, 192, 211). `value.color` là màu do user chọn cho profile (dữ liệu, không phải màu theme); chỉ đổi các màu mặc định/chữ tương phản.
  - `main.go`: `BackgroundColour: NewRGBA(27,38,54,1)` (màu nền cửa sổ native).
  - Còn các `c=`/`bg=`/`color=` dạng tên màu Mantine (ví dụ `color="gray"`) đã theo theme nên không cần đổi (chưa rà hết, F5 sẽ grep lại `color=`, `bg=`, `style=\{\{.*[Cc]olor`).
- Font: `style.css` dùng `Nunito` (`frontend/src/assets/fonts/nunito-v16-latin-regular.woff2`, kèm `OFL.txt` của Nunito cùng thư mục) rồi fallback system.
- Thư mục dữ liệu: `portable.DataDir(appName)` (`internal/pkg/portable/*`) = `<exe>/data` (portable) hoặc `os.UserConfigDir()/<appName>`; `data.db` nằm ở đó.
- Khởi động: `main.go` → `internal.NewApp` → `RegisterService` → `Window.NewWithOptions` → `Run`. Handler hiện có: Bucket, Master, Profile.
- `package.json`: chưa có lib drag & drop; không cần lib mới ở sprint này. `go.mod`: `golang.org/x/sys v0.49.0` đang `// indirect`.
- Người dùng đã đặt `JetBrainsMono-2.304.zip` ở gốc `App/S3Browser` (đã xác nhận tồn tại).

## 2. Câu hỏi chưa rõ (đã trả lời)
| # | Câu hỏi | Đề xuất | Trả lời |
|---|---|---|---|
| Q1 | File json setting đặt ở đâu? | `<portable.DataDir>/settings.json`, ghi atomic (file tạm + rename); file thiếu/hỏng thì dùng mặc định và log warn. | Đồng ý theo đề xuất |
| Q2 | Theme gồm lựa chọn nào? | `light` / `dark` / `auto`, mặc định `light`; dùng color scheme của Mantine. | Đồng ý theo đề xuất |
| Q3 | Font: cố định hay tự do, có cỡ chữ không? | Danh sách cố định (Nunito, System UI, Segoe UI, Arial, monospace) lưu dạng key; không chỉnh cỡ chữ. | Danh sách cố định như đề xuất, **thêm JetBrains Mono** (user cung cấp `JetBrainsMono-2.304.zip`, bundle local). Không chỉnh cỡ chữ. |
| Q4 | Preview hay chỉ sau khi Lưu? Hoàn tác khi đóng? | Preview ngay theme/font/ngôn ngữ; Lưu mới ghi file; đóng/Huỷ chưa lưu thì hoàn tác. Autostart chỉ áp dụng khi Lưu. | Đồng ý theo đề xuất |
| Q5 | Autostart trên macOS/Linux và bản portable? | Chỉ Windows bản thường (registry HKCU Run); ẩn option ở portable và OS khác qua cờ `autostartSupported`. | Đồng ý theo đề xuất |
| Q6 | Ngôn ngữ đang lưu ở đâu, migrate? | Không lưu ở đâu, không migrate; chuyển vào modal, bỏ `SegmentedControl` khỏi header. | Đồng ý theo đề xuất |
| Q12 | Nút Reset ghi ngay hay chờ Lưu? | Reset form về mặc định (preview), Lưu mới ghi file; không cần xác nhận. | Đồng ý theo đề xuất |
| Q13 | Chặn UI tới khi nạp setting xong thế nào? | `main.tsx` `await GetSettings()` trước `createRoot().render`; lỗi thì dùng mặc định; B5 đổi `BackgroundColour` theo theme (tuỳ chọn). | Đồng ý theo đề xuất |
| Q14 | Màu hard-code có phải sửa để dark theme dùng được? | Sửa tối thiểu. | Rà soát **TOÀN BỘ** màu hard-code, đổi sang biến theme Mantine (CSS variable `--mantine-color-*`, `light-dark()`, hoặc prop màu theo theme). |

## 3. Task backend (go-backend)
| # | Task | Yêu cầu | File sửa / tạo | Phụ thuộc |
|---|---|---|---|---|
| B1 | Model `AppSettings` (theme, font, language, launchOnStartup), `SettingsOutput` (kèm `autostartSupported`), input lưu; re-export trong alias | R1 | `models/setting/setting_input.go`, `models/setting/setting_output.go` (tạo), `models/alias.go` (sửa) | - |
| B2 | Module `setting`: đọc/ghi `settings.json` trong `portable.DataDir`, ghi atomic, `sync.Mutex`, validate (theme/font/language thuộc danh sách hợp lệ; font có thêm key JetBrains Mono), file thiếu/hỏng -> mặc định; API `GetSettings`, `SaveSettings`, `ResetSettings` | R1 | `internal/modules/setting/module.go`, `internal/modules/setting/submodule_file_mng.go`, `internal/modules/setting/submodule_setting_mng.go` (tạo) | B1 |
| B3 | Autostart Windows (ghi/xoá khoá Run bằng `golang.org/x/sys/windows/registry`; portable/OS khác là no-op + `supported=false`); `SaveSettings` áp dụng autostart, lỗi registry trả message | R1 | `internal/modules/setting/autostart_windows.go`, `internal/modules/setting/autostart_other.go` (tạo), `go.mod` (`x/sys` indirect -> direct, có thể `go mod tidy`) | B2 |
| B4 | Handler mỏng + đăng ký service; tạo module trong `NewApp` | R1 | `internal/handlers/setting_handler.go` (tạo), `internal/app.go` (sửa), `main.go` (sửa: `RegisterService`) | B2, B3 |
| B5 | (Tuỳ chọn, Q13) đọc theme từ settings để chọn `BackgroundColour` cửa sổ | R1 | `main.go` (sửa) | B4 |

Message code mới (khai báo `var` đầu `module.go`, thêm `cnst.Setting = "setting"` vào `internal/pkg/cnst/common.go`): `STE001` lỗi đọc setting, `STE002` lỗi ghi setting, `STE003` lỗi cập nhật khởi động cùng Windows, `STE004` giá trị setting không hợp lệ; `STS001` lưu thành công (nếu cần toast). Key tương ứng trong `frontend/src/locales/{en,vi,ja}/messages/ipcMessage.json`.  |  Migration / sqlc: không  |  Cần sinh lại bindings: có (`SettingHandler` mới)

## 4. Task frontend (react-frontend)
Không cần cài lib ngoài ở sprint này.

| # | Task | Yêu cầu | File sửa / tạo | Phụ thuộc |
|---|---|---|---|---|
| F0 | Bundle font JetBrains Mono: giải nén từ `JetBrainsMono-2.304.zip` (gốc `App/S3Browser`) các file `fonts/webfonts/JetBrainsMono-{Regular,Medium,SemiBold,Bold}.woff2` vào `frontend/src/assets/fonts/`; giấy phép `OFL.txt` của JetBrains Mono **đổi tên** `OFL-JetBrainsMono.txt` (vì thư mục đã có `OFL.txt` của Nunito); khai báo 4 `@font-face` (weight 400/500/600/700, `font-display: swap`) trong `style.css` giống cách khai báo Nunito. Không commit file zip (người dùng tự xoá hoặc thêm vào `.gitignore`; agent không sửa `.gitignore`). | R1 | `frontend/src/assets/fonts/JetBrainsMono-*.woff2`, `frontend/src/assets/fonts/OFL-JetBrainsMono.txt` (tạo), `frontend/src/style.css` (sửa) | - |
| F1 | `settingStore` (zustand): giá trị đã lưu + draft, `load`, `save`, `reset` (về mặc định), `revert`; hàm áp dụng theme (Mantine color scheme), font (CSS variable/`theme.fontFamily`), ngôn ngữ (`i18n.changeLanguage`); hằng số danh sách font (Nunito, System UI, Segoe UI, Arial, monospace, JetBrains Mono), theme, language, mặc định | R1 | `frontend/src/common/stores/settingStore.ts`, `frontend/src/common/cnst/settingConst.ts` (tạo) | B4, F0 |
| F2 | Nạp setting trước khi render: `await GetSettings()` rồi áp dụng, sau đó mới `createRoot().render`; `MantineProvider` có `defaultColorScheme`/`colorSchemeManager` không tự lưu localStorage (file json là nguồn duy nhất) | R1 | `frontend/src/main.tsx` (sửa), `frontend/src/common/utils/settingUtils.ts` (tạo; tách bootstrap để test vì `main.tsx` bị loại khỏi coverage) | F1 |
| F3 | `SettingModal` (`createMantineModal` + lazy `showSettingModal`): select theme, select font (preview từng font bằng chính font đó nếu đơn giản), select ngôn ngữ, switch khởi động cùng Windows (ẩn nếu `autostartSupported=false`), nút Lưu / Huỷ / Reset mặc định; preview + hoàn tác khi đóng không lưu | R1 | `frontend/src/components/modals/SettingModal.tsx` (tạo), `frontend/src/components/modals/lazyModals.ts` (sửa) | F1 |
| F9 | i18n 3 ngôn ngữ cho `settingModal` và tooltip nút Setting; đăng ký trong `resource.ts` en/vi/ja | R1 | `frontend/src/locales/{en,vi,ja}/components/modals/settingModal.json` (tạo), `frontend/src/locales/{en,vi,ja}/resource.ts` (sửa) | F3 |
| F4 | Header: thêm `ActionIcon` (icon `Settings` lucide) bên trái nút Download history; bỏ `SegmentedControl` ngôn ngữ | R1 | `frontend/src/components/layouts/MainLayout.tsx` (sửa) | F3 |
| F5 | Rà soát **toàn bộ** màu hard-code (danh sách ở mục 1) và đổi sang biến theme Mantine để dark theme dùng được: `style.css` (`color: var(--mantine-color-text)`), `modalColors.ts` (đổi sang giá trị/biến theo scheme, giữ API export hoặc cập nhật mọi nơi dùng), các `*.module.css` (`var(--mantine-color-*)`, `light-dark()`), `ConnectionProfiles.tsx` (chữ tương phản, trạng thái connected/disconnected theo theme; giữ màu user chọn), `layout.module.css`; chạy grep lại toàn `frontend/src` (trừ `test/`, svg) để chắc không sót | R1 | `frontend/src/style.css`, `frontend/src/components/modals/modalColors.ts`, `frontend/src/pages/object/page.module.css`, `frontend/src/pages/bucket/page.module.css`, `frontend/src/components/modals/UploadPickerModal.module.css`, `frontend/src/components/layouts/layout.module.css`, `frontend/src/components/layouts/navbar/components/ConnectionProfiles.tsx` (sửa) và file khác nếu grep thấy | F2 |

i18n key mới (en/vi/ja): `settingModal` (`title`, `label.theme`, `label.font`, `label.language`, `label.launchOnStartup`, `option.theme.light|dark|auto`, `option.font.*` gồm JetBrains Mono, `button.save|cancel|reset`, `message.saved`). Tooltip nút Setting tái dùng `settingModal.title`.

Test frontend (react-tester):
| Task | File cần test | Case cần phủ |
|---|---|---|
| F1 | `frontend/src/test/common/stores/settingStore.test.ts` | load thành công / `callIPC` trả null (giữ mặc định); save thành công cập nhật saved; save thất bại (null) giữ draft; reset về mặc định; revert; áp dụng theme/font/ngôn ngữ gọi đúng hàm; `reset()` gọi `invalidateLoads` |
| F2 | `frontend/src/test/common/utils/settingUtils.test.ts` | bootstrap với setting hợp lệ / IPC trả null dùng mặc định / giá trị lạ (theme hoặc font ngoài danh sách) rơi về mặc định |
| F3 | `frontend/src/test/components/modals/SettingModal.test.tsx` | render giá trị hiện tại; đổi từng field preview ngay; Lưu thành công đóng modal; Lưu thất bại giữ modal; Huỷ/đóng hoàn tác; Reset về mặc định; ẩn switch autostart khi `autostartSupported=false` |
| F4 | `frontend/src/test/components/layouts/MainLayout.test.tsx` (sửa) | nút Setting mở modal, nằm bên trái nút History, không còn selector ngôn ngữ |
| F5 | `frontend/src/test/components/modals/modalColors.test.ts` (sửa nếu đổi export), `frontend/src/test/components/layouts/navbar/components/ConnectionProfiles.test.tsx` (sửa nếu đổi màu: test hiện assert `rgb(131, 241, 117)` và `rgb(255, 255, 255)`) | giá trị màu/biến mới; các nhánh chọn màu chữ theo độ sáng; trạng thái connected/disconnected |
| F0, F9 | không cần (asset/css/locale bị loại trừ) | - |

## 5. Thứ tự thực hiện (luôn tuần tự)
1. Backend: B1 → B2 → B3 → B4 → (B5)
2. `go tool wails3 generate bindings -clean=true -ts` (không có sqlc)
3. Frontend: F0 → F1 → F2 → F3 → F9 → F4 → F5
4. FE test (react-tester)

## 6. Rủi ro
| # | Rủi ro | Mức độ | Cách giảm thiểu |
|---|---|---|---|
| 1 | `await GetSettings()` trước khi render làm chậm khởi động hoặc treo nếu backend lỗi | medium | Đọc 1 file nhỏ; lỗi thì dùng mặc định và vẫn render; đo thời gian khi verify |
| 2 | Rà soát toàn bộ màu hard-code lan rộng nhiều file, dễ sót hoặc vỡ giao diện light cũ; `modalColors.ts` dùng ở nhiều nơi | medium | Grep lại sau khi sửa; giữ giao diện light giống cũ; kiểm tra thủ công cả hai theme; test `ConnectionProfiles` phải cập nhật |
| 3 | Autostart: ghi registry có thể bị chặn; bản portable | medium | Trả `STE003` không làm hỏng việc lưu các setting khác; ẩn option ở portable/non-Windows |
| 4 | `go.mod`: `x/sys` indirect -> direct; chưa xác minh `go.sum` đủ hash cho `x/sys/windows/registry` | low | `go mod tidy`; nếu thiếu hash thì báo người dùng (go.sum bị chặn ghi) |
| 5 | Bỏ `SegmentedControl` ngôn ngữ làm vỡ test `MainLayout.test.tsx` | low | Cập nhật test ở F4 |
| 6 | Flash nền trắng khi dark theme (`BackgroundColour` cố định `27,38,54`) | low | B5 tuỳ chọn |
| 7 | Font bundle: 4 file woff2 tăng kích thước build; zip bị commit nhầm | low | Chỉ bundle 4 weight cần; ghi chú người dùng tự xoá/ignore zip; giữ giấy phép OFL kèm theo (đổi tên tránh đè `OFL.txt` Nunito) |
| 8 | Font JP: chữ Nhật không có trong Nunito/JetBrains Mono, phụ thuộc fallback hệ thống | low | Khai báo chuỗi fallback hệ thống sau font chọn |

Quy mô sprint sau khi thu hẹp: 5 task backend (B5 tuỳ chọn) + 7 task frontend, gần ngưỡng 10 nhưng chấp nhận được.

## 7. Tiêu chí hoàn thành
- [ ] Unit test frontend đạt coverage C1 ≥ 95% và Lines ≥ 95% cho các file đã đổi (backend Go không có unit test)
- [ ] `go vet ./...`, `go build ./...`, `go tool golangci-lint run ./...` sạch; `tsc --noEmit`, biome, oxlint sạch
- [ ] Bindings sinh lại, frontend không import/gọi sai
- [ ] Nút Setting nằm bên trái nút Download history; modal đổi được theme, font (có JetBrains Mono), ngôn ngữ, khởi động cùng Windows (chỉ Windows bản thường)
- [ ] Mở app: setting load trước khi UI hiện; Lưu ghi trực tiếp `settings.json`; nút Reset đưa form về mặc định
- [ ] Không còn màu hard-code ngoài theme (trừ màu do user chọn cho profile); dark theme đọc được
- [ ] Text mới có đủ en/vi/ja; message code mới có key trong 3 `ipcMessage.json`
- [ ] File zip font không bị commit (người dùng tự xoá/ignore)

## 8. Dời sang sprint-09 (R2 + R3)
Người dùng đã **đồng ý cài** `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`, `@dnd-kit/modifiers` cho sprint đó (dùng `bun add` trong `frontend/`).

Yêu cầu: R2 kéo thả tab (không giới hạn, animation mượt); R3 ghi nhớ số lượng, vị trí, profile của tab, không tự connect.

Câu hỏi và đề xuất (chưa được trả lời chính thức, giữ đề xuất ban đầu):
- Q7: Dùng `@dnd-kit` (core, sortable, utilities, modifiers với `restrictToHorizontalAxis`), hỗ trợ kéo bằng bàn phím; animation do dnd-kit (CSS transform), không thêm lib `motion`.
- Q8: Lưu liên tục, debounce ~500ms.
- Q9: Nhớ tab active + thứ tự + `profileId`; không nhớ bucket/prefix.
- Q10: Profile đã xoá thì giữ tab, `profileId = null`, chỉ xử lý sau khi `loadConnectionProfiles` thành công.
- Q11: Lưu riêng `<DataDir>/tabs.json`, cùng cơ chế atomic write với settings.

Task backend dời:
| # | Task | File |
|---|---|---|
| B1' | Model `TabState` (tabs: id, profileId; activeTab) + input lưu, re-export alias | `models/setting/tab_state.go`, `models/alias.go` |
| B2' | `GetTabState` / `SaveTabState`, đọc/ghi `tabs.json` atomic, validate; thêm `STE005` + key ipcMessage | `internal/modules/setting/submodule_tab_mng.go`, `internal/handlers/setting_handler.go` |

Task frontend dời:
| # | Task | File |
|---|---|---|
| F6 | `tabListStore`: `moveTab(activeId, overId)` (dựng lại object theo thứ tự mới, giữ state tab), `restoreTabs(state)`, `serializeTabs()` | `frontend/src/common/stores/tabListStore.ts` |
| F7 | Kéo thả tab: `DndContext` + `SortableContext` (`horizontalListSortingStrategy`), `PointerSensor` có `activationConstraint` (~5px) + `KeyboardSensor`, tab sortable `memo`, animate bằng `CSS.Transform` | `frontend/src/components/layouts/tab/TabLayout.tsx`, `frontend/src/components/layouts/tab/components/SortableTab.tsx` |
| F8 | `useTabPersistence`: restore khi mount, chuẩn hoá profile đã xoá, debounce save, không save trước khi restore xong, không auto connect | `frontend/src/components/layouts/tab/useTabPersistence.ts`, `TabLayout.tsx` |

i18n dời: `tabLayout.tooltip.dragTab` (en/vi/ja).

Test dời (react-tester): F6 (`moveTab` trước/sau, cùng vị trí no-op, id không tồn tại no-op, giữ state; `restoreTabs` rỗng/`activeTab` hợp lệ/không hợp lệ; `serializeTabs`), F7 (`TabLayout.test.tsx`, `SortableTab.test.tsx`: thứ tự, `onDragEnd` gọi `moveTab` khi `over` khác, bỏ qua khi null/cùng id, click và nút đóng vẫn hoạt động; mock `@dnd-kit/core` vì jsdom không giả lập pointer drag), F8 (`useTabPersistence.test.tsx`: restore thành công, IPC null, profile bị xoá, profile còn, debounce gộp, không save trước restore, unmount huỷ timer; dùng fake timers).

Rủi ro dời: race khi khôi phục (high: cờ `restored`, chỉ chuẩn hoá `profileId` sau khi load profile); ghi đĩa liên tục (low: debounce, so sánh payload); xung đột kéo với click/`Scroller`/`scrollIntoView` (medium); hiệu năng khi kéo nhiều tab (medium: `memo`, transform CSS); test drag trong jsdom khó phủ nhánh (medium: mock dnd-kit, ghi rõ nhánh không test được).
