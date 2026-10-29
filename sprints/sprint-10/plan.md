# Plan sprint-10: Refactor, hiệu năng và UX/UI (chuẩn bị cho 0.0.1-beta.2)

## 1. Tóm tắt yêu cầu
Khớp `requirement.md` đã cập nhật: chỉ còn R1–R3.
- R1: Rà soát và refactor code (Go + FE) **từ sau beta.1** và tồn đọng ở report sprint-07/09; gom code trùng, xoá code chết, bổ sung doc/JSDoc, không đổi hành vi nhìn thấy được. Cập nhật `docs/ARCHITECTURE*.md` nếu kiến trúc đổi: để làm cùng đợt tài liệu ở sprint-11 (mục 9), sprint-10 chỉ ghi vào report những gì cần cập nhật.
- R2: Đánh giá và tối ưu hiệu năng (BE + FE), có số đo trước/sau; mức cao xử lý trong sprint.
- R3: Làm **12 điểm UX/UI** đã duyệt: U1, U2, U3, U4, U7, U8, U9, U10, U11, U12, U13, U14. **Đã bỏ U5 (phím tắt) và U6 (logo/tên ở header).**
- Ngoài phạm vi sprint-10: phát hành `0.0.1-beta.2` (version, CHANGELOG, README, user guide, ảnh, PDF, build installer) chuyển sang **sprint-11**, làm sau khi người dùng merge các PR sprint-10 (xem mục 9).

Kiểm chứng tiền đề (đã đọc code thực tế, 2026-10-29):
- Sprint-07 đã làm (không làm lại): helper `call_helper.go`, tách `uploader_items.go`/`uploader_drop.go`, `lazyModals.ts`, `useObjectPaging`, `TabActionBar`, `UploadFileList`, gỡ lodash/redux, `OBJECT_PAGE_SIZE=20`, `ARCHITECTURE*.md`, công cụ PDF.
- Code mới từ sau beta.1 (sprint 08, 09): Go `internal/modules/setting/**` (6 file, 482 dòng), `internal/handlers/setting_handler.go`, `models/setting/**`; FE `settingStore.ts`, `settingUtils.ts`, `settingConst.ts`, `SettingModal.tsx`, `SelectInput.tsx`, `SwitchInput.tsx`, `tabListStore.ts` (318 dòng), `tabPersistence.ts`, `useTabPersistence.ts`, `SortableTab.tsx`, `TabDragPreview.tsx`, `TabScroller.tsx` (202 dòng), `MotionProvider.tsx`, `motionConst.ts`, `ConnectionProfileItem.tsx`, `ConnectionProfiles.tsx` (virtualized).
- Quy mô: Go `internal` + `models` ngoài sqlc khoảng 6.000 dòng; FE production (không test/locale) khoảng 7.000 dòng; 72 file `*.test.*`. Không có `TODO/FIXME` trong Go/FE (grep).
- `biome.json` nằm ở gốc app (`App/S3Browser/biome.json`), không phải trong `frontend/`.
- Trong UI không có chỗ hiển thị version; sprint này không thêm (Q11).

## 2. Câu hỏi chưa rõ
| # | Câu hỏi | Phương án | Trả lời |
|---|---|---|---|
| Q1 | Danh sách UX/UI? | (a) Dùng Phụ lục C. (b) Người dùng tự đưa. (c) Chỉ mức Cao. | **Làm 12 mục; bỏ U5 và U6** |
| Q2 | Ngưỡng hiệu năng? | (a) Không ngưỡng tuyệt đối, đo trước/sau. | **(a)** |
| Q3 | Ảnh chụp tài liệu? | (a) Chụp lại toàn bộ 21 ảnh x 3 ngôn ngữ. | **(a), thực hiện ở sprint-11** |
| Q4 | Map version Windows? | (a) `0.0.1.2`, chuỗi `0.0.1-beta.2`. | **(a), thực hiện ở sprint-11** |
| Q5 | Phạm vi refactor? | (a) Toàn bộ. (b) Chỉ code sau beta.1 + tồn đọng sprint-07/09. (c) Rà lại toàn bộ. | **(b)** |
| Q6 | Chia branch? | (a) theo module, gộp refactor + hiệu năng + UX cùng file. | **(a), với ràng buộc: các branch hoàn toàn độc lập, không file nào ở 2 branch (mục 5)** |
| Q7 | Tồn đọng mức thấp sprint-07/09? | (a) Làm mục rẻ, không đổi hành vi. | **(a)** |
| Q8 | `biome migrate`? | (a) Chạy. | **(a), đặt ở branch cuối, không ai phụ thuộc** |
| Q9 | Xoá `ResetSettings`? | (a) Xoá + sinh lại bindings. | **(a)** |
| Q10 | Xoá `V000003`? | (a) Xoá. | **(a)** |
| Q11 | Hiển thị version trong app? | (a) Không thêm. | **(a)** |
| Q12 | Ai làm phần phát hành? | (a) `react-frontend` sửa văn bản/config, người dùng tự build NSIS. | **(a), áp dụng ở sprint-11** |
| Q13 | Installer NSIS? | (a) Người dùng cài NSIS và chạy `package`. | **(a), sprint-11** |
| Q14 | VersionInfo exe trống? | (a) Điều tra có giới hạn. (b) Ghi tồn đọng. | **(b): ghi tồn đọng, chuyển sprint-11** |
| Q15 | Lazy `UploadPickerModal`/`UploadLimitModal`? | (a) Lazy cả hai, đo bundle. | **(a)** |
| Q16 | Smoke test? | (a) Người dùng smoke test cuối sprint. | **(a)** |
| Q17 | `.gitignore`? | (a) Chỉ thêm `frontend/coverage/`. | **(a)** |
| Q19 | (còn chờ) U8 (nền cửa sổ native nháy trắng với theme `auto` trên OS dark) có thể chỉ sửa được ở Go (`main.go`: màu nền cửa sổ); U9 đổi hex sang `var(--mantine-color-*)` có thể lệch nhẹ màu header modal ở light theme. Chấp nhận? | (a) **(đề xuất)** Cho phép sửa `main.go` (B2) cho U8 nếu tái hiện được, không đổi model/handler; U9 chấp nhận lệch nhẹ, người dùng xem ở smoke test và báo nếu muốn giữ màu cũ. (b) U8 chỉ ghi vào report nếu cần sửa native. (c) U9 giữ hex gốc trong `light-dark()` (không sửa). | (a) |

### 2.1 Quyết định đã chốt
- **Branch độc lập (K1):** mỗi branch tách từ `origin/master`, không dùng code của branch khác, không có file (kể cả file test, locale) nằm ở hai branch. Quy trình git-flow chỉ push + PR ở B6 và cấm `rebase`/`merge`, nên không có phụ thuộc giữa branch; thứ tự thực hiện (mục 6) chỉ để tuần tự hoá. Đây là **quy ước của plan** (luật 8 chỉ yêu cầu C1 ≥ 95% mỗi file đổi, không quy định số branch).
- **Hợp đồng giữa branch:** không branch nào đổi chữ ký export (hàm, hook, store action, props, binding) mà file ở branch khác đang dùng; không thêm/xoá key i18n ngoài namespace thuộc file của chính branch; không thêm/xoá message code Go.
- **Phát hành sang sprint-11:** xem mục 9.
- **K3:** `useConnectProfile` chỉ gom phần gọi IPC (`ConnectS3ByProfile` + `updateConnectionProfiles`); trạng thái connecting giữ **cục bộ mỗi nơi** như cũ (`ConnectionProfiles` có `connectingRef` + `connectingKeys`, `TabDetail` không chặn re-entry).
- **Q5=b, Q14=b:** chỉ rà code sau beta.1 và tồn đọng; VersionInfo exe trống chỉ ghi tồn đọng.

## 3. Task backend (go-backend)
Mỗi task tự pass `go build ./...`, `go vet ./...`, `go tool golangci-lint run ./...`. Không đổi hành vi. Không viết unit test Go. Không thêm/xoá message code Go.

| # | Task | Yêu cầu | File sửa / tạo | Phụ thuộc |
|---|---|---|---|---|
| B1 | Setting + tab persistence: gom `path()` trùng ở `submoduleFileMng`/`submoduleTabMng`; chuyển `writeJSONAtomic` ra `json_file.go`; thêm `Sync()` trước `Rename` (đo thời gian Save trước/sau vì `FlushFileBuffers` trên Windows có thể chậm trên HDD); doc cho `defaultSettings`, `sanitize`, `validate`; **xoá `ResetSettings`** (handler + module) rồi sinh lại bindings. Ghi rõ lock: `submoduleTabMng` có `sync.Mutex`, `submoduleFileMng` (settings) không, lock nằm ở `submoduleSettingMng`; khi gom giữ nguyên cơ chế lock hiện tại (không thêm lock mới), ghi vào comment | R1, R2 | `internal/modules/setting/submodule_file_mng.go` (sửa), `json_file.go` (tạo), `submodule_tab_mng.go` (sửa), `submodule_setting_mng.go` (sửa), `module.go` (sửa), `internal/handlers/setting_handler.go` (sửa) | - |
| B2 | Hạ tầng + module dùng chung + handler: doc comment exported (revive `exported` bằng config tạm ở scratchpad), import thừa, hằng không dùng, rà `app.go`, `global`, `master`, `profile`, handler bucket/master/profile, `internal/pkg/**` (trừ `db/sqlc/**`), `models/**`. **Có điều kiện (U8, Q19):** nếu tái hiện được nền native nháy trắng với theme `auto` trên OS dark thì chỉnh màu nền cửa sổ trong `main.go` (chưa xác minh `main.go` làm gì hiện tại; không đổi model/handler) | R1, R3 (U8) | `main.go`, `internal/app.go`, `internal/config.go`, `internal/modules/{global,master,profile}/*.go`, `internal/handlers/{bucket,master,profile}_handler.go`, `internal/pkg/{utils,cnst,logger,portable,db}/*.go`, `models/**` (trừ file sinh) | - |
| B3 | Module bucket (hiệu năng): lock giữ lâu, `os.Stat` tuần tự trong `groupUploadItems`, `Lstat` trong `destsMu`, số connection tải đồng thời (chỉ đổi nếu đo được lợi), rò rỉ context/goroutine, gọi S3 thừa, cấp phát; doc cho phần mới | R1, R2 | `internal/modules/bucket/*.go` | - |
| B4 | Rà message: key trong `ipcMessage.json` ↔ mã Go (chỉ **đọc** Go, không sửa), xoá key mồ côi trong JSON, xoá `V000003` ở `validateMessage.json`; kiểm chứng key i18n không dùng của các namespace khác chỉ để **báo cáo** (mỗi branch tự xoá key của namespace mình) | R1 | `frontend/src/locales/{en,vi,ja}/messages/ipcMessage.json`, `frontend/src/locales/{en,vi,ja}/messages/validateMessage.json` | - |

Message code mới: không  |  Migration / sqlc: không  |  Cần sinh lại bindings: **có**, chỉ ở branch `be_setting_cleanup` (xoá `ResetSettings`; FE không dùng API này, đã grep). `frontend/bindings/**` không được git track nên không làm các branch khác lệch.

## 4. Task frontend (react-frontend)
Mỗi file đổi phải đạt C1 ≥ 95% và Lines ≥ 95%, nên refactor + JSDoc + UX/UI của cùng một file làm trong cùng một task. Mọi mục U: i18n en/vi/ja trong namespace của chính task, light/dark, console sạch. Các F không phụ thuộc nhau.

| # | Task | Yêu cầu | File sửa / tạo | Phụ thuộc |
|---|---|---|---|---|
| F1 | Nền chung: JSDoc store/util/hook (`uploaderStore`, `downloaderStore`, `modalStackStore`, `createStore`, `ipcUtils`, `modalUtils`, `uploadUtils`, `useFieldError`, `tabListStore`); helper `resetTabView` cho `resetViewByProfile`/`clearProfile`; `Object.hasOwn` thay `in` (`closeTab`, `restoreTabs`); `useAutoLoading`: `void result.finally(...)` tạo promise mới bị reject nên sinh unhandled rejection, bắt bằng `.catch(noop)`; `Button`/`ActionIcon` JSDoc; thêm `frontend/coverage/` vào `.gitignore`; gỡ hằng/export không dùng (grep). Giữ nguyên chữ ký export | R1, R2 | `frontend/src/common/stores/{tabListStore,uploaderStore,downloaderStore,modalStackStore,createStore}.ts`, `frontend/src/common/utils/{ipcUtils,modalUtils,uploadUtils,stringUtils}.ts`, `frontend/src/common/hooks/useFieldError.ts`, `frontend/src/components/buttons/{useAutoLoading.ts,Button.tsx,ActionIcon.tsx}`, `.gitignore` | - |
| F2 | Khởi động + profile + kết nối + lazy modal (gộp P1, P2, U11, U1, U13, U14, A2, Q15 vì cùng chạm `main.tsx`, `App.tsx`, `ConnectionProfiles.tsx`, `TabDetail.tsx`, `lazyModals.ts`): (1) `main.tsx` chạy `useSettingStore.load()` và `GetTabState` song song bằng `Promise.all`; logic khởi động đưa ra hàm trong `common/utils/` để test. (2) **Thiết kế K4:** profile chỉ nạp một lần ở `App` (effect có cleanup `reset()` giống `loadAll`/`reset` của master data, chạy được dưới `StrictMode`: mount -> unmount -> mount), sau đó chạy `normalizeTabProfiles`; `ConnectionProfiles` bỏ `loadConnectionProfiles()` trong `useEffect` **và** bỏ `reset()` ở cleanup (nếu chỉ bỏ load mà giữ `reset()` thì danh sách rỗng ở dev); vì `App` đã mount `Toaster`, toast lỗi tải profile hiện được (U11). Có đo số lần gọi IPC và thời gian tới render đầu. (3) `App.tsx` key theo `path`. (4) `useTabPersistence`: giữ selector hiện tại (trả chuỗi nên chỉ re-render khi payload đổi); chỉ đổi sang `store.subscribe` nếu đo thấy lợi (với immer so tham chiếu `tabList` không đủ); `tabPersistence.ts` JSDoc. (5) Hook `useConnectProfile` chỉ gom phần gọi IPC dùng chung (K3), state connecting giữ cục bộ ở `ConnectionProfiles` và `TabDetail`. (6) **U1** trạng thái rỗng danh sách profile; **U14** kiểm tương phản trạng thái kết nối AA ở light/dark. (7) **Lazy (Q15, K2):** thêm `showUploadPickerModal` và `showUploadLimitModal` vào `lazyModals.ts` (file chỉ nằm ở branch này), `TabDetail.tsx` và `useFilesDroppedUpload.ts` đổi sang gọi bản lazy. Chunk lỗi: wrapper có `.catch(onLoadModalFailed)` nên trả `undefined`, caller phải coi là huỷ (không chạy tiếp upload). Tách lỗi tải chunk khỏi lỗi trong `show()` (A10). **U13** loading ngắn khi chunk tải chậm. (8) `ConnectModal`/`connectSchema` JSDoc, rà **U10** màn hình của task | R1, R2, R3 (U1, U11, U13, U14, U10) | `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/src/common/utils/tabPersistence.ts`, `frontend/src/common/stores/profileStore.ts`, `frontend/src/common/hooks/useConnectProfile.ts` (tạo), `frontend/src/components/layouts/tab/useTabPersistence.ts`, `frontend/src/components/layouts/tab/components/TabDetail.tsx`, `frontend/src/components/layouts/navbar/components/{ConnectionProfiles,ConnectionProfileItem}.tsx`, `frontend/src/components/modals/{ConnectModal,connectSchema,lazyModals}.ts(x)`, `frontend/src/pages/object/useFilesDroppedUpload.ts`, locale `connectionProfiles.json`, `connectModal.json`, `common.json` x3 | - |
| F3 | Thanh tab + layout: rà `TabLayout`, `SortableTab`, `TabDragPreview`, `TabLabel`, `MainLayout` (bỏ `<Group gap="xs"></Group>` rỗng, A5). `TabScroller` đã xác minh gỡ listener đủ (dòng 60-69, 119), chỉ JSDoc nếu cần. **U3:** chỉ bật tooltip/cursor kéo thả khi ≥ 2 tab; Space/Enter chọn tab thay vì bắt đầu kéo bằng cách đổi `keyboardCodes` của `KeyboardSensor` (giữ sensor để không mất a11y bàn phím). **U4:** layout animation khi đóng tab bằng `m`/`LazyMotion`, tôn trọng `reducedMotion`. **U10** cho màn hình của task | R1, R2, R3 (U3, U4, U10) | `frontend/src/components/layouts/tab/TabLayout.tsx`, `frontend/src/components/layouts/tab/components/{TabScroller,SortableTab,TabDragPreview,TabLabel}.tsx`, `frontend/src/components/layouts/MainLayout.tsx`, `frontend/src/common/cnst/motionConst.ts`, `frontend/src/components/providers/MotionProvider.tsx`, locale `tabLayout.json` x3 | - |
| F4 | Bucket + object: rà `ObjectListView`, `BucketListView`, `ObjectItem`, `BucketItem`, `useObjectPaging`, `ObjectDetailDrawer`, `TabActionBar`, `TabBreadcrumb`, `SearchInput`, `FieldInput`, `BucketPicker`, `Combobox`, `RegionCombobox`, `ComboboxClearButton`, `useSelectCombobox`. **U2:** trạng thái rỗng "Chưa có bucket"/"Thư mục trống" (key trong `bucket/page.json`, `object/page.json`). **U10** cho màn hình của task. Không sửa `useFilesDroppedUpload.ts` (thuộc F2) và `tabLayout.json` (thuộc F3) | R1, R2, R3 (U2, U10) | `frontend/src/pages/{bucket,object}/**` (trừ `useFilesDroppedUpload.ts`), `frontend/src/components/layouts/tab/components/{TabActionBar,TabBreadcrumb,ObjectDetailDrawer}.tsx`, `frontend/src/components/inputs/{SearchInput,FieldInput}.tsx`, `frontend/src/components/inputs/combobox/**`, locale `bucket/page.json`, `object/page.json`, `objectDetailDrawer.json`, `bucketPicker.json`, `inputs.json` x3 | - |
| F5 | Upload/download: rà `UploadPickerModal`, `UploadLimitModal`, `UploadFileList`, `HistoryModal`, `ConfirmModal`, `UploaderWindow`, `DownloaderWindow`, items. **U12:** virtualize `DownloaderWindow`, giữ kích thước cửa sổ (nó dùng để xếp `UploaderWindow`). `memo(FileRow)` vô tác dụng (style object mới). **U10** cho màn hình của task. Không sửa `lazyModals.ts`, `TabDetail.tsx`, `useFilesDroppedUpload.ts` (thuộc F2); modal vẫn export default như cũ để wrapper lazy của F2 dùng được | R1, R2, R3 (U12, U10) | `frontend/src/components/modals/{UploadPickerModal,UploadLimitModal,UploadFileList,HistoryModal,ConfirmModal}.tsx`, `frontend/src/components/layouts/{uploader,downloader}/**`, locale `uploadPickerModal.json`, `uploadLimitModal.json`, `historyModal.json`, `confirmModal.json`, `uploaderWindow.json`, `downloaderWindow.json` x3 | - |
| F6 | Setting + input dùng chung của setting: `SettingModal`, `settingStore`, `settingUtils`, `settingConst`, `SelectInput`, `SwitchInput`, `CheckBoxInput`, `SegmentedControl`, `modalColors`. **U7:** trong lúc Save khoá Hủy/Reset/Apply/X. **U8 (FE):** kiểm theme `auto` + `colorScheme` ngay lúc vào app; phần native ở B2 (Q19). **U9:** hex trong `modalColors` -> `var(--mantine-color-*)` (Q19). **U10** | R1, R3 (U7, U8, U9, U10) | `frontend/src/components/modals/{SettingModal.tsx,modalColors.ts}`, `frontend/src/common/stores/settingStore.ts`, `frontend/src/common/utils/settingUtils.ts`, `frontend/src/common/cnst/settingConst.ts`, `frontend/src/components/inputs/{SelectInput,SwitchInput,CheckBoxInput,SegmentedControl}.tsx`, locale `settingModal.json` x3 | - |
| F7 | Cấu hình + kiểm chứng i18n: chạy `biome migrate` (Q8); script tạm ở scratchpad đối chiếu key en/vi/ja cùng tập và `resource.ts` đăng ký đủ; **chỉ báo cáo** key không dùng của namespace khác (mỗi branch tự xoá key của mình) | R1 | `biome.json` (gốc app, không phải `frontend/`), `frontend/src/locales/{en,vi,ja}/resource.ts` (chỉ sửa nếu thiếu đăng ký) | - |

i18n key mới (en/vi/ja), chỉ trong namespace của task: F2 `profile.empty`, nhãn loading modal; F3 tooltip kéo thả; F4 `bucket.empty`, `object.emptyFolder`. Tên key chốt khi làm.

### Test frontend (react-tester)
Test nằm cùng branch với file production; mỗi file đổi đạt C1 ≥ 95% và Lines ≥ 95%.

| Task | File cần test | Case cần phủ |
|---|---|---|
| F1 | `src/test/common/stores/{tabListStore,uploaderStore,downloaderStore,modalStackStore,createStore}.test.ts`, `src/test/common/utils/{ipcUtils,modalUtils,uploadUtils,stringUtils}.test.ts`, `src/test/common/hooks/useFieldError.test.tsx`, `src/test/components/buttons/{useAutoLoading,Button,ActionIcon}.test.tsx` | `resetViewByProfile`/`clearProfile` dùng helper (khớp / không khớp / tab khác không đổi); `closeTab` (không tồn tại, còn 1 tab, đóng tab active chọn kế tiếp / lùi, không active); `restoreTabs` (id trùng, rỗng, active không có trong danh sách, `Object.hasOwn`); `useAutoLoading`: `onClick` reject không sinh unhandled rejection, loading bật/tắt đúng |
| F2 | `src/test/App.test.tsx`, test hàm khởi động mới trong `common/utils/`, `src/test/common/utils/tabPersistence.test.ts`, `src/test/common/stores/profileStore.test.ts`, `src/test/common/hooks/useConnectProfile.test.tsx`, `src/test/components/layouts/tab/useTabPersistence.test.ts`, `.../tab/components/TabDetail.test.tsx`, `.../navbar/components/{ConnectionProfiles,ConnectionProfileItem}.test.tsx`, `src/test/components/modals/{ConnectModal,connectSchema,lazyModals}.test.tsx`, `src/test/pages/object/useFilesDroppedUpload.test.tsx` | Khởi động: `GetTabState` lỗi (không ghi đè `tabs.json`), setting lỗi dùng mặc định, chạy song song vẫn restore đúng; `App` **mount -> unmount -> mount** (StrictMode): profile được nạp lại, danh sách không rỗng, `normalizeTabProfiles` idempotent, toast lỗi tải profile hiện; `ConnectionProfiles` unmount không gọi `reset()`; hook: thành công / `callIPC` null / thiếu accessKey mở modal (ở `TabDetail`) / đã connected; `ConnectionProfiles` vẫn chặn re-entry, `TabDetail` không chặn (như cũ); rỗng -> empty state (U1); tương phản trạng thái (U14); auto-connect một lần; xoá profile (đang connected, huỷ, bị từ chối); `lazyModals`: chunk tải xong / chunk lỗi trả `undefined` (toast + `console.error` spy) / lỗi trong `show()` không báo nhầm lỗi tải chunk / loading khi chậm (U13); caller (`TabDetail` upload picker, `useFilesDroppedUpload` limit modal) coi `undefined` là huỷ, **không** chạy tiếp upload |
| F3 | `src/test/components/layouts/tab/{TabLayout,TabLayoutNoScroller}.test.tsx`, `.../tab/components/{TabScroller,SortableTab,TabDragPreview,TabLabel}.test.tsx`, `src/test/components/layouts/MainLayout.test.tsx`, `src/test/components/providers/MotionProvider.test.tsx` | 1 tab (không closable, không cursor grab, không tooltip) và nhiều tab; kéo thả (end có over / không over / cancel); Space/Enter chọn tab và phím mũi tên vẫn hoạt động; layout animation bật/tắt theo `reducedMotion` (mock `motion` bằng `mockMotion`); header không còn group rỗng |
| F4 | `src/test/pages/object/{ObjectListView,ObjectItem,useObjectPaging}.test.tsx`, `src/test/pages/bucket/{BucketListView,BucketItem}.test.tsx`, `.../tab/components/{TabActionBar,TabBreadcrumb,ObjectDetailDrawer}.test.tsx`, `src/test/components/inputs/{SearchInput,FieldInput}.test.tsx`, `src/test/components/inputs/combobox/**` | rỗng không từ khoá (bucket / thư mục) và rỗng khi tìm; load more lỗi; list lớn (virtualizer thật); huỷ request khi unmount |
| F5 | `src/test/components/modals/{UploadPickerModal,UploadLimitModal,UploadFileList,HistoryModal,ConfirmModal}.test.tsx`, `src/test/components/layouts/{uploader,downloader}/**` | danh sách file rỗng / vượt giới hạn; `DownloaderWindow` virtualizer thật; footer Hủy trái, nút phải; `FileRow` render ổn định |
| F6 | `src/test/components/modals/{SettingModal,SettingModalClear,modalColors}.test.tsx`, `src/test/common/stores/settingStore.test.ts`, `src/test/common/utils/settingUtils.test.ts`, `src/test/components/inputs/{SelectInput,SwitchInput,SimpleInputs}.test.tsx` | Save thành công / lỗi / backend giữ `launchOnStartup` cũ (STE003); trong lúc Save khoá Hủy/Reset/Apply/X (U7); Apply, Cancel, Reset; autostart ẩn khi không hỗ trợ; theme `auto` (U8); `modalColors` không còn hex (U9, cập nhật assert cũ `toContain('#d0ebff')`) |
| F7 | không có file production đổi (`biome.json`, `resource.ts` không thuộc coverage) | kiểm chứng bằng `biome check`, script đối chiếu key (không commit) |

Console sạch: test cố ý đi vào nhánh lỗi dùng `vi.spyOn(console, 'error')` và assert.

## 5. Branch
10 branch, tách từ `origin/master`, độc lập hoàn toàn. Mỗi file chỉ nằm ở đúng một branch (kể cả file test và locale).

| Branch | Yêu cầu | Task | File chính dự kiến sửa |
|---|---|---|---|
| SP-10/be_setting_cleanup | R1, R2 | B1 | `internal/modules/setting/*.go`, `internal/handlers/setting_handler.go`, `json_file.go` (mới); sinh lại bindings |
| SP-10/be_core_refactor | R1, R3 (U8 có điều kiện) | B2 | `main.go`, `internal/app.go`, `internal/config.go`, `internal/modules/{global,master,profile}/*.go`, `internal/handlers/{bucket,master,profile}_handler.go`, `internal/pkg/**`, `models/**` |
| SP-10/be_bucket_perf | R1, R2 | B3 | `internal/modules/bucket/*.go` |
| SP-10/fe_common_utils | R1, R2 | F1 | `common/stores/{tabListStore,uploaderStore,downloaderStore,modalStackStore,createStore}.ts`, `common/utils/{ipcUtils,modalUtils,uploadUtils,stringUtils}.ts`, `common/hooks/useFieldError.ts`, `components/buttons/**`, `.gitignore` |
| SP-10/fe_startup_profiles | R1, R2, R3 (U1, U10, U11, U13, U14) | F2 | `main.tsx`, `App.tsx`, `common/utils/tabPersistence.ts`, `common/stores/profileStore.ts`, `common/hooks/useConnectProfile.ts` (mới), `tab/useTabPersistence.ts`, `tab/components/TabDetail.tsx`, `navbar/components/{ConnectionProfiles,ConnectionProfileItem}.tsx`, `modals/{ConnectModal,connectSchema,lazyModals}`, `pages/object/useFilesDroppedUpload.ts` |
| SP-10/fe_tabs_layout | R1, R2, R3 (U3, U4, U10) | F3 | `tab/TabLayout.tsx`, `tab/components/{TabScroller,SortableTab,TabDragPreview,TabLabel}.tsx`, `layouts/MainLayout.tsx`, `common/cnst/motionConst.ts`, `providers/MotionProvider.tsx`, `tabLayout.json` x3 |
| SP-10/fe_bucket_object | R1, R2, R3 (U2, U10) | F4 | `pages/{bucket,object}/**` (trừ `useFilesDroppedUpload.ts`), `tab/components/{TabActionBar,TabBreadcrumb,ObjectDetailDrawer}.tsx`, `inputs/{SearchInput,FieldInput}.tsx`, `inputs/combobox/**` |
| SP-10/fe_transfer_modals | R1, R2, R3 (U12, U10) | F5 | `modals/{UploadPickerModal,UploadLimitModal,UploadFileList,HistoryModal,ConfirmModal}.tsx`, `layouts/{uploader,downloader}/**` |
| SP-10/fe_setting_modal | R1, R3 (U7, U8, U9, U10) | F6 | `modals/{SettingModal,modalColors}`, `settingStore.ts`, `settingUtils.ts`, `settingConst.ts`, `inputs/{SelectInput,SwitchInput,CheckBoxInput,SegmentedControl}.tsx` |
| SP-10/cleanup_messages_config | R1 | B4, F7 | `locales/{en,vi,ja}/messages/{ipcMessage,validateMessage}.json`, `biome.json`, `locales/*/resource.ts` (nếu thiếu đăng ký) |

**Xác nhận không có file ở hai branch** (đã phân hoạch theo thư mục/file; kiểm lại bằng `git diff --name-only origin/master` của từng branch trước khi push, trùng tên file thì dừng và báo):
- `lazyModals.ts`, `TabDetail.tsx`, `useFilesDroppedUpload.ts` chỉ ở `fe_startup_profiles`; `UploadPickerModal`/`UploadLimitModal` (file modal) chỉ ở `fe_transfer_modals` và giữ nguyên export.
- `tabLayout.json` chỉ ở `fe_tabs_layout`; `bucket/page.json`, `object/page.json` chỉ ở `fe_bucket_object`; `common.json` chỉ ở `fe_startup_profiles`.
- `ipcMessage.json`, `validateMessage.json`, `biome.json` chỉ ở `cleanup_messages_config`; không branch nào khác thêm/xoá message code.
- `.gitignore` chỉ ở `fe_common_utils`; `main.go` chỉ ở `be_core_refactor`; `models/**` chỉ ở `be_core_refactor`.
- Component dùng chung bị nhiều nơi gọi (`modalColors`, input wrapper, `Button`, `ActionIcon`) chỉ đổi nội bộ, không đổi chữ ký.

## 6. Thứ tự thực hiện (tuần tự cho tiện điều phối; không có phụ thuộc giữa branch)
Thứ tự gợi ý: `be_setting_cleanup` -> `be_core_refactor` -> `be_bucket_perf` -> `fe_common_utils` -> `fe_startup_profiles` -> `fe_tabs_layout` -> `fe_bucket_object` -> `fe_transfer_modals` -> `fe_setting_modal` -> `cleanup_messages_config`. Đổi thứ tự không ảnh hưởng kết quả.

Với từng branch:
1. Tách branch từ `origin/master` (git-flow).
2. Backend: các task B của branch.
3. `go tool wails3 generate bindings -clean=true -ts` qua skill `wails3-bindings`: **chỉ ở `be_setting_cleanup`**.
4. Frontend: các task F của branch.
5. FE test (react-tester) -> verify (`go build/vet`, golangci-lint, biome, oxlint, `tsc --noEmit`, vitest + coverage per-file) -> review -> commit (git-flow). Tối đa 3 vòng mỗi branch. Branch phải tự pass trên nền `master`.

Đo hiệu năng (R2): baseline lấy **trước khi** đổi code ở đầu sprint, ghi vào `sprints/sprint-10/baseline.md`: thời gian khởi động tới render đầu, số lần gọi `loadConnectionProfiles`, bundle gzip (`zlib.gzipSync`, như sprint-07), mở bucket 1.000 object trên MinIO/Floci, số render `TabDetail`, thời gian Save settings (B1 `Sync()`). Cập nhật cột "sau" sau mỗi branch.

## 7. Rủi ro
| # | Rủi ro | Mức độ | Cách giảm thiểu |
|---|---|---|---|
| R-01 | Phạm vi lớn: 11 task (> 10) và 10 branch; thêm 12 mục UX/UI | high | Branch nhỏ, tự pass; mỗi mục U ghi trước/sau; branch tới vòng 3 chưa đạt thì dừng và hỏi, không tự cắt mục đã duyệt |
| R-02 | Hai branch vô tình sửa cùng file (đặc biệt `lazyModals.ts`, `TabDetail.tsx`, locale dùng chung) làm PR conflict khi merge, vì git-flow cấm `rebase`/`merge` | high | Phân hoạch mục 5; trước khi push, kiểm `git diff --name-only` giao nhau giữa các branch; không đổi chữ ký export; không thêm/xoá key ngoài namespace của branch |
| R-03 | Lazy modal (K2): chunk lỗi trả `undefined`; nếu caller không coi là huỷ thì upload chạy tiếp | high | Test bắt buộc cho `TabDetail` và `useFilesDroppedUpload` (xem bảng test F2); wrapper tách lỗi chunk khỏi lỗi `show()` |
| R-04 | Tối ưu khởi động (K4): bỏ nạp profile lần 2 mà giữ `reset()` làm danh sách rỗng dưới `StrictMode`; thay đổi thứ tự (render trước, `normalize` sau) làm tab có profile đã xoá hiện thoáng qua trước khi bị gỡ; lỗi `GetTabState` vẫn phải chặn ghi đè `tabs.json` | high | Thiết kế ở F2 (nạp ở `App` + cleanup `reset()`), test mount/unmount/remount; giữ cờ `restoreFailed`; đo trước/sau, không đo được lợi thì hoàn tác |
| R-05 | Refactor đổi hành vi ngoài ý muốn; smoke test thủ công sprint-07/08/09 chưa làm | high | Test hồi quy; checklist smoke test cuối sprint (Q16): S3 + MinIO, light/dark, 3 ngôn ngữ, 3 font, restart ghi nhớ tab |
| R-06 | `useConnectProfile` làm đổi hành vi connect (K3) | medium | Chỉ gom phần gọi IPC; state connecting cục bộ giữ nguyên; test hai nơi gọi khác nhau (có/không chặn re-entry) |
| R-07 | Luật 8: file đổi (kể cả chỉ thêm comment) phải đạt C1/Lines ≥ 95%; `HistoryModal` 97,43%, `UploadPickerModal` 96,96% sát ngưỡng | medium | Gộp refactor + JSDoc + UX cùng một lần đổi mỗi file; kiểm coverage baseline từng file trước khi sửa |
| R-08 | Test flaky khi máy tải nặng (`UploadLimitModal.test.tsx`, `SettingModal.test.tsx`) | medium | react-tester gia cố test (`findBy`/`waitFor`, không timer thật), chạy lại xác nhận |
| R-09 | U9 lệch nhẹ màu header modal ở light theme; U8 phụ thuộc native Wails, chưa tái hiện | medium | Q19; chụp so sánh trước/sau; U8 không sửa được trong 1 vòng thì ghi vào report là giới hạn native |
| R-10 | U4 layout animation / U13 loading có thể flicker hoặc sinh warning (key, motion) | medium | Dùng `m` + `LazyMotion` sẵn có, `reducedMotion`; `mockMotion` trong test; smoke test |
| R-11 | U12 virtualize `DownloaderWindow` có thể lệch layout `UploaderWindow` | medium | Giữ kích thước cửa sổ; test virtualizer thật; lệch thì hoàn tác phần virtualize và ghi lại |
| R-12 | B1 `Sync()` trước `Rename` có thể làm Save chậm trên HDD; gom `writeJSONAtomic` có thể đổi lock (`submoduleTabMng` có mutex, settings thì không) | low | Đo thời gian Save trước/sau, giữ nếu chấp nhận được; giữ nguyên cơ chế lock và ghi vào comment |
| R-13 | Bindings sinh lại (xoá `ResetSettings`) làm FE/BE lệch | low | Skill `wails3-bindings` trong `be_setting_cleanup`; `tsc --noEmit` pass; FE không dùng API này (grep) |
| R-14 | Lệch quy ước `CLAUDE.md` (hook ngoài `components/`, `lazyModals`, `motion`/`@dnd-kit`, `writeJSONAtomic`, `renderWithProviders`) | low | Ghi vào report mục "Cần cập nhật CLAUDE.md" |
| R-15 | `useTabPersistence` đổi sang `store.subscribe` có thể sai vì immer so tham chiếu `tabList` | low | Giữ selector hiện tại (trả chuỗi); chỉ đổi nếu đo thấy lợi |

## 8. Tiêu chí hoàn thành
- [ ] Mọi file frontend đã đổi đạt Branches (C1) ≥ 95% và Lines ≥ 95% (per-file); Go không có unit test
- [ ] `go build ./...`, `go vet ./...`, `go tool golangci-lint run ./...`, `biome check`, `oxlint`, `tsc --noEmit` pass trên từng branch
- [ ] Console sạch: không warning/error React, không `stderr |` khi chạy `vitest run`
- [ ] Mỗi branch tự pass trên nền `origin/master`; `git diff --name-only` của các branch không giao nhau
- [ ] `report.md` có: danh sách refactor (file, lý do), bảng hiệu năng (vấn đề, mức, xử lý, kết quả, số đo trước/sau), danh sách UX/UI đã sửa (12 mục: màn hình, trước/sau; mục không tái hiện/không làm được ghi lý do)
- [ ] Không còn code chết, import thừa, key i18n không dùng (kiểm bằng `unused`, `tsc`, oxlint, script đối chiếu key); 3 ngôn ngữ cùng tập key
- [ ] Hàm/type exported Go có doc comment (revive `exported`, config tạm); util/hook/store frontend có JSDoc
- [ ] Mọi chức năng hiện có hoạt động như trước (smoke test S3 + MinIO do người dùng chạy)
- [ ] Mục hiệu năng mức cao đã xử lý; mức thấp có ghi lại; không chức năng nào chậm hơn baseline, bundle không tăng
- [ ] Giao diện đúng ở light/dark, 3 ngôn ngữ; font đổi không nhảy layout
- [ ] `ResetSettings` đã xoá, bindings sinh lại, `tsc --noEmit` pass
- [ ] Đề xuất cập nhật `CLAUDE.md` và `docs/ARCHITECTURE*.md` (nếu có) được liệt kê trong report

## 9. Chuyển sang sprint-11 (phát hành 0.0.1-beta.2, ngoài phạm vi sprint-10)
Làm sau khi người dùng merge các PR sprint-10, để ảnh chụp đúng giao diện cuối và CHANGELOG đủ nội dung. Giữ lại các ghi chú để dùng khi lập `sprints/sprint-11`:
- **D1 Version `0.0.1-beta.1` -> `0.0.1-beta.2`** (Q4=a, map Windows `0.0.1.2`): `build/config.yml`, `frontend/package.json`, `build/windows/info.json` (`file_version`, `ProductVersion`), `build/windows/wails.exe.manifest`, `build/windows/nsis/wails_tools.nsh`, `build/windows/nsis/project.nsi` (`INFO_NUMERIC_VERSION`), `build/linux/nfpm/nfpm.yaml` (`prerelease`), badge `README{,.vi,.ja}.md`, và **`docs/user-guide/{en,vi,ja}/user-guide.md` (dòng 3 và dòng 22 của bản en; vi/ja chưa xác minh vị trí, phải grep `beta.1`)** (S2). `build/darwin/Info*.plist` và `build/ios/*` giữ `0.0.1`.
- **K5: cấm chạy `go tool wails3 task common:update:build-assets`.** Map version Windows là sửa tay (`file_version 0.0.1.1`, manifest, `INFO_NUMERIC_VERSION`); lệnh này sinh lại file `build/**` và ghi đè.
- **D2 CHANGELOG** (3 ngôn ngữ): đổi `[Unreleased]` thành `[0.0.1-beta.2] - <ngày>`; thêm Setting/dark theme (đã có), kéo thả tab, ghi nhớ tab, danh sách profile virtualized, và các thay đổi UX/UI + hiệu năng của sprint-10 (theo `report.md` sprint-10).
- **D3 README + user guide + ARCHITECTURE:** tab kéo thả/ghi nhớ (`tabs.json`), `@dnd-kit`, `motion`/`MotionProvider`, `useTabPersistence`, hook/store mới của sprint-10 (phần `docs/ARCHITECTURE*.md` của R1 làm ở đây, dựa trên mục "Cần cập nhật" trong report sprint-10); chụp lại toàn bộ 21 ảnh x 3 ngôn ngữ (Q3=a) bằng `docs/scripts/shots.mjs` (bỏ ảnh `02-language-switch` không còn dùng), MinIO chỉ có bucket `demo-*`; sinh lại PDF (`bun run --cwd docs build:pdf`). Hiện `docs/ARCHITECTURE.md` không nhắc `dnd`/`motion`/`tabs.json` (grep = 0).
- **D4 Build kiểm chứng:** agent chạy `go tool wails3 task build` và `build:portable WEBVIEW2_DIR=...`; **người dùng** cài NSIS và chạy `go tool wails3 task package` (Q13=a), kiểm Properties -> Details và `DisplayVersion`; xoá `build/bin/S3Browser-portable/data/*` trước khi đóng gói.
- **D5 (Q14=b, tồn đọng):** chuỗi VersionInfo của exe trống (`ProductName`... đọc ra rỗng, fixed version số vẫn đúng; có từ trước, nguyên nhân chưa rõ); điều tra ở sprint sau.
- Người thực hiện: `react-frontend` sửa văn bản/config (Q12=a).

---

## Phụ lục A. Điểm refactor đã xác định (đã đọc code)
Ưu tiên: Cao / Trung / Thấp. Mọi mục không đổi hành vi.

| # | Vị trí | Vấn đề | Đề xuất | Ưu tiên | Task |
|---|---|---|---|---|---|
| A1 | `tabListStore.ts` `resetViewByProfile` và `clearProfile` | Khối reset `currentView/bucket/prefix/selectionItem/detailItem` lặp 2 lần (và gần giống `changeCurrentView`) | Helper `resetTabView(tab)` | Trung | F1 |
| A2 | `TabDetail.onClickConnect` và `ConnectionProfiles.onClickConnect` | Cùng gọi `ConnectS3ByProfile` rồi `updateConnectionProfiles(isConnected: true)` | Hook `useConnectProfile` chỉ gom phần IPC (K3) | Trung | F2 |
| A3 | `submodule_file_mng.go` và `submodule_tab_mng.go` (Go) | `path()` trùng; `writeJSONAtomic` nằm trong file của setting nhưng dùng cho tab | `dataFilePath(appName, name)` + `json_file.go` | Trung | B1 |
| A4 | `tabListStore.ts` `closeTab`, `restoreTabs` | Dùng `in` | `Object.hasOwn` | Thấp | F1 |
| A5 | `MainLayout.tsx` | `<Group gap="xs"></Group>` rỗng | Xoá | Thấp | F3 |
| A6 | `App.tsx` | key route theo `index-path` | key theo `path` | Thấp | F2 |
| A7 | `ResetSettings` (handler + module) | Không có nơi gọi ở FE | Xoá (Q9=a) | Thấp | B1 |
| A8 | `validateMessage.json` `V000003` | Key chưa dùng | Xoá (Q10=a) | Thấp | B4 |
| A9 | `SwitchInput`, `SelectInput`, `CheckBoxInput` | Wrapper 6 dòng, còn dùng; `SegmentedControl` chỉ còn dùng ở `ConnectModal` | Giữ; JSDoc | Thấp | F6 |
| A10 | `lazyModals.ts` `.catch` | Bắt cả lỗi trong `show()`, che lỗi thật | Tách lỗi tải chunk khỏi lỗi `show()` | Thấp | F2 |
| A11 | File dài (**chưa xác minh** có đáng tách): `UploadPickerModal.tsx` 363, `ConnectModal.tsx` 320, `tabListStore.ts` 318, `ObjectListView.tsx` 293, `UploadLimitModal.tsx` 282, `TabDetail.tsx` 260; Go: bucket `module.go` 357, `submodule_search_mng.go` 356, `submodule_uploader_mng.go` 349, `submodule_downloader_mng.go` 347, `profile/module.go` 280 | Hàm dài, state nhiều | Tách hook/helper khi lợi ích rõ | Trung | F2, F4, F5, B3 |
| A12 | Doc/JSDoc | Go: revive `exported` cho code sau beta.1; FE: `settingStore`, `settingUtils`, `tabListStore`, `tabPersistence`, `useTabPersistence`, `SortableTab`, `TabScroller`, `MotionProvider` | Bổ sung | Trung | B1, B2, F1, F2, F3, F6 |

(`docs/ARCHITECTURE*.md` thiếu tab/`motion`/`tabs.json`: làm ở sprint-11, mục 9.)

## Phụ lục B. Đánh giá hiệu năng sơ bộ
"Chưa đo" nghĩa là cần số đo trước khi sửa.

| # | Vấn đề | Vị trí | Mức | Đề xuất | Trạng thái |
|---|---|---|---|---|---|
| P1 | Khởi động tuần tự: `await load()` -> `await restoreTabsFromDisk()` -> `await normalizeTabProfilesFromDisk()` (3 IPC nối tiếp trước `createRoot`) | `main.tsx` | Trung | `Promise.all` settings + tab state; `normalize` sau render (gộp với P2, U11) | Chưa đo |
| P2 | `loadConnectionProfiles` chạy 2 lần lúc khởi động | `tabPersistence.ts`, `ConnectionProfiles.tsx` | Trung | Nạp một lần ở `App` kèm cleanup `reset()`, an toàn với `StrictMode` (K4) | Chưa đo |
| P3 | `useTabPersistence`: selector `serializeTabs()+JSON.stringify` chạy ở mỗi thay đổi store, nhưng trả chuỗi nên chỉ re-render khi payload đổi | `useTabPersistence.ts` | Thấp | Giữ; `store.subscribe` chỉ nếu đo thấy lợi | Chưa đo |
| P4 | Modal tĩnh nặng trong bundle chính: `UploadPickerModal`, `UploadLimitModal` | `TabDetail.tsx`, `useFilesDroppedUpload.ts` | Trung | Lazy (Q15=a), đo gzip trước/sau | Chưa đo |
| P5 | i18n nạp cả 3 ngôn ngữ | `locales/*/resource.ts` | Thấp | Deferred (không có ngưỡng bundle) | Deferred |
| P6 | `addSelectItem`/`setDeleting`/`loadNextPage` tạo `Set` O(n) | `tabListStore.ts`, `useObjectPaging.ts` | Thấp | Chỉ đổi nếu đo thấy chậm | Chưa đo |
| P7 | `ConnectionProfiles` chọn nguyên map `connectionProfiles` | `ConnectionProfiles.tsx` | Thấp | Chấp nhận (cần map để virtualize; item `memo`) | Đọc code |
| P8 | `DownloaderWindow` chưa virtualize | `DownloaderWindow.tsx` | Trung | Virtualize (U12) | Chưa đo |
| P9 | `memo(FileRow)` vô tác dụng do `style` object mới | `UploadFileList.tsx` | Thấp | Style ổn định hoặc bỏ memo | Có từ trước |
| P10 | Download tối đa 36 connection; `os.Stat` tuần tự; `Lstat` trong `destsMu` | `internal/modules/bucket` | Thấp | Đo trước khi đổi (B3) | Chưa đo |
| P11 | `writeJSONAtomic` không `Sync()` trước `Rename`; lưu tab lỗi không retry | `submodule_file_mng.go` | Thấp | Thêm `Sync()` (đo thời gian Save); không retry | Đọc code |
| P12 | `MaxKeys` không kiểm biên; `probe` dùng `MaxBuckets=1` | bucket module | Thấp | Chỉ kiểm biên nếu rẻ | Deferred |
| P13 | History/profile không phân trang | `profile`, `download_history` | Thấp | Ghi lại | Deferred |
| P14 | Listener sự kiện không gỡ | `TabScroller` **đã xác minh gỡ đủ** (dòng 60-69, 119); `Events.On` ở `ConnectionProfiles`, `useFilesDroppedUpload` đã có unsubscribe | Thấp | Không cần sửa | Đã xác minh |
| P15 | Settings đọc/ghi | `setting/*` | Thấp | Không cần tối ưu | Đọc code |

Tồn đọng đưa vào (Q7=a): `Object.hasOwn`, `Sync()`, `useAutoLoading` rejection, `frontend/coverage/` vào `.gitignore`, toast lỗi tải profile lúc khởi động (U11). Không làm: revive 29 lỗi `var-naming` và stutter `master.MasterOutput` (đổi bindings/json).

## Phụ lục C. Danh sách UX/UI (12 mục được duyệt)
Căn cứ đọc code; **chưa chạy app**. U8, U10, U14 phải xác minh bằng chạy app (không tái hiện được thì ghi "không tái hiện" trong report).

| # | Màn hình | Vấn đề (căn cứ) | Đề xuất | Ưu tiên | Task / Branch |
|---|---|---|---|---|---|
| U1 | Danh sách profile (navbar) | Không có thông báo khi chưa có profile | Trạng thái rỗng: chữ hướng dẫn | Cao | F2 / fe_startup_profiles |
| U2 | Danh sách bucket / object | `showEmpty` chỉ khi có `keyword`; bucket/thư mục rỗng là vùng trống | "Chưa có bucket" / "Thư mục trống" | Cao | F4 / fe_bucket_object |
| U3 | Thanh tab | Tooltip kéo thả hiện trên mọi tab; cursor grab khi chỉ 1 tab; Space/Enter bắt đầu kéo thay vì chọn tab | Chỉ bật khi ≥ 2 tab; đổi `keyboardCodes` của `KeyboardSensor` (không gỡ sensor, giữ a11y) | Trung | F3 / fe_tabs_layout |
| U4 | Thanh tab | Đóng tab: tab còn lại nhảy chỗ, không có layout animation | Layout animation nhẹ bằng `m`/`LazyMotion`, tôn trọng `reducedMotion` | Thấp | F3 / fe_tabs_layout |
| U7 | Modal Setting | Trong lúc Save chỉ nút Save bị khoá | Khoá toàn bộ nút + đóng X | Trung | F6 / fe_setting_modal |
| U8 | Khởi động (Setting `auto`) | Nền cửa sổ native vẫn trắng lúc mở trên OS dark, có thể nháy | Tái hiện; sửa phần FE, và `main.go` nếu cần (Q19) | Thấp | F6 + B2 (có điều kiện) / fe_setting_modal + be_core_refactor |
| U9 | Màu header modal | `INFO_COLOR`, `WARNING_COLOR`... là hex trong `light-dark()` | `var(--mantine-color-*)`; có thể lệch nhẹ (R-09) | Thấp | F6 / fe_setting_modal |
| U10 | Đổi ngôn ngữ/font | Chưa kiểm modal/màn hình khác ở ja/font lớn | Rà 3 ngôn ngữ x 3 font (System UI, Monospace, JetBrains Mono): cắt chữ, nhảy layout; mỗi branch rà màn hình của mình | Trung | F2-F6, mỗi branch |
| U11 | Toast khởi động | Toast lỗi tải profile có thể không hiện vì chạy trước `Toaster` mount | Nạp profile trong `App` (sau khi `Toaster` mount), gộp với P1/P2 | Trung | F2 / fe_startup_profiles |
| U12 | Cửa sổ Downloading | `DownloaderWindow` chưa virtualize, có thể giật khi nhiều file | Virtualize giữ nguyên layout | Trung | F5 / fe_transfer_modals |
| U13 | Modal lazy | Chunk tải chậm không có phản hồi (chỉ toast khi lỗi) | Loading ngắn khi tải chunk | Thấp | F2 / fe_startup_profiles |
| U14 | Trạng thái kết nối profile | Chưa xác minh tương phản light green/red ở dark | Kiểm AA, chỉnh theo biến theme | Thấp | F2 / fe_startup_profiles |

Đã bỏ theo quyết định người dùng: **U5** (phím tắt; WebView2 tự xử lý `F5`/`Ctrl+F`, reload giữa chừng mất state upload/download, và là tính năng mới) và **U6** (logo/tên app ở header).
