# Plan sprint-07: Rà soát, tối ưu và chuẩn bị phát hành 0.0.1-beta.1

## 1. Tóm tắt yêu cầu
- R1: Refactor toàn bộ Go (`main.go`, `internal/**`, `models/**`) và FE (`frontend/src/**`) mà không đổi hành vi; xoá code chết, import thừa, key i18n không dùng.
- R2: Doc comment cho mọi hàm/type exported Go và comment package; JSDoc cho util, hook, store, component phức tạp; tài liệu kiến trúc cho dev mới.
- R3: Đánh giá và tối ưu hiệu năng (BE và FE), ghi số đo trước/sau; mức cao phải xử lý trong sprint.
- R4: README (en/vi/ja), hướng dẫn sử dụng PDF (3 ngôn ngữ, có mục lục và ảnh), CHANGELOG 3 ngôn ngữ, PDF sinh lại bằng một lệnh.
- R5: Chốt version `0.0.1-beta.1` ở mọi nơi khai báo; build được bản cài đặt và portable.
- Ngoài phạm vi: tính năng mới, unit test Go, đổi UI/UX, commit/tag/release.

Kiểm chứng tiền đề (đã đọc thực tế):
- Ràng buộc "sprint 06 chưa có report.md" **đã lỗi thời**: `sprints/sprint-06/report.md` tồn tại, trạng thái DONE 2026-10-28, người dùng đã kiểm thủ công; git sạch, commit `eb9064f` là upload picker modal (theo thông tin điều phối). Có thể bắt đầu ngay.
- Backend hiện không có file `*_test.go` nào (Glob). FE có test cho hầu hết file (580 test ở sprint 06).
- `.golangci.yml` chỉ bật bodyclose, errcheck, govet, ineffassign, lll, misspell, staticcheck, unconvert, unused: **không có linter kiểm doc comment exported** (cần cách kiểm chứng riêng, xem đợt 0/B5).
- `frontend/src/` không có chỗ hiển thị version trong UI (grep), nên "màn hình hiển thị version" của R5 không áp dụng.

## 1.1 Quyết định đã chốt (người dùng đã trả lời)
- **Tách sprint:** 
  - **Sprint 07a = R1–R3** (Đợt 0, B0–B5, F0–F6): làm ngay.
  - **Sprint 07b = R4–R5** (D1–D4, V1–V2): làm ở lượt sau, sau khi 07a xong và giao diện ổn định (để chụp ảnh đúng). Thư mục `sprints/sprint-07/` dùng chung; report 07a ghi riêng phần, 07b bổ sung sau.
- **License:** MIT, copyright `minh-truyen`.
- **Công cụ PDF:** `markdown-it` + `playwright` khai báo trong `docs/package.json`, chạy bằng `bun`.
- **`OBJECT_PAGE_SIZE` 10 -> 20:** ban đầu chốt 50; sau khi đo (xem `baseline.md`), page 50 làm trang đầu trên MinIO chậm ~3 lần nên người dùng chốt lại **20**.
- **Dependency:** đồng ý gỡ/thay `redux`, `lodash`, `uuid` (sau khi grep xác minh không còn dùng; thay bằng native, ví dụ `crypto.randomUUID` hoặc tự sinh id thay `uuid` v7 nếu cần thứ tự thời gian: kiểm khi làm F0/F5).
- **Các câu còn lại (Q2–Q10):** theo đề xuất mặc định trong bảng dưới.

## 2. Câu hỏi và trả lời
| # | Câu hỏi | Đề xuất | Trả lời |
|---|---|---|---|
| Q1 | License cụ thể? | MIT | **Đã chốt: MIT, copyright `minh-truyen`** |
| Q2 | Nguồn dữ liệu chụp ảnh? | MinIO Docker local, dữ liệu giả, credential tạm không vào repo; ẩn key trong ảnh form | Theo đề xuất (áp dụng ở 07b) |
| Q3 | Map version Windows? | `0.0.1.1` cho `file_version`/manifest/VIProductVersion; chuỗi hiển thị `0.0.1-beta.1`; sửa `project.nsi` (mục 6.2) | Theo đề xuất (07b) |
| Q4 | Vị trí Markdown/PDF, commit PDF? | `docs/user-guide/<lang>/user-guide.md` -> `S3Browser-user-guide.<lang>.pdf` cùng thư mục, ảnh trong `images/`; commit PDF và ảnh | Theo đề xuất (07b) |
| Q5 | Tài liệu kiến trúc? | `docs/ARCHITECTURE{,.vi,.ja}.md`, README link tới | Theo đề xuất (07b) |
| Q6 | Ngưỡng hiệu năng? | Không ngưỡng tuyệt đối; không chậm hơn, bundle gzip không tăng, số render không tăng; đo trước/sau | Theo đề xuất (07a) |
| Q7 | Viết lại README (hiện là template Wails)? | Viết lại hoàn toàn, chuyển lệnh dev thành mục "Build từ source" | Theo đề xuất (07b) |
| Q8 | Hiển thị version trong app? | Không thêm (tính năng mới) | Theo đề xuất |
| Q9 | macOS/Linux/iOS trong R5? | Sửa version đồng bộ, không build thử, ghi "chưa kiểm tra"; iOS giữ nguyên nếu không dùng | Theo đề xuất (07b) |
| Q10 | Không chạy `update:build-assets`, sửa tay file build? | Có, sửa tay (mục 6.2) | Theo đề xuất (07b) |
| Q11 | Chấp nhận Playwright (Chromium ~150MB) làm devDependency của `docs/`? | Có | **Đã chốt: markdown-it + Playwright, bun** |
| Q12 | Tăng `OBJECT_PAGE_SIZE` 10 -> 50? | Có, sau khi đo | **Đã chốt: 20 (sau khi đo)** |
| Q13 | Gỡ/thay `redux`, `lodash`, `uuid`? | Gỡ sau khi grep xác minh | **Đã chốt: đồng ý** |

Không còn câu hỏi mở cho 07a. Câu hỏi mới phát sinh khi triển khai sẽ dừng task và báo (luật 6).

## 3. Task backend (go-backend) — thuộc sprint 07a
Quy ước mỗi đợt: tự `go build`, `go vet`, `go tool golangci-lint run ./...` pass. Không đổi chữ ký handler/model nên **dự kiến không cần sinh lại bindings**; nếu đổi thì chạy skill `wails3-bindings` ngay trong đợt đó.

| # | Đợt | Phạm vi, file dự kiến đổi | Việc refactor / doc / tối ưu cụ thể | Agent | Phụ thuộc |
|---|---|---|---|---|---|
| B0 | Nền: entry, hạ tầng, model | `main.go`, `internal/app.go`, `internal/config.go`, `internal/pkg/utils/{common,crypto}.go`, `internal/pkg/cnst/common.go`, `internal/pkg/logger/logger.go`, `internal/pkg/db/{init_db,migration}.go`, `internal/pkg/portable/portable_{on,off}.go`, `models/**` (alias.go, common/*, bucket/*, profile/*, master/*) | Comment package; doc comment mọi type/hàm exported; kiểm `models/alias.go` đủ alias, xoá alias/hằng thừa (`unused` + grep); comment "tại sao" cho `ReportEvery` (goroutine, `stop`), `KeyManager`, portable build tag. Không sửa `internal/pkg/db/sqlc/**`. | go-backend | - |
| B1 | Module dùng chung: global, master, profile, handlers | `internal/modules/global/{module,submodule_conn_container}.go`, `internal/modules/master/modules.go`, `internal/modules/profile/module.go`, `internal/handlers/{bucket,master,profile}_handler.go` | Doc comment; comment "Remove* trả về connection để đóng ngoài lock" (`sync.RWMutex`); `profile/module.go` lặp mapping `Version: result.Version` (dòng 122/161/190/272/315) -> gom hàm map sqlc row -> `ConnectionProfileOutput`; handler giữ mỏng. | go-backend | B0 |
| B2 | Bucket module: connection, bucket, search, cfg | `internal/modules/bucket/{module,events,submodule_connection_mng,submodule_bucket_mng,submodule_search_mng,submodule_cfg_mng}.go` | Doc cho `Module.*`; nhóm/comment mã message `S3xxx`; gom đoạn lặp `WithTimeout + AfterFunc(appContext) + defer stop` (lặp ở object_mng, object_detail, prefix, search, bucket_mng) thành helper có comment lý do ("Wails tách call ctx khỏi vòng đời app"); gom đoạn lặp "kiểm connection -> `S3E006`"; rà vòng phân trang tìm kiếm (`searchMaxResults`/`searchPageSize`). | go-backend | B1 |
| B3 | Bucket module: object | `internal/modules/bucket/{submodule_object_mng,submodule_object_prefix,submodule_object_detail}.go` | Comment xoá đệ quy theo prefix (`deleteBatchSize`, `deleteConcurrency`, `deletePrefixTimeout`) và lý do dùng `errgroup.Group` không chia sẻ context; dùng helper chung của B2; kiểm biên `Limit` của `ListObjectsV2` (`MaxKeys: &input.Limit`, chưa xác minh hành vi với Limit<=0/>1000). | go-backend | B2 |
| B4 | Upload / download | `internal/modules/bucket/{submodule_uploader_mng,uploader_expand,submodule_s3_upload,submodule_downloader_mng,submodule_s3_download,submodule_download_history_mng}.go` | Comment "tại sao": batch + `batchMu`, `jobs` + huỷ, `uploadFileConcurrency`/`uploadPartConcurrency`, multipart abort bằng `context.WithoutCancel`, `.part` khi download, `destsMu`; tách `submodule_uploader_mng.go` (>540 dòng) thành file theo trách nhiệm; xoá hằng/hàm không dùng. Progress đã throttle 200ms nên không phải vấn đề hiệu năng. | go-backend | B3 |
| B5 | Xác minh toàn backend (+ bindings nếu cần) | toàn bộ Go | `go build ./...`, `go vet ./...`, `go tool golangci-lint run ./...`; kiểm doc comment exported bằng config tạm ngoài repo (ví dụ revive rule `exported`, đặt ở scratchpad, không commit); nếu đổi chữ ký/model: `go tool wails3 generate bindings -clean=true -ts` qua skill `wails3-bindings`. | go-backend, verifier | B4 |

Message code mới: không  |  Migration / sqlc: không  |  Cần sinh lại bindings: dự kiến không (chỉ khi đổi chữ ký/model, báo trong report)

## 4. Task frontend (react-frontend) và test (react-tester) — thuộc sprint 07a
Mỗi đợt: react-frontend sửa (kèm comment/JSDoc ngay khi refactor) -> react-tester -> verifier -> code-reviewer. Mọi file FE đã đổi (kể cả chỉ thêm comment) phải đạt C1 >= 95% và Lines >= 95% per-file. Chạy test sau mỗi đợt.

| # | Đợt | Phạm vi, file dự kiến đổi | Việc refactor / doc / tối ưu cụ thể | Agent | Phụ thuộc |
|---|---|---|---|---|---|
| F0 | Common: stores, utils, hooks | `frontend/src/common/utils/{ipcUtils,stringUtils,convertUtils,modalUtils,uploadUtils}.ts`, `common/stores/{createStore,commonStore,masterDataStore,profileStore,tabListStore,uploaderStore,downloaderStore,modalStackStore}.ts`, `common/hooks/useFieldError.ts`, `common/cnst/commonConst.ts` | JSDoc mọi util/hook/store; **`stringUtils.ts`: bỏ `import { isEmpty, isNil } from 'lodash'` (nạp cả lodash), thay bằng kiểm tra native; thay `uuid` `v7` bằng giải pháp native (người dùng đã đồng ý; nếu cần id sắp xếp theo thời gian thì tự viết hàm nhỏ có test; nếu phát hiện cần giữ `uuid`, dừng và báo)**; rà store: selector hẹp, `reset()` có `invalidateLoads`; xoá export không dùng (grep). | react-frontend, react-tester | B5 |
| F1 | Component dùng chung | `components/buttons/{Button,ActionIcon}.tsx`, `components/inputs/{SwitchInput,CheckBoxInput,FieldInput,SegmentedControl,SearchInput}.tsx`, `components/inputs/combobox/{Combobox,RegionCombobox,BucketPicker}.tsx`, `components/modals/{ConfirmModal,modalColors}`, `components/router/RouterItem.tsx`, `App.tsx`, `locales/i18n.ts` | JSDoc cho Combobox, RegionCombobox, BucketPicker; gom code lặp giữa các combobox nếu thật sự trùng; hằng màu header modal thống nhất; `i18n.ts` nạp lazy ngôn ngữ phụ chỉ khi đo thấy lợi ích (mức thấp). | react-frontend, react-tester | F0 |
| F2 | Layout, tab, kết nối | `components/layouts/MainLayout.tsx`, `navbar/LeftNavbar.tsx`, `navbar/components/{ConnectionProfiles,HeaderButtonGroup}.tsx`, `tab/TabLayout.tsx`, `tab/components/TabLabel.tsx`, `components/modals/ConnectModal.tsx` | Rút gọn `ConnectModal` (tách schema zod/hằng); lazy load modal nặng (`ConnectModal`, `HistoryModal`); kiểm `TabLayout` re-render khi đổi tab. | react-frontend, react-tester | F1 |
| F3 | Bucket, object, search | `pages/bucket/{BucketListView,BucketItem}.tsx`, `pages/object/{ObjectListView,ObjectItem}.tsx`, `tab/components/{TabDetail,ObjectDetailDrawer}.tsx` | `ObjectListView.tsx` (473 dòng): tách hook (`useObjectPaging`, `useFilesDroppedUpload`), gộp state liên quan; **đo rồi đổi `OBJECT_PAGE_SIZE` 10 -> 20 (đã chốt sau khi đo)**; `TabDetail.tsx` (395 dòng) tách breadcrumb + thanh action; dedupe `Set` ở `loadNextPage` (thấp); JSDoc. Giữ nguyên hành vi (loading, cursor, huỷ). | react-frontend, react-tester | F2 |
| F4 | Upload / download | `components/layouts/uploader/{UploaderWindow,UploaderItem}.tsx`, `components/layouts/downloader/{DownloaderWindow,DownloaderItem}.tsx`, `components/modals/{UploadLimitModal,UploadPickerModal,HistoryModal}.tsx` | Gom `FileRow`/`FileList` trùng giữa `UploadLimitModal` và `UploadPickerModal` (không đổi giao diện); gom 3 `useEffect` `Events.On` giống nhau của `UploaderWindow` thành hook chung; kiểm render khi nhận `upload-progress` và ghi số đo. | react-frontend, react-tester | F3 |
| F5 | i18n sạch và dependency | `frontend/src/locales/{en,vi,ja}/**`, `frontend/package.json` (+ lockfile bun) | Script kiểm một lần (scratchpad, không commit trừ khi người dùng muốn) so khớp key i18n với `t()`/`i18n.t()` và mã `S3xxx/PFxxx/MTxxx` trong Go với `ipcMessage.json`; xoá key thừa ở **cả 3 ngôn ngữ**; kiểm key lệch giữa 3 ngôn ngữ; **gỡ `redux`, `lodash`, `@types/lodash`, `uuid` khỏi `package.json` (đã được đồng ý) sau khi grep xác nhận không còn import; kiểm `zustand/middleware` devtools chạy không cần `redux` (chưa xác minh)**; chạy `bun install` cập nhật lockfile. | react-frontend | F4 |
| F6 | Xác minh toàn FE | toàn bộ `frontend/src` | `biome check`, `oxlint`, `tsc --noEmit`, vitest toàn bộ + coverage per-file mọi file đã đổi; `vite build` so bundle với baseline đợt 0; kiểm LF. | react-tester, verifier | F5 |

i18n key mới (en/vi/ja): không (chỉ xoá key không dùng).

Test frontend (react-tester): giữ test hiện có xanh, bổ sung case cho nhánh mới do tách hàm/hook; không snapshot; mock `@wails/...`, `callIPC`, `@wailsio/runtime`.
| Đợt | File cần test | Case cần phủ |
|---|---|---|
| F0 | `src/test/common/utils/*.test.ts`, `src/test/common/stores/*.test.ts`, `src/test/common/hooks/useFieldError.test.tsx` | `stringUtils` sau khi bỏ lodash/uuid: chuỗi rỗng/null/undefined/khoảng trắng, `formatStringJson` thiếu tham số, hàm sinh id (duy nhất, định dạng); `ipcUtils`: trả body, trả null, reject, abort, `showMessage` bật/tắt, `invalidateLoads`; store: mỗi action thành công, biên (`finishedIds` > 200, `startUpload` sau `finishUpload`), `reset`; `modalUtils`; `uploadUtils` (`ensureUploadIdle` bận/rảnh, `runUpload` lỗi/huỷ). |
| F1 | `src/test/components/buttons/*`, `inputs/*`, `inputs/combobox/*`, `modals/ConfirmModal`, `router/RouterItem`, `App.test.tsx` | Render mặc định, disabled/loading, onChange/onClick; combobox: danh sách rỗng, lọc, chọn, tải thêm, lỗi load; `RouterItem` Suspense fallback; `ConfirmModal` confirm/cancel. |
| F2 | `src/test/components/layouts/**`, `components/modals/ConnectModal.test.tsx` | `ConnectModal`: validate từng field, tạo/sửa, test kết nối thành công/thất bại, huỷ; `ConnectionProfiles`: nhận event lưu profile, kết nối/ngắt/xoá, danh sách rỗng; `TabLayout`/`TabLabel`: thêm/đóng tab; `MainLayout`, `LeftNavbar`, `HeaderButtonGroup`. |
| F3 | `src/test/pages/**`, `components/layouts/tab/components/*` | `ObjectListView`/hook mới: trang đầu thành công/null/rỗng, trang kế (trùng key, cursor lặp -> dừng, lỗi -> `loadMoreError`), đổi prefix/keyword giữa chừng (huỷ request cũ), refresh, xoá file/thư mục (xác nhận/huỷ/lỗi một phần), chặn > `MAX_OBJECTS_PER_ACTION`, `files-dropped` đúng/sai `tabId`, page size mới; `TabDetail`: breadcrumb, tìm kiếm, nút upload/refresh/xoá/download, nhánh cũ chưa phủ; `ObjectDetailDrawer`: có/không metadata, copy; `BucketListView`/`BucketItem`: rỗng, lỗi, chọn. |
| F4 | `src/test/components/layouts/{uploader,downloader}/*`, `components/modals/{UploadLimitModal,UploadPickerModal,HistoryModal}.test.tsx` | `UploaderWindow`: started/progress/finished, hiện nút khi đóng, huỷ tất cả, vị trí theo downloader; `FileList/FileRow` dùng chung: chọn/bỏ chọn, vượt giới hạn, xoá, virtualize; `UploadPickerModal`: chọn file qua dialog, kéo thả event, vượt giới hạn, toast `skipped`; `HistoryModal`: rỗng/có dữ liệu/lỗi. |
| F5 | (không có code production mới) | Chạy lại toàn bộ test sau xoá key i18n và gỡ dependency. |
| F6 | toàn bộ file đã đổi | Báo cáo coverage per-file (Branches và Lines >= 95%), liệt kê nhánh không test được kèm lý do. |

## 5. Thứ tự thực hiện (luôn tuần tự; không chạy hai agent viết code song song)

### Sprint 07a (R1–R3): làm ngay
Mỗi đợt chạy trọn B4 (code -> bindings nếu cần -> FE -> test -> verify -> review, tối đa 3 vòng) trước khi sang đợt kế; quá 3 vòng thì dừng và hỏi. Người dùng tự commit sau mỗi đợt nếu muốn để diff tách bạch.
0. Đợt 0 (baseline, verifier/orchestrator, không sửa code): ghi baseline `go build/vet/lint`, `biome`, `oxlint`, `tsc`, vitest (số test, thời gian), kích thước `frontend/dist` sau `vite build` (JS/CSS, raw + gzip); đo thời gian list/search trên MinIO local (cần MinIO + dữ liệu mẫu ~1.000 object, không ghi secret vào repo); chuẩn bị checklist smoke thủ công S3 + MinIO.
1. Backend: B0 -> B1 -> B2 -> B3 -> B4 -> B5
2. `go tool wails3 generate bindings -clean=true -ts` (chỉ khi có đổi chữ ký/model)
3. Frontend: F0 -> F1 -> F2 -> F3 -> F4 -> F5 -> F6
4. FE test (react-tester) trong từng đợt F, tổng kiểm ở F6
5. `report.md` (phần 07a): danh sách refactor (file, lý do), bảng hiệu năng có số đo, coverage, các điểm cần cập nhật `CLAUDE.md`.

### Sprint 07b (R4–R5): lượt sau, bắt đầu sau khi 07a xong
6. Tài liệu: D1 -> D2 -> D3 -> D4 (mục 6.1)
7. Version: V1 -> V2 (mục 6.2)

## 6. Task tài liệu và phát hành — thuộc sprint 07b

### 6.1 R4: Công cụ PDF, vị trí, ảnh chụp
Agent: react-frontend (script Node/bun, không phải code app) hoặc go-backend cho Taskfile; react-tester không áp dụng (không thuộc `frontend/src`). Ghi tên công cụ và cách dùng vào `report.md`.

- Công cụ (đã chốt): thư mục độc lập `docs/` có `package.json` riêng (không lẫn `frontend/`), chạy bằng `bun`:
  - `markdown-it` (+ `markdown-it-anchor`, `markdown-it-toc-done-right`) dựng HTML có mục lục từ Markdown.
  - `playwright` (Chromium) để `page.pdf()` xuất PDF và chụp ảnh.
  - Font nhúng qua npm: `@fontsource/noto-sans` (subset vietnamese) và `@fontsource/noto-sans-jp`. Chưa xác minh tên gói/subset, kiểm khi cài.
- Một lệnh sinh lại: `bun run --cwd docs build:pdf` (3 ngôn ngữ), alias `go tool wails3 task docs:pdf` trong `Taskfile.yml`. Chụp ảnh tách riêng (`bun run --cwd docs shots`) vì cần MinIO.
- Vị trí (theo Q3–Q5):
  - `README{,.vi,.ja}.md`, `CHANGELOG{,.vi,.ja}.md`, `LICENSE` (MIT, `minh-truyen`) ở gốc `App/S3Browser`.
  - `docs/ARCHITECTURE{,.vi,.ja}.md`: luồng handler -> module -> submodule, `callIPC`, store (zustand+immer, SCOPE, `invalidateLoads`), event (`domain:kebab-name`, `RegisterEvent`, `Events.On`), mã message <-> `ipcMessage.json`, container kết nối `global`.
  - `docs/user-guide/<lang>/user-guide.md`, `images/`, PDF cùng thư mục (commit).
- Ảnh chụp: MinIO Docker local + script seed dữ liệu giả (`docs/seed/`, credential từ biến môi trường). Chạy app `go tool wails3 task dev`; Playwright mở URL dev server (README cũ ghi `http://localhost:34115`; v3 có thể khác, **chưa xác minh**, tra https://v3.wails.io/ khi làm). Phần native (hộp thoại chọn file, kéo thả từ Explorer) chụp bằng PowerShell (`System.Drawing` CopyFromScreen) hoặc thủ công; ghi rõ ảnh nào chụp thế nào. Tên ảnh cố định theo kịch bản; ẩn key trong form kết nối.

| # | Đợt | Việc | File tạo/sửa | Agent |
|---|---|---|---|---|
| D1 | Kiến trúc | Tài liệu kiến trúc 3 ngôn ngữ dựa trên code sau refactor 07a | `docs/ARCHITECTURE{,.vi,.ja}.md` | react-frontend (hoặc go-backend) |
| D2 | Công cụ tài liệu | `docs/package.json`, script `build:pdf`, `shots`, template HTML/CSS, task `docs:pdf` | `docs/package.json`, `docs/scripts/*`, `docs/theme.css`, `Taskfile.yml` | react-frontend |
| D3 | Ảnh và hướng dẫn | Seed MinIO, chụp ảnh 3 ngôn ngữ, viết `user-guide.md` x3 (kết nối S3/MinIO, duyệt, upload kéo thả + modal, download, xoá, tìm kiếm, chi tiết object, đổi ngôn ngữ, lỗi thường gặp), sinh PDF | `docs/user-guide/**`, `docs/seed/**` | react-frontend |
| D4 | README, CHANGELOG, LICENSE | 3 README (giới thiệu, tính năng, ảnh, yêu cầu hệ thống, cài đặt + portable, build từ source, cấu trúc thư mục, đóng góp, license), 3 CHANGELOG, LICENSE MIT; kiểm làm theo được từ máy trống | `README*.md`, `CHANGELOG*.md`, `LICENSE` | react-frontend |

### 6.2 R5: Mọi nơi khai báo version (grep thực tế)
| # | File | Dòng | Giá trị hiện tại | Đề xuất |
|---|---|---|---|---|
| 1 | `build/config.yml` | 14 | `version: "0.0.1"` | `0.0.1-beta.1` |
| 2 | `frontend/package.json` | 4 | `"version": "0.0.0"` | `0.0.1-beta.1` |
| 3 | `build/windows/info.json` | 3, 7 | `file_version: "0.0.1"`, `ProductVersion: "0.0.1"` | `file_version: "0.0.1.1"`, `ProductVersion: "0.0.1-beta.1"` |
| 4 | `build/windows/wails.exe.manifest` | 3 | `assemblyIdentity version="0.0.1"` | `0.0.1.1` |
| 5 | `build/windows/nsis/wails_tools.nsh` | 17 | `INFO_PRODUCTVERSION "0.0.1"` ("DO NOT EDIT", sinh từ config) | `0.0.1-beta.1` (cho `DisplayVersion`, dòng 129/140) |
| 6 | `build/windows/nsis/project.nsi` | 38-39, 43-44 | `VIProductVersion/VIFileVersion "${INFO_PRODUCTVERSION}.0"` | **Phải sửa**: nối `.0` vào `0.0.1-beta.1` làm NSIS lỗi. Thêm define số (ví dụ `INFO_NUMERIC_VERSION "0.0.1.1"`) cho `VIProductVersion/VIFileVersion`; `VIAddVersionKey ProductVersion/FileVersion` dùng chuỗi `0.0.1-beta.1` |
| 7 | `build/darwin/Info.plist` | 18, 20 | `0.0.1` | `CFBundleShortVersionString` `0.0.1`, `CFBundleVersion` `1` (quy tắc Apple chưa xác minh); không build thử |
| 8 | `build/darwin/Info.dev.plist` | 18, 20 | như trên | như trên |
| 9 | `build/linux/nfpm/nfpm.yaml` | 9 | `version: "0.0.1"` | `0.0.1~beta.1` hoặc `0.0.1` + `release: beta.1` (chưa xác minh với nfpm) |
| 10 | `build/ios/Info.plist`, `Info.dev.plist` | 16/18 | `0.0.1`, dev `0.0.1-dev` | giữ nguyên nếu iOS không dùng |
| 11 | `build/linux/desktop` | 2 | `Version=1.0` | Không đổi (phiên bản spec Desktop Entry) |
| 12 | `go.mod`/`main.go`/`Taskfile.yml` | - | không có version app | Không đổi |
| 13 | `README`/`CHANGELOG`/PDF | - | - | Ghi `0.0.1-beta.1` |

Chưa xác minh: `msix`, `android`, `server` dưới `build/` không thấy trong glob, grep lại lúc triển khai. `build/bin/**` không phải nguồn khai báo; kiểm đã gitignore (chưa xác minh).

| # | Đợt | Việc | Agent |
|---|---|---|---|
| V1 | Cập nhật version | Sửa các file trong bảng; `package.json` | go-backend (build/**), react-frontend (`package.json`) |
| V2 | Build kiểm chứng | `go tool wails3 task package` (hoặc `INSTALL_SCOPE=user`) và `go tool wails3 task build:portable WEBVIEW2_DIR=...` (cần người dùng cung cấp đường dẫn); kiểm Properties -> Details của `.exe`, `DisplayVersion` trong registry, portable chạy không cần cài | verifier + người dùng |

## 7. Bảng đánh giá hiệu năng sơ bộ (từ đọc code, chưa đo) — sprint 07a
Đã đúng hướng (không cần sửa): tiến độ upload/download đã throttle 200ms (`utils.ReportEvery`, `submodule_s3_upload.go:91`, `submodule_s3_download.go:49`); concurrency có `SetLimit`; list object phân trang bằng `ContinuationToken`; danh sách object/bucket/uploader/history/modal đều virtualize; mọi `Events.On` có `unsubscribe` trong cleanup; `ObjectItem`, `BucketItem`, `UploaderItem`, `DownloaderItem`, `SearchInput`, `TabDetail` đã `memo`; `TabLayout` đã lazy.

| # | Vấn đề | File | Mức | Đề xuất xử lý |
|---|---|---|---|---|
| P1 | `import { isEmpty, isNil } from 'lodash'` nạp cả lodash CJS (không tree-shake) chỉ để dùng 2 hàm | `common/utils/stringUtils.ts` | Trung (cần đo gzip) | Thay native, gỡ `lodash` + `@types/lodash` (đã được đồng ý); đo bundle trước/sau |
| P2 | Chỉ `TabLayout` lazy; `ConnectModal` (zod+form), `HistoryModal`, `UploadPickerModal`, `UploadLimitModal`, `ObjectDetailDrawer` nằm trong bundle chính | `components/modals/*`, `RouterItem.tsx` | Trung | Lazy `import()` ở nơi mở modal; đo bundle và thời gian mở modal lần đầu |
| P3 | `OBJECT_PAGE_SIZE = 10`: bucket lớn cần rất nhiều round trip khi cuộn | `pages/object/ObjectListView.tsx:32` | Trung (cao nếu bucket lớn) | Đo trên MinIO ~1.000 object (đã đo, xem `baseline.md`), tăng lên 20 (đã chốt); giữ cơ chế tự tải khi còn 2 dòng |
| P4 | `ObjectListView` 473 dòng, 8 `useState` -> re-render cả list theo từng state | `pages/object/ObjectListView.tsx` | Trung | Tách hook, gộp state bằng `useReducer`; `ObjectItem` đã `memo`; đo số render trong test |
| P5 | `i18n.ts` nạp đồng thời tài nguyên 3 ngôn ngữ | `locales/i18n.ts` | Thấp | Nạp lazy ngôn ngữ phụ nếu số đo đáng kể |
| P6 | `loadNextPage` tạo `new Set(prev.map(...))` mỗi trang (O(n)) | `ObjectListView.tsx:172` | Thấp | Giữ Set key trong ref hoặc chỉ dedupe khi search |
| P7 | `selectUploadingIds` = `Object.keys` mỗi lần store đổi (kể cả progress); `finishedIds.includes` | `common/stores/uploaderStore.ts` | Thấp | Chấp nhận; đổi chỉ khi đo thấy tốn |
| P8 | `setUploadProgress` dùng immer cho mỗi event (200ms/file) | `uploaderStore.ts` | Thấp | Chấp nhận |
| P9 | Mỗi tab đăng ký `Events.On('uploader:files-dropped')` | `ObjectListView.tsx:360` | Thấp | Chấp nhận hoặc gom một listener cấp cao, làm sau |
| P10 | Lặp `WithTimeout 5 phút` + `AfterFunc` ở nhiều submodule; 5 phút khá dài cho một lần list | `submodule_object_mng.go:71`, `object_detail`, `search`, `prefix` | Thấp | Gom helper (R1); không đổi timeout trừ khi người dùng đồng ý |
| P11 | `ListObject` dùng `&input.Limit` không kiểm biên | `submodule_object_mng.go:93` | Thấp (chưa xác minh) | Kiểm biên, đặt mặc định; xác minh với MinIO |
| P12 | Tìm kiếm object quét tuần tự từng trang đến `searchMaxResults` | `submodule_search_mng.go:88` | Thấp, cần đo | Đảm bảo huỷ context dừng vòng lặp; không đổi ngữ nghĩa |
| P13 | Dependency không dùng: `redux` (không import trong `src`), `lodash`, `uuid` | `frontend/package.json` | Thấp | Gỡ/thay ở F0/F5 (đã được đồng ý) sau khi grep xác minh |
| P14 | Download history/connection profile lấy toàn bộ một lần, không phân trang | `submodule_download_history_mng.go`, `profile/module.go` | Thấp | Ghi lại để làm sau |

Mức cao: chưa phát hiện qua đọc code; cần số đo ở đợt 0 để xác nhận (đặc biệt P3). Ghi trước/sau vào `report.md` (bundle KB gzip, thời gian load N object, số render).

## 8. Rủi ro
| # | Rủi ro | Mức độ | Cách giảm thiểu |
|---|---|---|---|
| R-01 | Phạm vi 07a vẫn lớn (~75 file Go/model + ~70 file FE, 12 đợt) | medium (đã giảm nhờ tách 07b) | Đợt nhỏ tự pass; quá 3 vòng B4 thì dừng và hỏi |
| R-02 | Backend không có unit test; refactor Go (gom helper timeout/ctx, tách file uploader) có thể đổi hành vi huỷ/lock mà không phát hiện | high | Refactor nhỏ; build/vet/lint từng bước; smoke thủ công S3 + MinIO sau mỗi đợt B (upload/huỷ/download/xoá đệ quy/tìm kiếm); reviewer đọc kỹ diff có lock/context |
| R-03 | Luật 8: mọi file FE đổi (kể cả chỉ thêm comment) phải C1 >= 95%; `ObjectListView.tsx`, `TabDetail.tsx` có nhánh cũ chưa phủ | medium | Comment cùng lúc refactor; test ngay trong đợt; tách hook cho dễ test; ghi nhánh không test được |
| R-04 | Test FE flaky do tải máy (sprint 06: `ConnectModal`, `UploadLimitModal` timeout) | medium | Chạy lại khi timeout, không sửa để cho qua |
| R-05 | Thay `uuid` v7 bằng native có thể đổi tính chất id (sắp xếp theo thời gian) nếu nơi dùng phụ thuộc; gỡ `redux` có thể làm hỏng `zustand/middleware` devtools (chưa xác minh) | medium | Grep nơi dùng id; test; nếu phát hiện phụ thuộc thật thì dừng và báo; `tsc` + vitest + chạy app kiểm devtools không lỗi |
| R-06 | Gỡ key i18n "không dùng" nhầm key dựng động (`t(\`...${x}\`)`, mã message từ Go `ipcMessage:bucket.S3xxx`) | medium | Script xử lý key động và mã từ Go; chỉ xoá khi chắc; chạy toàn bộ test + kiểm thủ công đổi ngôn ngữ |
| R-07 | Đổi `OBJECT_PAGE_SIZE` lớn có thể chậm hơn ở endpoint chậm (trang đầu lâu hơn) | low | Đo trước/sau; nếu trang đầu chậm hơn đáng kể thì báo người dùng. Đã xảy ra với 50 trên MinIO, chốt 20 |
| R-08 | (07b) NSIS `VIProductVersion` ghép `.0`: `0.0.1-beta.1` làm installer lỗi; chạy `update:build-assets` sẽ ghi đè sửa tay | high | Sửa `project.nsi` dùng define số riêng; không chạy `update:build-assets`; kiểm bằng build thật ở V2 |
| R-09 | (07b) Ảnh chụp phải sau khi giao diện ổn định; refactor FE làm đổi UI nhỏ thì ảnh sai | medium | Tách 07b sau 07a; kiểm "không đổi UI" bằng so sánh thủ công |
| R-10 | (07b) Playwright (Chromium ~150MB) + font; không chụp được hộp thoại native; dev server v3 qua trình duyệt chưa xác minh | medium | Phương án PowerShell/thủ công; tra docs Wails v3 |
| R-11 | (07b) Font CJK/Việt thiếu glyph hoặc PDF nặng | medium | Nhúng `noto-sans` + `noto-sans-jp`; kiểm PDF đủ ký tự 3 ngôn ngữ |
| R-12 | (07b) Version macOS/Linux/iOS không build/kiểm được trên Windows | low | Ghi "chưa build/kiểm tra" |
| R-13 | (07b) Portable cần `WEBVIEW2_DIR` từ người dùng; `build/bin/S3Browser-portable/webview2` lớn có thể vào git | low | Xin đường dẫn lúc V2; kiểm `.gitignore` (chưa xác minh) |
| R-14 | `CLAUDE.md` có thể lệch sau refactor; `CLAUDE.md`/`.claude/**` bị chặn ghi | low | Báo người dùng cập nhật; agent không tự sửa |

## 9. Tiêu chí hoàn thành

### Sprint 07a (R1–R3)
- [ ] Mỗi đợt B0–B5 và F0–F6 tự pass `go build`, `go vet`, `golangci-lint`, `biome check`, `oxlint`, `tsc --noEmit`, vitest
- [ ] Mọi file FE đã đổi đạt C1 >= 95% và Lines >= 95% (báo cáo per-file)
- [ ] `report.md` có danh sách điểm đã refactor (file, lý do) và bảng hiệu năng có số đo trước/sau
- [ ] Không còn code chết, import thừa, key i18n không dùng (kèm lệnh/script kiểm chứng); `redux`, `lodash`, `uuid` đã gỡ/thay
- [ ] Mọi hàm/type exported Go có doc comment, mỗi package có comment; util/hook/store FE có JSDoc
- [ ] `OBJECT_PAGE_SIZE` = 20 (đã đo, trang đầu MinIO +~50ms, số lần gọi giảm một nửa)
- [ ] Smoke test thủ công S3 và MinIO pass (người dùng xác nhận)

### Sprint 07b (R4–R5)
- [ ] `docs/ARCHITECTURE*.md` (3 ngôn ngữ)
- [ ] README, CHANGELOG (3 ngôn ngữ), LICENSE MIT; PDF hướng dẫn 3 ngôn ngữ có mục lục và ảnh đúng ngôn ngữ, sinh lại bằng một lệnh
- [ ] Version `0.0.1-beta.1` nhất quán ở mọi nơi khai báo (mục 6.2); build cài đặt và portable chạy được

### Chung
- [ ] Không commit/tag/push (người dùng tự làm); báo người dùng các điểm cần cập nhật `CLAUDE.md`
