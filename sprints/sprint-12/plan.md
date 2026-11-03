# Plan sprint-12: Tối ưu hiệu năng và refactor

Cập nhật 2026-11-03: người dùng đã trả lời Q1-Q12 (mục 2), các quyết định đã được đưa vào task và branch.

## 1. Tóm tắt yêu cầu
Thứ tự ưu tiên người dùng đã chốt: R5, R6, R1, R2, R4, R3, rồi R7 (a, b), rồi R8 (c, d, e).

- R5: Đổi ngôn ngữ / font trong Setting không khựng (Activity cho tab ẩn, tách ghi font, `font-display`).
- R6: Cuộn danh sách ~200 profile mượt, thumb không lệch (chiều cao hàng cố định, bỏ `measureElement`, `Menu` chỉ mount khi cần, mỗi item tự select profile; kèm phần `ConnectionProfiles` của R4).
- R1: Cuộn danh sách object mượt (trang đầu 200, các trang sau 1000, bucket 1000, prefetch ~2 màn hình, `memo` + menu lazy, selection O(1)).
- R2: Gộp event progress upload/download thành một event batch mỗi loại, ticker chung (Go + FE cùng branch).
- R4: Dọn re-render thừa (`useTabPersistence`; phần `ConnectionProfiles` làm ở branch R6).
- R3: Giảm thời gian khởi động (chỉ nạp `en` + ngôn ngữ đang chọn, nạp động ngôn ngữ khác).
- R7: Refactor backend Go + config, bỏ code thừa (a: `modules/bucket`; b: phần còn lại + config).
- R8: Refactor frontend, bỏ code thừa (c: `common/` + cài knip; d: `components/`; e: `pages/` + locale).
- R9 (thêm 2026-11-03, xem mục 9): xoá object theo lô 1000 key; xoá xong hiện dialog số thành công / thất bại kèm Accordion chi tiết; dialog xác nhận xoá hiện danh sách file dạng bảng, mỗi file một dòng; dialog rộng, không scroll ngang, tên file dài xuống dòng.

## 2. Câu hỏi chưa rõ
Tất cả đã được trả lời (2026-11-03). Không còn câu hỏi mở. (Câu hỏi riêng của R9 nằm ở mục 9.2.)

| # | Câu hỏi | Quyết định đã chốt | Trả lời |
|---|---|---|---|
| Q1 | Xử lý conflict giữa các branch cùng tách từ `origin/master` (file trùng: `ObjectItem.tsx`, `ObjectListView.tsx`, `ConnectionProfiles*.tsx`, `settingUtils.ts`, `i18n.ts`, `tabListStore.ts`, `ipcMessage.json`)? | Tách branch tại thời điểm bắt đầu làm nó; phân quyền sở hữu file (mục 5); **chờ người dùng merge PR trước** khi bắt đầu: R3 (chờ R5), R7a (chờ R2), R7b (chờ R7a), R8c/d/e (chờ R1-R6 và chờ nhau). | A (2026-11-03) |
| Q2 | R4 gồm `useTabPersistence` và `ConnectionProfiles` (trùng R6)? | Phần `ConnectionProfiles` làm trong branch R6; branch R4 chỉ còn `useTabPersistence`. | A |
| Q3 | Có chờ số liệu baseline trước khi code? | Code luôn theo thứ tự đã chốt. Agent đo phần tự động (bundle `vite build`, đếm ghi store / render trong test); người dùng đo tay baseline và sau từng PR (dev + build), ghi vào `report.md`. R6 luôn sửa. | A |
| Q4 | Ai làm phần hàng list (R5 / R6 / R1)? | Hàng profile thuộc R6, hàng object thuộc R1. R5 chỉ gồm `Activity`, tách ghi font, `style.css`. Đo lại R5 sau khi R1/R6 merge. | A |
| Q5 | `startTransition` không hiệu quả với react-i18next 17.1.11 (`useSyncExternalStore`, update luôn đồng bộ). | Làm bản giảm khối lượng render trước (Activity + ghi font tách riêng + bớt `useTranslation` ở hàng nhờ R6/R1), giữ `changeLanguage` đồng bộ. Đo xong mới cân nhắc provider tự viết dùng `startTransition`; nếu cần thì **hỏi lại người dùng** (không tự làm). Không debounce. | A trước, đo rồi mới cân nhắc B |
| Q6 | `Activity` làm effect cleanup chạy khi ẩn và chạy lại khi hiện. | Dùng Activity bên trong `Tabs.Panel` (giữ `keepMounted`), sửa effect an toàn khi ẩn/hiện, khôi phục `scrollTop` thủ công nếu mất, test từng case. | B |
| Q7 | Đổi `selectionItem`/`deletingItems` sang `Record<string, true>` làm hỏng khoảng 40 assert test hiện có. | Đổi theo requirement; `react-tester` cập nhật fixture / assert trong branch R1; API action giữ nguyên. | A |
| Q8 | Xử lý event progress cũ khi có event batch? | Xoá hẳn event và model cũ; thêm `downloader:download-progress-batch`, `uploader:upload-progress-batch`, ~200 ms, emit lần cuối khi job kết thúc. | A |
| Q9 | `applySettings` thành bất đồng bộ khi nạp động ngôn ngữ (R3). | Khởi động: `loadStartupData` await nạp bundle ngôn ngữ đã lưu trước khi mount. Trong Setting: nạp xong mới `changeLanguage`, giữ ngôn ngữ cũ trong lúc chờ, bỏ qua kết quả nếu đã chọn ngôn ngữ khác (chống race). | A |
| Q10 | `go.sum` bị chặn ghi nên agent không cài `deadcode`; `knip`? | Người dùng tự chạy `go get -tool golang.org/x/tools/cmd/deadcode` (commit `go.mod`/`go.sum`) **trước R7a**. Agent chạy `bun add -d knip` chỉ trong branch R8c. | A |
| Q11 | JetBrains Mono: weight nào thực sự dùng? | Agent grep `fw` / `font-weight` toàn FE để chốt; weight không dùng thì bỏ, nếu cả 4 đều dùng thì chỉ thêm `font-display: swap` cho Nunito. | A |
| Q12 | 11 branch (>10 task): tách sprint không? | Giữ 11 branch trong sprint-12; dừng báo cáo sau mỗi nhóm: R5/R6/R1, R2/R4/R3, R7, R8. | A |

## 3. Task backend (go-backend)
Backend chỉ có R2 và R7 (R1, R3, R4, R5, R6 chỉ đổi frontend: `GetListObject` truyền `limit` nguyên xi, `GetListBucket` truyền `MaxBuckets`; chưa xác minh MinIO có giới hạn `MaxBuckets` khác AWS).

| # | Task | Yêu cầu | File sửa / tạo | Phụ thuộc |
|---|---|---|---|---|
| B1 | Thêm model batch `DownloadProgressBatchOutput{ Items []DownloadProgressOutput }`, `UploadProgressBatchOutput{ Items []UploadProgressOutput }` (json camelCase), re-export trong `alias.go`. Thêm event batch mới, xoá hẳn 2 event progress cũ (Q8). | R2 | `models/bucket/download_progress_batch_output.go` (tạo), `models/bucket/upload_progress_batch_output.go` (tạo), `models/alias.go` (sửa), `internal/modules/bucket/events.go` (sửa: hằng + `RegisterEvent` mới, bỏ event cũ) | - |
| B2 | Reporter chung cho mỗi loại transfer: registry job -> hàm đọc counter, một ticker 200 ms duy nhất chạy khi có >= 1 job, mỗi chu kỳ emit một event chứa mảng progress của mọi job; emit lần cuối khi job kết thúc rồi huỷ đăng ký; ticker dừng khi hết job. Thay `utils.ReportEvery` per-file ở uploader. | R2 | `internal/modules/bucket/submodule_uploader_s3.go` (sửa), `internal/modules/bucket/submodule_uploader_mng.go` (sửa), `internal/pkg/utils/common.go` (sửa: reporter dùng chung; bỏ `ReportEvery` nếu không còn ai dùng) | B1 |
| B3 | Tương tự B2 cho downloader (dùng chung reporter, không nhân đôi code). | R2 | `internal/modules/bucket/submodule_downloader_s3.go` (sửa), `internal/modules/bucket/submodule_downloader_mng.go` (sửa) | B2 |
| B4 | Cập nhật doc của event trong `module.go`. | R2 | `internal/modules/bucket/module.go` (sửa) | B3 |
| B5 | Refactor `modules/bucket`: bỏ code chết theo `go tool deadcode ./...` (kiểm tra từng mục, hàm gọi qua binding có thể báo nhầm); gộp xử lý lỗi lặp (`isCallCanceled` -> `isCredentialsExpired` -> `ThrowError`) vào `call_helper.go`; gộp logic job/cancel giữa uploader và downloader; rút gọn hàm quá dài khi tách làm dễ đọc; bỏ message code `var` không còn dùng ở `module.go`; sửa/bỏ comment lỗi thời (giữ tiếng Anh). | R7a | `internal/modules/bucket/*.go` (sửa), có thể tạo file helper mới cùng package | R2 đã merge; `deadcode` đã có trong `go.mod` (Q10) |
| B6 | Xoá key `ipcMessage.json` của mọi message code bucket bị xoá ở B5, đủ 7 ngôn ngữ, giữ đúng tập key. | R7a | `frontend/src/locales/{en,vi,ja,zh-CN,zh-TW,ru,de}/messages/ipcMessage.json` (sửa) | B5 |
| B7 | Refactor BE còn lại: handler, `modules/<không phải bucket>`, `internal/pkg/**` (trừ `db/sqlc/**`), `models/**` (type không dùng), `main.go`, `internal/app.go`; bỏ code chết theo `deadcode`; bỏ cấu hình thừa `.golangci.yml` (loại trừ `rabbitmq` dòng 30-31); xoá message code ngoài `bucket` không dùng. | R7b | `internal/handlers/*.go`, `internal/modules/<không phải bucket>/**`, `internal/pkg/**`, `models/**`, `.golangci.yml` (sửa) | R7a đã merge |
| B8 | Xoá key `ipcMessage.json` cho code bị xoá ở B7 (7 ngôn ngữ). | R7b | `frontend/src/locales/*/messages/ipcMessage.json` (sửa) | B7 |

Message code mới: không (R7 chỉ xoá)  |  Migration / sqlc: không  |  Cần sinh lại bindings: có ở R2 (event + model mới), có ở R7a/R7b nếu đổi model / chữ ký handler (kiểm bằng skill `wails3-bindings`), không ở các branch khác.
Điều kiện trước R7a: người dùng đã tự cài `deadcode` vào `go.mod` / `go.sum` (Q10).

## 4. Task frontend (react-frontend)
| # | Task | Yêu cầu | File sửa / tạo | Phụ thuộc |
|---|---|---|---|---|
| F1 | R5-1: Tách ghi font khỏi đổi ngôn ngữ trong `applySettings`: chỉ `setProperty` khi font / họ font (theo ngôn ngữ CJK) thực sự đổi, gộp một lần ghi; giữ `i18n.changeLanguage` đồng bộ và bỏ qua khi trùng (Q5: chưa dùng `startTransition`, không debounce). | R5 | `frontend/src/common/utils/settingUtils.ts` (sửa) | - |
| F2 | R5-2: `Activity` cho tab ẩn trong `TabLayout` (giữ `keepMountedMode`, bọc nội dung panel bằng `<Activity mode>`). Sửa effect không an toàn khi ẩn / hiện (Q6-B): `useObjectPaging` (abort khi cleanup chỉ khi unmount thật), `ObjectListView` (`clearSelectItem` chỉ khi tab thật sự đóng, không tải lại trang đầu khi chỉ hiện lại), `BucketListView` (đã có `active`), effect có cleanup trong `TabDetail`. Lưu và khôi phục `scrollTop` thủ công nếu đo thấy mất. | R5 | `frontend/src/components/layouts/tab/TabLayout.tsx` (sửa), `frontend/src/components/layouts/tab/components/TabDetail.tsx` (sửa), `frontend/src/common/hooks/useObjectPaging.ts` (sửa), `frontend/src/pages/object/ObjectListView.tsx` (sửa), `frontend/src/pages/bucket/BucketListView.tsx` (sửa) | F1 |
| F3 | R5-3: `font-display: swap` cho Nunito (dòng 18-25); JetBrains Mono: bỏ weight không dùng sau khi grep (Q11-A). | R5 | `frontend/src/style.css` (sửa) | - |
| F4 | R6-1: `ConnectionProfiles`: chiều cao hàng cố định (một hằng `ITEM_HEIGHT` dùng cho cả CSS `h` của `Card` và `estimateSize`), bỏ `measureElement`, tăng `overscan` (~10), effect dọn menu phụ thuộc giá trị ổn định (key đang mở có trong range không) thay `virtualItems`; select danh sách key bằng `useShallow` (phần R4), truyền `profileKey` xuống item. | R6 + R4 | `frontend/src/components/layouts/navbar/components/ConnectionProfiles.tsx` (sửa) | - |
| F5 | R6-2: `ConnectionProfileItem`: tự select profile của mình (`useProfileStore(s => s.connectionProfiles[key])`); hàng thường chỉ là `Card`, `Menu` chỉ mount cho hàng đang mở context menu (hoặc một menu dùng chung định vị theo chuột); chữ `truncate`; bớt `useTranslation` ở hàng nếu có thể, `contain: content`. Chuột phải, double-click connect, connect / disconnect / edit / delete giữ nguyên. | R6 + R4 | `frontend/src/components/layouts/navbar/components/ConnectionProfileItem.tsx` (sửa), `.../ConnectionProfileItem.module.css` (sửa) | F4 |
| F6 | R1-1: `useObjectPaging`: trang đầu 200, trang sau 1000 (`FIRST_PAGE_SIZE` / `NEXT_PAGE_SIZE` thay `OBJECT_PAGE_SIZE`), chỉ lọc trùng khi search. `BucketListView`: `BUCKET_PAGE_SIZE = 1000`. | R1 | `frontend/src/common/hooks/useObjectPaging.ts` (sửa), `frontend/src/pages/bucket/BucketListView.tsx` (sửa) | - |
| F7 | R1-2: `tabListStore`: `selectionItem` / `deletingItems` thành `Record<string, true>` (action giữ nguyên API); cập nhật chỗ dùng; `react-tester` cập nhật fixture / assert mảng cũ (Q7-A). | R1 | `frontend/src/common/stores/tabListStore.ts`, `frontend/src/components/layouts/tab/components/TabActionBar.tsx`, `frontend/src/components/layouts/tab/components/TabDetail.tsx`, `frontend/src/pages/object/ObjectListView.tsx` (đều sửa) | - |
| F8 | R1-3: `ObjectListView`: prefetch khi còn ~2 màn hình hàng chưa xem, hàng cao cố định (`estimateSize`, bỏ `measureElement`). `ObjectItem`: `ObjectRow` bọc `memo`, `menuItems` không là JSX mới mỗi render, `Menu` chỉ mount khi bấm "more actions" (hoặc menu dùng chung), bỏ `useTranslation` ở hàng (nhãn lấy từ cha), selector O(1) `selectionItem[key]`. | R1 | `frontend/src/pages/object/ObjectListView.tsx` (sửa), `frontend/src/pages/object/ObjectItem.tsx` (sửa), `frontend/src/pages/object/page.module.css` (sửa nếu cần) | F6, F7 |
| F9 | R2: Store: một action `set()` nhận cả batch (`setDownloadProgressBatch`, `setUploadProgressBatch`); `downloaderStore` lưu sẵn danh sách id DOWNLOADING (cập nhật khi upsert / đổi status) thay `selectDownloadingIds` lọc toàn bộ lịch sử. Cửa sổ lắng nghe event batch mới, bỏ listener cũ. | R2 | `frontend/src/common/stores/downloaderStore.ts`, `frontend/src/common/stores/uploaderStore.ts`, `frontend/src/components/layouts/transfer/downloader/DownloaderWindow.tsx`, `frontend/src/components/layouts/transfer/uploader/UploaderWindow.tsx` (đều sửa) | B1-B4 + sinh bindings |
| F10 | R4: `useTabPersistence`: selector hẹp (thứ tự tab, `activeTab`, `profileId` qua `useShallow`), chỉ `JSON.stringify` khi các giá trị đó đổi. | R4 | `frontend/src/common/hooks/useTabPersistence.ts` (sửa) | - |
| F11 | R3: `i18n.ts` chỉ nạp tĩnh `en`, thêm `loadLanguage(lng)` (`import()` động + `addResourceBundle`, cache, chống race: chọn A rồi B trước khi A xong thì bỏ A); `loadStartupData` await nạp bundle ngôn ngữ đã lưu trước khi mount; `applySettings` / `settingStore` chỉ `changeLanguage` sau khi nạp xong (Q9-A); xác nhận Vite tách chunk locale riêng. | R3 | `frontend/src/locales/i18n.ts`, `frontend/src/common/utils/settingUtils.ts`, `frontend/src/common/stores/settingStore.ts`, `frontend/src/common/utils/startup.ts` (đều sửa), `frontend/src/locales/<lang>/resource.ts` (chỉ nếu cần đổi cách export) | R5 đã merge |
| F12 | R8c: Cài `knip` (`bun add -d knip`), cấu hình tối thiểu (entry `src/main.tsx`, project `src/**`, bỏ qua `bindings/**`, `src/test/**` chỉ tính là nơi dùng của test); dọn `common/` (hooks, stores, utils, cnst, theme): xoá export chết (xoá cả test nếu chỉ test dùng), gộp action lặp "lấy tab rồi sửa" trong `tabListStore.ts`, sửa comment. | R8c | `frontend/package.json`, `frontend/bun.lock` (sửa), `frontend/knip.json` (tạo), `frontend/src/common/**` (sửa) | R1-R6 đã merge |
| F13 | R8d: Dọn `components/`: gộp `UploaderItem` / `DownloaderItem` (hàng tiến trình chung), `UploaderWindow` / `DownloaderWindow` (khung cửa sổ chung), rút gọn `ConnectModal.tsx`, `UploadPickerModal.tsx`; xoá export chết (theo knip). Giữ tối ưu R5/R6 (Activity, menu lazy, chiều cao hàng cố định). | R8d | `frontend/src/components/**` (sửa; file chung tạo trong `components/layouts/transfer/`) | R8c đã merge |
| F14 | R8e: Dọn `pages/` (`bucket`, `object`), rút gọn `connectSchema.ts`, xoá key i18n không còn dùng ở cả 7 ngôn ngữ (toàn FE, giữ đúng tập key và placeholder). | R8e | `frontend/src/pages/**` (sửa), `frontend/src/locales/*/**/*.json` (sửa) | R8d đã merge |

i18n key mới (en/vi/ja/zh-CN/zh-TW/ru/de): không có key mới; R6/R1 chỉ chuyển nơi gọi `t` (kiểm tra khi làm). R8e chỉ xoá key (không xoá key dùng động như `connectModal:authType.*`).

### Test frontend (react-tester)
Ngưỡng C1 >= 95% và Lines >= 95% **mỗi file production đã đổi**, kể cả code cũ trong file. Test đặt trong `frontend/src/test/` theo cây `src/`, console sạch.

| Task | File cần test | Case cần phủ |
|---|---|---|
| F1 | `src/common/utils/settingUtils.ts` (`src/test/common/utils/settingUtils.test.ts`) | font đổi / không đổi (không ghi lại style), đổi ngôn ngữ làm đổi họ font CJK, ngôn ngữ trùng bỏ qua, ngôn ngữ đổi gọi 1 lần, theme auto / dark / light |
| F2 | `src/components/layouts/tab/TabLayout.tsx`, `TabDetail.tsx`, `src/common/hooks/useObjectPaging.ts`, `src/pages/object/ObjectListView.tsx`, `src/pages/bucket/BucketListView.tsx` | tab ẩn dùng Activity hidden; tab ẩn giữ state (folder, lựa chọn); ẩn không huỷ request đang chạy / không xoá lựa chọn; hiện lại không tải lại trang đầu; khôi phục `scrollTop`; unmount thật (đóng tab) vẫn huỷ + dọn; tab chưa từng active không mount |
| F3 | `style.css` | Không có test (CSS); kiểm bằng `vite build` |
| F4 | `src/components/layouts/navbar/components/ConnectionProfiles.tsx` | hàng cao cố định (không `measureElement`), `getTotalSize` không đổi khi cuộn, danh sách rỗng đã load / chưa load, auto-connect một lần, connect / disconnect / edit / delete (đã connect: xác nhận 2 lần, từ chối, xoá lỗi -> reload), `openedMenuKey` bị dọn khi hàng rời range và không bị dọn khi còn trong range, `bucket:connect-save-profile` có / không `id`, spinner connecting |
| F5 | `src/components/layouts/navbar/components/ConnectionProfileItem.tsx` | chỉ item của profile đổi `isConnected` re-render (đếm render), Menu không mount cho hàng thường, mount khi chuột phải, đóng menu, 4 hành động, double-click connect, màu sáng / tối / không màu, loader connecting, ẩn hiện Connect / Edit theo trạng thái |
| F6 | `src/common/hooks/useObjectPaging.ts`, `src/pages/bucket/BucketListView.tsx` | `limit` trang đầu = 200, trang sau = 1000, search không đổi; lọc trùng chỉ khi search; nextCursor trùng -> hết; lỗi trang -> `loadMoreError`; abort; `limit` bucket = 1000 |
| F7 | `src/common/stores/tabListStore.ts`, `TabActionBar.tsx`, `TabDetail.tsx`, `ObjectListView.tsx` | add / remove / clear selection, set / unset deleting với Record, tab không tồn tại, trùng key, `changePrefix` / `resetTabView` xoá lựa chọn; cập nhật fixture và assert mảng cũ ở các file test liên quan |
| F8 | `src/pages/object/ObjectListView.tsx`, `ObjectItem.tsx` | prefetch kích hoạt khi còn <= ~2 màn hình, không kích hoạt khi đang tải / có lỗi / `cursorKey` lệch / search rỗng; hàng folder và file; chọn / bỏ chọn chỉ re-render đúng hàng (đếm render); `Menu` chỉ mount khi bấm "more actions"; xoá file / folder, tải xuống, mở drawer, spinner deleting; `memo` |
| F9 | `src/common/stores/downloaderStore.ts`, `uploaderStore.ts`, `DownloaderWindow.tsx`, `UploaderWindow.tsx` | batch cập nhật trong một lần `set` (đếm số lần ghi), item không tồn tại bị bỏ qua, `total > 0` ghi đè, id DOWNLOADING cập nhật khi upsert / đổi status / huỷ, version cũ bị bỏ, `finalizing` của UploaderItem đúng, subscribe / unsubscribe event batch, huỷ tất cả, đóng / mở cửa sổ |
| F10 | `src/common/hooks/useTabPersistence.ts` | chọn object / mở drawer / đổi prefix không chạy lại serialize; đổi thứ tự tab, `activeTab`, `profileId` thì lưu sau 500 ms; `pagehide` flush; `isTabRestoreFailed` không lưu; payload trùng lần lưu cuối thì bỏ qua (timer giả `setTimeout` / `clearTimeout` / `Date`, `await act`) |
| F11 | `src/locales/i18n.ts`, `settingUtils.ts`, `settingStore.ts`, `startup.ts` | chỉ `en` + ngôn ngữ đã lưu có lúc init; `loadLanguage` lần đầu (`import()` mock) và lần sau (cache); ngôn ngữ không hỗ trợ; race (chọn A rồi B trước khi A nạp xong); lỗi nạp bundle; không warning i18next thiếu key; startup đợi nạp trước khi mount |
| F12 | Mọi file `src/common/**` đã đổi (đặc biệt `tabListStore.ts`) | giữ test cũ pass không sửa assert; bổ sung nhánh thiếu để đạt 95% từng file; xoá test của export bị xoá |
| F13 | Các file `components/**` đã đổi / gộp (transfer item / window chung, `ConnectModal.tsx`, `UploadPickerModal.tsx`) | như test cũ + nhánh của component chung (cả upload và download); chỉ sửa import / đường dẫn khi gộp file |
| F14 | Các file `pages/**` đã đổi, `connectSchema.ts`, test locale (`src/test/locales`) | như test cũ; test locale xác nhận mọi ngôn ngữ cùng tập key và placeholder sau khi xoá key |

Đo tự động (agent làm được): kích thước bundle trước / sau bằng `vite build` (R3 và toàn sprint); đếm số lần ghi store và render trong test (R1 chọn một hàng, R2 <= 5 lần ghi / giây, R4/R6 re-render đúng item); `tsc --noEmit`, biome, oxlint, `go vet`, `go build`, `golangci-lint`, `deadcode`, `knip`.
Đo tay (người dùng, Q3-A, song song với code): React Profiler / tab Performance WebView2, bản dev (`go tool wails3 task dev`) và bản build (`go tool wails3 task build`), cho đổi ngôn ngữ, đổi font, kéo thanh cuộn 200 profile (task dài > 50 ms, `scrollHeight` không đổi), cuộn folder >= 5000 object, thời gian hiện trang đầu AWS và MinIO (< +100 ms), 5 upload + 6 download đồng thời, kiểm tay theo `test-env/test-profiles.txt`. Baseline đo trên master hiện tại, đo lại sau từng PR; số liệu ghi vào `report.md`.

## 5. Branch
Quyền sở hữu file giữa các branch (Q1-A):

| File dùng chung | Branch sửa | Ghi chú |
|---|---|---|
| `ConnectionProfiles.tsx`, `ConnectionProfileItem.tsx` (+ css) | chỉ R6 (kèm phần R4) | R5 không đụng (Q4) |
| `ObjectItem.tsx`, `ObjectListView.tsx`, `useObjectPaging.ts`, `BucketListView.tsx` | R1 là chủ; R5 (F2) chỉ sửa tối thiểu effect hide / show ở `ObjectListView.tsx`, `useObjectPaging.ts`, `BucketListView.tsx` | R5 và R1 cùng đụng 3 file này nhưng vùng khác nhau (effect vs trang / prefetch); R5 làm trước nên R1 tách sau khi R5 merge nếu có thể, nếu không thì giải conflict khi rebase |
| `tabListStore.ts`, `TabActionBar.tsx` | R1 (F7) | R8c sau |
| `TabDetail.tsx` | R5 (F2) và R1 (F7) | trùng, vùng khác nhau |
| `settingUtils.ts`, `i18n.ts`, `settingStore.ts` | R5 (chỉ `settingUtils.ts`) trước, R3 sau | R3 chờ R5 merge |
| `useTabPersistence.ts` | R4 | độc lập |
| `uploaderStore.ts`, `downloaderStore.ts`, `*Window.tsx`, `modules/bucket/submodule_{uploader,downloader}_*.go`, `events.go` | R2, sau đó R7a / R8d | R7a chờ R2 merge |
| `ipcMessage.json` x7 | R7a rồi R7b | tuần tự (R9 xen giữa R7a và R7b, xem mục 9) |

| Branch | Yêu cầu | Task | Ghi chú |
|---|---|---|---|
| SP-12/lang_font_switch | R5 | F1, F2, F3 | Làm đầu tiên. Nhóm 1 (R5/R6/R1): dừng báo cáo sau nhóm. |
| SP-12/profile_list_scroll | R6 + R4 (phần `ConnectionProfiles`) | F4, F5 | Gộp phần R4 (Q2-A); tiêu chí "connect / disconnect chỉ re-render item đó" nằm ở đây. |
| SP-12/object_list_scroll | R1 | F6, F7, F8 | Không có backend. Thứ tự F6, F7 (store), F8. |
| SP-12/transfer_progress_batch | R2 | B1, B2, B3, B4, bindings, F9 | Go + FE cùng branch. Nhóm 2 (R2/R4/R3): dừng báo cáo sau nhóm. |
| SP-12/tab_persist_selector | R4 (`useTabPersistence`) | F10 | Branch rất nhỏ. |
| SP-12/locale_lazy_load | R3 | F11 | Tách sau khi R5 merge. |
| SP-12/refactor_be_bucket | R7 (a) | B5, B6 | Sau R2 merge; `deadcode` đã được người dùng cài. Nhóm 3 (R7): dừng báo cáo sau R7b. |
| SP-12/refactor_be_rest | R7 (b) | B7, B8 | Sau R7a merge. |
| SP-12/refactor_fe_common | R8 (c) | F12 | Sau R1-R6 và R7 đã merge; cài knip. Nhóm 4 (R8): dừng báo cáo sau R8e. |
| SP-12/refactor_fe_components | R8 (d) | F13 | Sau R8c merge. |
| SP-12/refactor_fe_pages | R8 (e) | F14 | Sau R8d merge; xoá key locale toàn FE. |

Slug không trùng, đều a-z 0-9 `_`, <= 40 ký tự.

## 6. Thứ tự thực hiện (luôn tuần tự, xong branch này mới sang branch sau)
Thứ tự: lang_font_switch, profile_list_scroll, object_list_scroll, transfer_progress_batch, tab_persist_selector, locale_lazy_load, refactor_be_bucket, refactor_be_rest, refactor_fe_common, refactor_fe_components, refactor_fe_pages. Với từng branch:
1. Tách branch từ `origin/master` (git-flow) tại thời điểm bắt đầu; với R3, R7a, R7b, R8c/d/e dừng và chờ người dùng merge PR phụ thuộc (mục 5) trước.
2. Backend: các task B của branch (chỉ R2, R7a, R7b).
3. `go tool wails3 generate bindings -clean=true -ts` (skill `wails3-bindings`) khi có đổi model / event / handler.
4. Frontend: các task F của branch.
5. FE test (react-tester, C1 >= 95%) -> verify -> review -> commit (git-flow). Tối đa 3 vòng.
Dừng báo cáo và để người dùng đo tay sau mỗi nhóm: (R5, R6, R1), (R2, R4, R3), (R7a, R7b), (R8c, R8d, R8e).
Thứ tự bổ sung R9 (2026-11-03): `batch_delete_result` xen vào **sau R7a (PR #32 merge) và trước R7b**; xem mục 9.5.

## 7. Rủi ro
Kiểm chứng kỹ thuật (đọc từ `package.json` và `node_modules`):
- React / react-dom 19.3.1; `@types/react` có `Activity` nên dùng được. Chưa xác minh hành vi với Mantine `Tabs.Panel` (cần giữ `keepMounted`, bọc Activity bên trong Panel).
- react-i18next 17.1.11 + i18next 26.7.1: `useTranslation` dùng `useSyncExternalStore` nên đổi ngôn ngữ không thể là transition.
- `@tanstack/react-virtual` 3.14.25, không cần nâng.
- `typescript` ^7.0.2, `vitest` ^5.0.5: tương thích `knip` chưa xác minh.
- Progress hiện tại: mỗi file một `utils.ReportEvery(200ms)` (`submodule_uploader_s3.go` dòng 95, `submodule_downloader_s3.go` dòng 52).

| # | Rủi ro | Mức độ | Cách giảm thiểu |
|---|---|---|---|
| 1 | 11 branch, 22 task (>10): chi phí vòng review lớn, R7/R8 đụng gần như mọi file | high | Q12-A: giữ trong sprint-12, dừng báo cáo sau từng nhóm; R7/R8 chỉ bắt đầu sau khi PR trước merge |
| 2 | Conflict giữa các branch tách từ `origin/master` | high | Q1-A: sở hữu file rõ (mục 5), tách branch lúc bắt đầu, chờ merge với cặp trùng (R5->R3, R2->R7a, R7a->R7b, R1-R6->R8) |
| 3 | `Activity` làm effect cleanup chạy khi ẩn: mất lựa chọn, huỷ request, tải lại trang đầu, mất scroll offset | high | Q6-B: sửa effect, khôi phục `scrollTop`, test từng case; nếu một case không đạt được thì dừng và hỏi người dùng |
| 4 | `startTransition` không có tác dụng với react-i18next | medium | Q5: làm bản giảm khối lượng render trước, đo; nếu vẫn khựng thì hỏi người dùng trước khi làm provider tự viết |
| 5 | Bỏ `measureElement` làm sai vị trí nếu chiều cao thật khác hằng (font CJK, theme) | medium | Chiều cao cố định bằng CSS (`h`) + `truncate`; test `getTotalSize` không đổi; người dùng kiểm tay với mọi font |
| 6 | Hàng chỉ mount `Menu` khi cần: mất hành vi chuột phải / focus / a11y | medium | Giữ test chuột phải, aria-label, bàn phím; menu dùng chung nếu mount lazy gây nháy |
| 7 | Đổi `selectionItem` sang `Record` làm hỏng khoảng 40 assert | medium | Q7-A: `react-tester` cập nhật trong branch R1 (tiêu chí "không sửa assert" của R8 không áp dụng cho R1) |
| 8 | Event batch R2: mất giá trị cuối / trạng thái "finalizing", race emit lần cuối với `finished` | medium | Reporter emit lần cuối trước khi huỷ đăng ký (như `ReportEvery.stop()`); FE xử lý theo `version` / `finishedIds`; kiểm tay 5 upload + 6 download, huỷ một / tất cả |
| 9 | Nạp động ngôn ngữ (R3): nháy key thô, race khi chọn nhanh, chunk không tách | medium | Q9-A, test race, kiểm `vite build` |
| 10 | Người dùng chưa cài `deadcode` trước R7a thì R7a không chạy được | medium | Nhắc người dùng trước khi bắt đầu R7a (Q10-A) |
| 11 | Code khó test: `Activity` + virtualizer trong jsdom (không có layout thật) | medium | Mock `useVirtualizer` / dùng helper sẵn có trong `src/test/_helpers`; ghi nhánh không test được và lý do |
| 12 | Xoá code chết nhầm (hàm Wails qua binding, key i18n dùng động) | medium | Kiểm tay từng mục `deadcode` / `knip`; key động như `connectModal:authType.*` không coi là thừa; test locale |
| 13 | R5 và R3 cùng sửa `settingUtils.ts`; test hiện có giả định `applySettings` đồng bộ | low | Cập nhật test cùng branch; R3 làm sau khi R5 merge |
| 14 | Tiêu chí định lượng (task dài > 50 ms, thời gian commit React) agent không đo được | medium | Q3-A: người dùng đo tay song song; ghi số liệu vào `report.md` |
| 15 | Harness chặn subagent ghi `report.md` | low | Orchestrator soạn nội dung, session chính ghi |

(Rủi ro riêng của R9: mục 9.6, đánh số R9-1...)

## 8. Tiêu chí hoàn thành
- [ ] Unit test frontend đạt C1 >= 95% và Lines >= 95% cho mọi file FE đã đổi (kể cả file chỉ bị xoá code); console sạch khi chạy test; Go không viết unit test
- [ ] `tsc --noEmit`, biome, oxlint sạch; `go vet`, `go build`, `golangci-lint` sạch; `go tool deadcode` (R7) và `knip` (R8) không còn mục chưa xử lý, mục giữ lại có lý do trong `report.md`
- [ ] R5: đổi ngôn ngữ / font không khựng (số liệu trước / sau do người dùng đo, bản dev và build); tab ẩn giữ state (folder, scroll, lựa chọn); Revert / Apply / Save đúng; không key thô, không warning i18next
- [ ] R6: 200 profile cuộn mượt, `scrollHeight` không đổi khi kéo, thumb bám chuột với mọi font; chuột phải, double-click connect, connect / disconnect / edit / delete như cũ
- [ ] R1: trang đầu 200, các trang sau 1000, bucket 1000, prefetch ~2 màn hình, bật / tắt chọn một object chỉ re-render đúng hàng đó; không đổi hành vi chọn, xoá, tải xuống, drawer, search, "load more" sau lỗi
- [ ] R2: tối đa ~5 lần ghi store / giây cho mỗi loại transfer; phần trăm, dung lượng, "finalizing", huỷ một / tất cả đúng; bindings sinh lại, không sửa tay `frontend/bindings/**`
- [ ] R4: chọn object / mở drawer không chạy lại serialize tab; connect / disconnect một profile chỉ re-render item đó
- [ ] R3: chunk khởi động không còn locale không dùng (so sánh `vite build` trước / sau); không nháy key thô
- [ ] R7: hành vi giữ nguyên, kiểm tay theo `test-env/test-profiles.txt`; `.golangci.yml` đã bỏ cấu hình thừa; key `ipcMessage.json` khớp code Go ở cả 7 ngôn ngữ
- [ ] R8: test FE hiện có pass không sửa assert (chỉ import / đường dẫn khi gộp file); mọi ngôn ngữ cùng tập key / placeholder; không mất tối ưu R1-R6
- [ ] `report.md` ghi số liệu đo trước / sau (dev + build), số dòng xoá / thêm theo vùng, danh sách code đã xoá; `memory/MEMORY.md` cập nhật bởi orchestrator
- [ ] R9: xem tiêu chí ở mục 9.8

## 9. R9: Xoá theo lô 1000 key, dialog xác nhận dạng bảng và dialog kết quả xoá (thêm 2026-11-03)

Yêu cầu người dùng: "xoá theo lô 1000 key, xoá xong thì hiện dialog báo số file thành công và số file thất bại, trong dialog có thêm 1 Accordion để hiện chi tiết file nào lỗi file nào thành công". Bổ sung (kèm screenshot): dialog cảnh báo xoá file đang nối tên thành một dòng `[file-0001.txt, file-0003.txt, ...]` khó đọc; muốn danh sách dạng Table, mỗi file một dòng. Bổ sung tiếp: "cho width dialog dài ra để có thể hiện đủ nội dung, đừng để xuất hiện thanh scroll ngang là được; name của file xuống dòng nếu dài quá cũng được".

Hiện trạng đã kiểm chứng trong code (trên branch `SP-12/refactor_be_bucket`, R7a chưa merge nên tên file / hàm có thể đổi sau khi R7a merge; developer phải đọc lại trên master mới):
- `deleteObject` (`submodule_object_mng.go:127`): timeout 5 phút, mỗi key gọi `HeadObject` rồi `DeleteObject` (6 song song), trả `Output[any]`, mỗi key một message `S3S005` (thành công) hoặc `S3E013` (lỗi).
- `deletePrefix` (`submodule_object_prefix.go:140`): đã dùng `prefixDeleter` (`deleteBatch` 1000 key/lô qua `DeleteObjects` với `Quiet`, fallback `deleteEach` 6 song song khi `isDeleteObjectsUnsupported`), timeout 30 phút (`deletePrefixTimeout`), trả `DeletePrefixOutput{Deleted int, Failed int}`; lỗi một phần đi `ThrowError(S3E021)` nên `Result=false`; thành công đi `S3S007`.
- `callIPC` (`ipcUtils.ts:76-87`) chỉ trả `body` khi `output.result == true`, nên muốn FE nhận số liệu khi có lỗi một phần thì lỗi theo key phải nằm trong body với `Result=true`.
- FE: `ObjectListView.tsx` dòng 29 `MAX_OBJECTS_PER_ACTION = 5` dùng chung cho xoá và download (dòng 130); confirm xoá dùng `C000004` với `objects.join(', ')` (dòng 146); `closeDetailIfDeletedByOutput` đọc message `S3S005` qua hằng `DELETE_OBJECT_SUCCESS_CODE`; `onClickDeleteFolder` (dòng 171) gọi `DeletePrefix`. `S3S005` / `S3E013` chỉ thấy dùng ở `submodule_object_mng.go` và test `src/test/pages/object/ObjectListView.test.tsx`.
- `ConfirmModal.tsx` (`components/modals/confirm/`) **không nhận nội dung tuỳ biến**: props chỉ có `type`, `confirmCode`, `params`; thân modal chỉ là `<Text ta="center">` của chuỗi `t('confirmCode.<code>')` qua `formatStringJson`; `size` mặc định `sm`. Footer đã đúng quy ước (Huỷ đỏ trái, OK phải). `C000004` chỉ được `ObjectListView.tsx` dùng (grep `src`, trừ test). `ConfirmModal` còn dùng ở nhiều nơi khác nên mọi thay đổi phải tương thích ngược.
- `modalLayout.ts` chỉ có `MODAL_CHROME_HEIGHT = '104px'` (chiều cao header + divider + footer, trừ khỏi viewport cho modal có thân chiều cao cố định); **không có quy ước về size rộng**. Các modal rộng hiện có dùng `size = 'xl'` (`UploadLimitModal`, `UploadPickerModal`, `ConnectModal`).
- `UploadFileList.tsx` đã export `VirtualRowList`, `FileRow`, `GroupRow`, `rowsHeight` (hàng cao cố định 36). Mẫu này dùng chiều cao cố định nên **không dùng lại được** cho bảng có hàng xuống dòng (xem F15).
- `UploadLimitModal.tsx:224` là mẫu `Accordion multiple variant="separated"`; footer dùng `Group p="8px" justify="space-between" wrap="nowrap"`.

### 9.1 Quyết định đã chốt bởi người dùng
- Bỏ giới hạn 5 cho **xoá**; **download giữ giới hạn 5** (`C000005` vẫn dùng cho download).
- `deleteObject` chuyển sang `DeleteObjects` theo lô 1000 key, **bỏ `HeadObject`**; key đã mất từ trước tính là thành công. Tái dùng `prefixDeleter` / `deleteBatch` / `deleteEach` / `isDeleteObjectsUnsupported` / `deleteBatchSize`.
- Dialog kết quả cho mọi lần xoá file và xoá folder; không hiện toast từng file.
- Xoá file: Accordion gồm danh sách file thành công và danh sách file lỗi kèm lý do, virtualize. Xoá folder: chỉ đếm số, chi tiết chỉ gồm danh sách lỗi có giới hạn (**1000 lỗi đầu**, Q13).
- Dialog xác nhận xoá file: danh sách file dạng Table, mỗi file một dòng; chiều cao tối đa, cuộn được, virtualize khi lớn; câu hỏi `C000004` giữ một câu ngắn, có thể kèm số file.
- Width dialog dài ra để hiện đủ nội dung; **không được có thanh scroll ngang**; tên file dài thì xuống dòng.
- Branch `SP-12/batch_delete_result`, tách từ `origin/master` sau khi PR #32 (R7a) merge, làm trước R7b.

### 9.2 Câu hỏi (R9)
Q13-Q19 đã được người dùng trả lời (2026-11-03). Q20 phát sinh sau khi người dùng yêu cầu dialog rộng hơn, **còn chờ trả lời**.

| # | Câu hỏi | Quyết định / đề xuất | Trả lời |
|---|---|---|---|
| Q13 | Số lỗi tối đa trả về cho dialog khi xoá folder (có thể tới hàng triệu key)? | **Chốt: 1000 lỗi đầu tiên** (không phải 100). `DeletePrefixOutput.Failures` tối đa 1000 mục (một hằng Go, ví dụ `maxFailureDetails = 1000`). Dialog hiện "Hiển thị {{shown}}/{{total}} lỗi" khi `failed > số lỗi đã trả`. Không liệt kê key thành công của folder, chỉ hiện số đếm. Payload IPC tối đa ~1000 x (key <= 1024 byte + lý do vài trăm byte) tức khoảng 1.5 MB trường hợp xấu nhất, thường nhỏ hơn nhiều; bảng bắt buộc virtualize (xem R9-2, R9-3). | A: 1000 (2026-11-03) |
| Q14 | Sau khi dialog thay toast, các mã message `S3S005`, `S3E013` (xoá file) và `S3S007`, `S3E021` (tổng kết xoá folder) không còn được phát. Xoá cả 4 mã khỏi `module.go` và 4 key khỏi `ipcMessage.json` của 7 ngôn ngữ? | **Chốt: xoá cả 4 mã** cùng key ở 7 ngôn ngữ. Không thêm mã message mới. Giữ `S3E020` (prefix không hợp lệ) và đường lỗi cấp call (`failCall`, `notConnectedMessage`, huỷ im lặng) như cũ. | A (2026-11-03) |
| Q15 | Câu hỏi `C000004` khi bảng đã liệt kê file: đổi nội dung thế nào? | **Chốt theo đề xuất:** đổi chính `C000004` ở `confirmModal.json` 7 ngôn ngữ, placeholder `{object}` thành `{count}`: "Xác nhận xoá {count} file đã chọn? Thao tác này không thể hoàn tác." (một câu chung cho 1 và nhiều file; bảng luôn hiện tên). Không thêm mã `C000007`. `C000005` giữ nguyên cho download. | A (2026-11-03) |
| Q16 | Timeout cho `deleteObject` khi không còn giới hạn số file (hiện 5 phút)? | **Chốt: 30 phút**, dùng chung một hằng `deleteTimeout` (đổi tên từ `deletePrefixTimeout`) cho cả `deleteObject` và `deletePrefix`. | A (2026-11-03) |
| Q17 | Dialog kết quả hiện luôn, kể cả khi chỉ xoá 1 file và thành công hết? | **Chốt theo đề xuất:** hiện luôn theo đúng yêu cầu "mọi lần xoá"; nếu thấy phiền thì sprint sau đổi thành chỉ hiện khi có lỗi hoặc > 1 file. | A (2026-11-03) |
| Q18 | Dialog xác nhận: mở rộng `ConfirmModal` hay làm modal xác nhận riêng? | **Chốt theo đề xuất:** mở rộng `ConfirmModal` bằng prop tuỳ chọn `items?: string[]` (không đổi hành vi khi không truyền); tái dùng header, icon, footer Huỷ/OK, kết quả `boolean`. Khi có `items`, thân modal gồm câu hỏi + `Paper withBorder` chứa `KeyTable`, dùng chung với dialog kết quả (F15). | A (2026-11-03) |
| Q19 | Bảng có cột nào, dựng bằng gì? | **Chốt theo đề xuất, kèm yêu cầu mới:** một cột "Tên file" ở dialog xác nhận và mục "Thành công"; mục "Thất bại" thêm cột "Lý do". Tên file và lý do **xuống dòng, không cắt `truncate`** (`overflow-wrap: anywhere`), **không scroll ngang**, chỉ scroll dọc với `max-height`. Dựng bằng lưới `div role="table"` (hàng định vị theo `translateY` của virtualizer, `grid-template-columns` với `minmax(0, …)`) để dùng `measureElement`. | A + yêu cầu xuống dòng / không scroll ngang (2026-11-03) |
| Q20 | Size dialog xác nhận (khi có `items`) và `DeleteResultModal`? | Đề xuất `xl` (cùng size với các modal rộng đang có: `UploadLimitModal`, `UploadPickerModal`, `ConnectModal`; `modalLayout.ts` không có quy ước size riêng). Có thể tăng lên `60rem`/`80%` (như `HistoryModal` dùng `80%`) nếu `xl` vẫn chưa đủ sau khi người dùng thử. Key rất dài vẫn xuống dòng nhờ `overflow-wrap`. | (chờ người dùng; làm theo đề xuất `xl` nếu không có ý kiến khác) |

### 9.3 Task backend (R9)
| # | Task | Yêu cầu | File sửa / tạo | Phụ thuộc |
|---|---|---|---|---|
| B9 | Model mới (json camelCase) và re-export: `DeleteFailure{Key, Error string}`; `DeleteObjOutput{Deleted []string, Failed []DeleteFailure}`; mở rộng `DeletePrefixOutput` giữ `Deleted int`, `Failed int` (tổng số lỗi, đếm đủ kể cả khi vượt giới hạn) và thêm `Failures []DeleteFailure` (**tối đa 1000 mục**, Q13). | R9 | `models/bucket/delete_failure.go` (tạo), `models/bucket/delete_object_output.go` (tạo), `models/bucket/delete_prefix_output.go` (sửa), `models/alias.go` (sửa: `DeleteFailure`, `DeleteObjOutput`) | R7a đã merge |
| B10 | Tổng quát hoá `prefixDeleter` thành bộ xoá theo lô dùng chung (đổi tên cho đúng nghĩa): `fail(key, detail)` luôn tăng `Failed++` và chỉ lưu chi tiết tới giới hạn cấu hình được (folder: hằng `maxFailureDetails = 1000`; file: không giới hạn, bị chặn bởi số key đã chọn); tuỳ chọn thu danh sách key đã xoá (chỉ bật cho `deleteObject`; key thành công = key trong lô trừ key nằm trong `out.Errors`, vì dùng `Quiet`). Giữ nguyên fallback `deleteEach`, lỗi request cả lô tính là lỗi từng key của lô, lỗi do ctx huỷ trả về cho bên gọi. Viết lại `deleteObject`: chia `input.Objects` thành lô `deleteBatchSize`, bỏ `HeadObject`, `deleteResult` và `errgroup` riêng, trả `Output[DeleteObjOutput]` với `Result=true` khi đã chạy tới cùng (kể cả có key lỗi); huỷ (`isCallCanceled`) trả im lặng; lỗi cấp call (không phải ctx huỷ) đi `failCall` như cũ nếu chưa xoá được key nào, ngược lại đếm vào lỗi từng key. Timeout: đổi `deletePrefixTimeout` thành `deleteTimeout` = 30 phút, dùng cho cả hai (Q16). | R9 | `internal/modules/bucket/submodule_object_prefix.go` (sửa), `internal/modules/bucket/submodule_object_mng.go` (sửa: xoá `deleteResult`, `deleteConcurrency` giữ nếu `deleteEach` còn dùng; bỏ timeout 5 phút) | B9 |
| B11 | `deletePrefix`: trả `Result=true` + body `{Deleted, Failed, Failures}` kể cả có lỗi từng key (thay `ThrowError(S3E021)` và bỏ `S3S007`); lỗi `ListObjectsV2` giữa chừng ghi thành 1 lỗi với key = prefix; huỷ vẫn trả im lặng (`ThrowError()` không message); prefix không hợp lệ giữ `S3E020`. Cập nhật chữ ký `DeleteObject` ở module và handler thành `Output[DeleteObjOutput]`, cập nhật doc comment. Xoá khỏi `module.go` các mã `S3S005`, `S3E013`, `S3S007`, `S3E021` (Q14; kiểm lại bằng grep rằng không còn nơi dùng). Xoá 4 key tương ứng trong `ipcMessage.json` của 7 ngôn ngữ, giữ đúng tập key. Sinh lại bindings. | R9 | `internal/modules/bucket/submodule_object_prefix.go`, `internal/modules/bucket/module.go`, `internal/handlers/bucket_handler.go` (đều sửa), `frontend/src/locales/{en,vi,ja,zh-CN,zh-TW,ru,de}/messages/ipcMessage.json` (sửa) | B10 |

Message code mới: không  |  Message code xoá: `S3S005`, `S3E013`, `S3S007`, `S3E021` (đã chốt, Q14)  |  Migration / sqlc: không  |  Cần sinh lại bindings: có (đổi kiểu trả về `DeleteObject`, model mới, `DeletePrefixOutput` thêm field).

### 9.4 Task frontend (R9)
| # | Task | Yêu cầu | File sửa / tạo | Phụ thuộc |
|---|---|---|---|---|
| F15 | Component bảng dùng chung `KeyTable`: lưới `div role="table"` (Q19), props `rows: {key: string; error?: string}[]`, `maxHeight` (mặc định như `LIST_MAX_HEIGHT` 320 của `UploadLimitModal`), nhãn cột do cha truyền; header cố định; cột "Lý do" chỉ hiện khi có `error`; `React.memo`. **Không bao giờ scroll ngang**: container `overflow-x: hidden`, chỉ `overflow-y: auto` với `max-height`; cột dùng `minmax(0, …)`; ô tên file và lý do dùng `overflow-wrap: anywhere` (cộng `word-break: break-word` dự phòng) vì key S3 thường không có khoảng trắng; **không dùng `truncate`/`nowrap`**. Vì hàng có chiều cao thay đổi, virtualize bằng `@tanstack/react-virtual` với **`measureElement`** (`ref={virtualizer.measureElement}` + `data-index` trên từng hàng, `estimateSize` chỉ là giá trị ước lượng ban đầu), không dùng chiều cao cố định và không tái dùng `VirtualRowList` của `UploadFileList` (hàng cố định 36); hàng định vị bằng `translateY(start)` trong container có `height: getTotalSize()`. Bảng "Thất bại" của folder có thể tới 1000 hàng nên virtualize bắt buộc. Modal kết quả `DeleteResultModal` (`createMantineModal`) **size mặc định `xl`** (Q20): props `deleted` (số), `failed` (số), `deletedKeys?: string[]` (chỉ xoá file), `failures: {key, error}[]`. Thân bọc `Paper withBorder`: hai dòng số liệu thành công / thất bại; `Accordion multiple variant="separated"` gồm mục "Thất bại" (mở sẵn khi có lỗi; `KeyTable` hai cột, cột "Lý do" cũng xuống dòng; thông báo "Hiển thị {{shown}}/{{total}} lỗi" khi `failed > failures.length`) và mục "Thành công" (chỉ khi có `deletedKeys`, `KeyTable` một cột; không có thì ẩn mục). Mở/đóng Accordion không làm layout nhảy (chiều cao panel bị chặn bởi `max-height` của bảng). Màu theo biến theme (`light-dark`, `var(--mantine-color-*)`), không hard-code. Footer `Group p="8px" justify="space-between" wrap="nowrap"` với nút OK (wrapper `Button`) bên phải. Namespace i18n mới `deleteResultModal` đăng ký ở `resource.ts` của cả 7 ngôn ngữ. | R9 | `frontend/src/components/modals/KeyTable.tsx` (tạo), `frontend/src/components/modals/delete/DeleteResultModal.tsx` (tạo), `frontend/src/locales/{en,vi,ja,zh-CN,zh-TW,ru,de}/components/modals/deleteResultModal.json` (tạo), `frontend/src/locales/{en,vi,ja,zh-CN,zh-TW,ru,de}/resource.ts` (sửa: đăng ký namespace; đường dẫn `resource.ts` chưa xác minh trên master) | B11 + sinh bindings |
| F16 | Mở rộng `ConfirmModal` (Q18): thêm prop tuỳ chọn `items?: string[]` (và nhãn cột lấy từ i18n `confirmModal` hoặc `common`); khi có `items` và không rỗng, thân modal giữ `<Text ta="center">` câu hỏi rồi `Paper withBorder` chứa `KeyTable` một cột (chiều cao tối đa, cuộn dọc, virtualize, tên file xuống dòng, không scroll ngang); khi không truyền `items` render y như cũ (các nơi dùng khác không đổi, vẫn mặc định `size = 'sm'`). Nơi gọi có `items` truyền `size: 'xl'` (Q20); nếu muốn an toàn thì khi có `items` mà không truyền `size`, `ConfirmModal` tự dùng `xl`. Đổi `C000004` ở `confirmModal.json` 7 ngôn ngữ theo Q15 (`{object}` thành `{count}`), thêm key nhãn cột nếu cần (giữ đúng tập key và placeholder cả 7 ngôn ngữ). | R9 | `frontend/src/components/modals/confirm/ConfirmModal.tsx` (sửa), `frontend/src/locales/{en,vi,ja,zh-CN,zh-TW,ru,de}/components/modals/confirmModal.json` (sửa) | F15 |
| F17 | `ObjectListView`: tách giới hạn 5 chỉ còn cho `download` (đổi tên hằng thành `MAX_DOWNLOAD_OBJECTS` hoặc kiểm `action === 'download'`); xoá file: `ConfirmModal.show({ confirmCode: 'C000004', params: { count: objects.length }, items: objects, size: 'xl' })` thay cho `objects.join(', ')` và `size: 'md'`; `callIPC(DeleteObject, ..., { showMessage: false })`; khi có `body`: `closeDetailIfDeleted(body.deleted)`, bỏ `closeDetailIfDeletedByOutput` và hằng `DELETE_OBJECT_SUCCESS_CODE`; giữ `setDeleting(true/false)` trong `try/finally` và `await onRefresh()`, rồi **mở `DeleteResultModal` sau khi đã reset deleting và refresh** (không `await` modal trong khối giữ trạng thái deleting). `onClickDeleteFolder`: `showMessage: false`; có `body` thì chỉ `closeDetailIfDeleted([folderKey])` khi `body.failed === 0` (giữ hành vi giữ drawer khi lỗi một phần), refresh, rồi mở dialog với `deleted`, `failed`, `failures` (không có `deletedKeys`). `body` null (huỷ, mất kết nối, credentials hết hạn, prefix không hợp lệ) thì không mở dialog, lỗi đã được toast bởi `callIPC`, vẫn refresh như cũ. Confirm xoá folder (`C000006`) giữ nguyên. | R9 | `frontend/src/pages/object/ObjectListView.tsx` (sửa) | F16 |

i18n key mới / đổi (7 ngôn ngữ): `deleteResultModal` (title, deletedCount, failedCount, failedSection, deletedSection, truncated, cột "Tên file" / "Lý do", ok, empty state nếu cần); `confirmModal.confirmCode.C000004` đổi placeholder thành `{count}`; nhãn cột bảng xác nhận. `C000005` giữ nguyên (cho download). Không có `C000007`.

### 9.5 Branch (R9)
| Branch | Yêu cầu | Task | Ghi chú |
|---|---|---|---|
| SP-12/batch_delete_result | R9 | B9, B10, B11, bindings, F15, F16, F17 | Tách từ `origin/master` sau khi PR #32 (R7a) merge; làm trước `refactor_be_rest` (R7b). Cùng sửa `submodule_object_mng.go`, `submodule_object_prefix.go`, `module.go`, `ipcMessage.json` x7 với R7a nên bắt buộc chờ merge R7a. R1 (F7/F8, đổi `ObjectListView.tsx` và `deletingItems`) đã merge trước đó nên không conflict; API `setDeleting` giữ nguyên. R8c/d/e (sau) phải tách branch sau khi R9 merge vì `ObjectListView.tsx`, `ConfirmModal.tsx` và `components/modals/` đổi. |

Quyền sở hữu file bổ sung: `ObjectListView.tsx` thêm R9 (sau R1/R5, trước R8e); `ConfirmModal.tsx`, `confirmModal.json` x7 chỉ R9 (trong sprint, R8d/R8e sau); `ipcMessage.json` x7: R7a -> R9 -> R7b; `components/modals/KeyTable.tsx`, `components/modals/delete/**` chỉ R9.

Thứ tự thực hiện R9: tách branch -> B9 -> B10 -> B11 -> `go tool wails3 generate bindings -clean=true -ts` (skill `wails3-bindings`) -> F15 -> F16 -> F17 -> FE test -> verify -> review -> commit (git-flow), tối đa 3 vòng. Sau R9 dừng báo cáo để người dùng test tay xoá file / folder trên AWS và MinIO (fallback `deleteEach` kiểm bằng provider không hỗ trợ `DeleteObjects` nếu có trong `test-env/`), gồm key rất dài không khoảng trắng và đủ 7 ngôn ngữ (không có scroll ngang).

### 9.6 Rủi ro (R9)
| # | Rủi ro | Mức độ | Cách giảm thiểu |
|---|---|---|---|
| R9-1 | Đổi hành vi: key đã mất trước đó trước đây báo lỗi (do `HeadObject`), nay tính thành công | low | Người dùng đã chốt; ghi vào `report.md` |
| R9-2 | Xoá folder tới hàng triệu key: tích luỹ danh sách lỗi không giới hạn gây tốn RAM / payload IPC lớn; giới hạn 1000 lỗi làm payload tối đa khoảng 1.5 MB | medium | Giới hạn 1000 lỗi (Q13), chỉ đếm số còn lại (`Failed` luôn đủ); không thu key thành công cho folder; bảng virtualize; kiểm tay với folder có > 1000 key lỗi (ví dụ policy cấm xoá) |
| R9-3 | Xoá file hàng chục nghìn key chọn tay: payload `Deleted []string` lớn; bảng xác nhận và dialog kết quả nặng | medium | Hai bảng đều virtualize; số key bị chặn bởi số item đã chọn; chưa xác minh giới hạn kích thước payload IPC của Wails nên kiểm tay với ~10k key |
| R9-4 | Mất kết nối / credentials hết hạn giữa chừng khi nhiều lô: lô lỗi đếm vào "thất bại" nhưng các lô sau vẫn chạy và lỗi tiếp | medium | Giữ hành vi sẵn có của `deleteBatch` (lỗi request tính theo từng key, tiếp tục lô sau); ghi log; nếu muốn dừng sớm khi lỗi call thì đưa thành câu hỏi sau |
| R9-5 | `Result=true` kể cả khi có key lỗi: bất kỳ nơi nào khác dựa `Result=false` để biết lỗi sẽ sai | medium | Chỉ `ObjectListView` gọi hai binding này (đã grep trong `frontend/src`, chưa xác minh toàn bộ sau khi R7a/R1 merge); kiểm lại bằng skill `wails3-bindings` |
| R9-6 | Provider không hỗ trợ `DeleteObjects` hoặc cần Content-MD5/checksum: `deleteBatch` đã có fallback từng key nhưng chỉ kiểm một số mã lỗi (`isDeleteObjectsUnsupported`) | medium | Tái dùng nguyên logic đã chạy với `deletePrefix`; kiểm tay trên MinIO và AWS theo `test-env/test-profiles.txt` |
| R9-7 | Bucket bật versioning: `DeleteObjects` tạo delete marker, không xoá vĩnh viễn (giống `DeleteObject` trước đây) | low | Không đổi hành vi; ghi chú trong `report.md` |
| R9-8 | Xoá key khỏi `ipcMessage.json` khi còn nơi dùng sót gây hiện key thô | low | grep `S3S005`, `S3E013`, `S3S007`, `S3E021` toàn repo trước khi xoá; cập nhật test `ObjectListView.test.tsx` đang dùng `S3S005` |
| R9-9 | Dialog mở sau `await onRefresh()`; nếu người dùng đổi tab / đóng tab trong lúc xoá thì modal vẫn hiện ở tab khác | low | Modal độc lập tab (NiceModal toàn cục); hiển thị `bucket` / `prefix` trong dialog để rõ ngữ cảnh nếu cần |
| R9-10 | Virtualizer trong jsdom không có layout thật (mọi phần tử có kích thước 0), nên `measureElement` không đo được chiều cao thật | medium | Xem R9-13 về cách test; ghi rõ nhánh không phủ được nếu có |
| R9-11 | Sửa `ConfirmModal` dùng chung làm hỏng các chỗ gọi khác | medium | `items` tuỳ chọn, mặc định render y như cũ; giữ nguyên test hiện có của `ConfirmModal` và thêm case có `items` |
| R9-12 | Đổi placeholder `C000004` (`{object}` thành `{count}`) ở 7 ngôn ngữ: sót file hoặc lệch placeholder gây hiện `{count}` thô | low | Test locale xác nhận cùng tập key / placeholder; grep mọi nơi gọi `C000004` (hiện chỉ `ObjectListView.tsx`) |
| R9-13 | Hàng có chiều cao thay đổi (tên file / lý do xuống dòng) nên phải dùng `measureElement`: dễ giật thanh cuộn dọc, nhảy vị trí khi hàng được đo lần đầu, sai `getTotalSize` khi đổi ngôn ngữ / font / đổi độ rộng dialog; khó test trong jsdom | medium | `estimateSize` sát thực tế (một dòng) để giảm nhảy; `overscan` đủ lớn (~10); hàng gắn `data-index` và `ref={measureElement}`, không đặt `key` theo index sai; không dùng `contain` làm sai phép đo. Test: mock `useVirtualizer` trả về danh sách item cố định và `measureElement` là `vi.fn()` để assert mỗi hàng render gắn `ref` và `data-index`; (nếu dùng virtualizer thật) giả lập `getBoundingClientRect` / `offsetHeight` và `ResizeObserver` trong setup để trả về các chiều cao khác nhau, rồi assert style `height`/`translateY` đổi theo; assert style của ô có `overflow-wrap: anywhere` và container không có `overflow-x: auto/scroll` (chỉ `hidden`); đo thật bằng tay trên WebView2 (key dài không khoảng trắng, 7 ngôn ngữ, font CJK). Phần chiều cao thật chỉ kiểm tay, ghi rõ trong `report.md` |
| R9-14 | Cột lưới bị tràn ngang do nội dung dài không ngắt được hoặc `minmax(0, …)` thiếu; hoặc dialog `xl` vẫn hẹp trên màn hình nhỏ | medium | `grid-template-columns` dùng `minmax(0, 1fr)`, ô có `min-width: 0` và `overflow-wrap: anywhere`; container `overflow-x: hidden`; người dùng kiểm tay ở độ phân giải nhỏ; có thể nâng size theo Q20 |

Lưu ý quy mô: R9 thêm 3 task backend, 3 task frontend, 1 branch (sprint-12 thành 12 branch, 28 task); cảnh báo >10 task đã có ở rủi ro #1, không đề xuất tách thêm vì R9 độc lập sau R7a.

### 9.7 Test frontend (R9, react-tester)
| Task | File cần test | Case cần phủ |
|---|---|---|
| F15 | `src/components/modals/KeyTable.tsx` (`src/test/components/modals/KeyTable.test.tsx`) | rỗng; một cột (không `error`); hai cột khi có `error`; hàng có lý do rỗng; danh sách lớn (ví dụ 1000 hàng) chỉ render các hàng trong khung nhìn (mock `useVirtualizer`); mỗi hàng gắn `measureElement` (`vi.fn`) và `data-index`; key rất dài không khoảng trắng: ô có `overflow-wrap: anywhere`, không có `white-space: nowrap`/ellipsis; container không có `overflow-x` auto/scroll (chỉ hidden) và có `max-height`; lý do dài cũng xuống dòng; header hiện nhãn cột truyền vào; chiều cao thay đổi khi `measureElement` trả giá trị khác nhau (nếu giả lập được trong jsdom) |
| F15 | `src/components/modals/delete/DeleteResultModal.tsx` (`src/test/components/modals/delete/DeleteResultModal.test.tsx`) | tất cả thành công (mục "Thất bại" ẩn hoặc rỗng); lỗi một phần (hiện cả hai mục, số đếm đúng); tất cả thất bại; chế độ folder (không có `deletedKeys`: ẩn mục "Thành công", chỉ đếm); `failed > failures.length` (ví dụ `failed` 5000, `failures` 1000) hiện thông báo "Hiển thị 1000/5000", `failed == failures.length` thì không; Accordion mở sẵn mục "Thất bại" khi có lỗi, mở mục khác khi không; modal dùng size `xl` mặc định (assert prop truyền cho `Modal.Root`); nút OK đóng modal (resolve); không warning `key` / i18next |
| F16 | `src/components/modals/confirm/ConfirmModal.tsx` (test hiện có, bổ sung) | không truyền `items`: render y như cũ (không có bảng, size `sm`); `items` rỗng: không có bảng; `items` có phần tử: hiện bảng đúng số hàng, câu hỏi với `params.count`, size `xl` (khi tự chọn / khi truyền); danh sách lớn virtualize; tên file dài xuống dòng, không scroll ngang; OK resolve `true`, Huỷ resolve `false`, cả hai nhánh `info` / `warning` giữ nguyên |
| F17 | `src/pages/object/ObjectListView.tsx` (`src/test/pages/object/ObjectListView.test.tsx`, cập nhật các test dùng `S3S005`) | xoá > 5 file không bị chặn bởi `C000005`; download > 5 vẫn bị chặn `C000005`; confirm gọi với `confirmCode: 'C000004'`, `params.count`, `size: 'xl'` và `items` đúng danh sách file (folder key bị loại); từ chối confirm thì không gọi `DeleteObject` và không mở dialog; gọi `DeleteObject` với `showMessage: false`; có `body` thì mở `DeleteResultModal` đúng `deleted`/`failed`/`failures`; drawer đóng khi key đang mở nằm trong `body.deleted`, giữ khi nằm trong `failed`; `setDeleting` true rồi false (kể cả khi lỗi, `try/finally`) và `onRefresh` được gọi trước khi mở dialog; `body` null (huỷ / lỗi call) thì không mở dialog nhưng vẫn refresh và reset deleting; folder: thành công đóng drawer + mở dialog chỉ đếm, lỗi một phần giữ drawer + dialog kèm `failures`, `body` null không dialog, bấm xoá lặp khi đang deleting bị bỏ qua, confirm bị từ chối; chọn chỉ folder thì bỏ qua |
| Locale | `src/test/locales` (đã có) | 7 ngôn ngữ có đúng tập key và placeholder cho `deleteResultModal`, `C000004` (`{count}`), nhãn cột; không còn key `S3S005`/`S3E013`/`S3S007`/`S3E021` ở `ipcMessage.json` |

### 9.8 Tiêu chí hoàn thành (R9)
- [ ] Xoá file / folder: `DeleteObjects` theo lô 1000 key, không còn `HeadObject`; fallback từng key hoạt động khi provider không hỗ trợ; timeout chung `deleteTimeout` = 30 phút
- [ ] Dialog xác nhận xoá file hiện danh sách dạng bảng mỗi file một dòng, có chiều cao tối đa, cuộn dọc và virtualize; câu hỏi `C000004` ngắn kèm số file; `ConfirmModal` ở các nơi khác không đổi
- [ ] Dialog xác nhận (có `items`) và `DeleteResultModal` dùng size `xl` (hoặc rộng hơn theo Q20); **không có thanh scroll ngang** ở bảng và dialog (kiểm tay với key rất dài không khoảng trắng, đủ 7 ngôn ngữ); tên file và lý do dài xuống dòng; chỉ có scroll dọc với `max-height`
- [ ] Bảng virtualize bằng `measureElement` (hàng chiều cao thay đổi), không giật / nhảy bất thường khi cuộn; `getTotalSize` đúng sau khi hàng được đo
- [ ] Dialog kết quả hiện số thành công / thất bại cho mọi lần xoá file và folder; Accordion chi tiết đúng (file: thành công + thất bại; folder: chỉ lỗi, **tối đa 1000**, có thông báo "Hiển thị x/y" khi bị cắt bớt, `Failed` luôn là tổng số lỗi thật)
- [ ] Không còn toast từng file; lỗi cấp call (mất kết nối, credentials hết hạn) vẫn toast; huỷ vẫn im lặng
- [ ] Xoá > 5 file không bị chặn, download > 5 vẫn bị chặn
- [ ] 4 mã `S3S005`, `S3E013`, `S3S007`, `S3E021` đã xoá khỏi `module.go` và `ipcMessage.json` x7; `S3E020` còn nguyên
- [ ] Bindings sinh lại, không sửa tay `frontend/bindings/**`; 7 ngôn ngữ cùng tập key; test FE C1 >= 95% mỗi file đã đổi, console sạch
