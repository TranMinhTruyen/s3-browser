# Plan sprint-04

## 0. Hiện trạng (đã đọc code)

Go (`internal/modules/**`, khoảng 2.400 dòng không tính test):
- Đã có test: `submodule_object_prefix` (deletePrefix), `submodule_s3_upload`, `submodule_uploader_mng`, `uploader_expand`, `submodule_object_detail`, `global/submodule_conn_container` (chỉ 3 hàm Test, chưa xác minh độ phủ). Tổng 72 hàm Test ở `bucket/`.
- Chưa có test: `bucket/module.go`, `submodule_bucket_mng.go`, `submodule_cfg_mng.go`, `submodule_connection_mng.go`, `submodule_download_history_mng.go`, `submodule_downloader_mng.go`, `submodule_s3_download.go`, `submodule_object_mng.go` (listObject, deleteObject), `events.go` (chỉ `init`, được phủ khi package load), `profile/module.go`, `master/modules.go`, `global/module.go`.
- Baseline Go theo file: **chưa đo được** (planner không có công cụ chạy lệnh). Baseline tổng của requirement: 31,8% (phạm vi rộng hơn). Wave G0 đo lại.
- Seam có sẵn: `s3Deleter`/`getDeleter`, `s3Header`/`getHeader`, `appContext` (`submoduleObjMng`); `uploadHost`, `getClient`, `dropContext` (`submoduleUploaderMng`); `s3Uploader`; biến `largeFileSize`, `maxWalkEntries`, `entryInfo`, `statFile`; `helpers_test.go` có `fakeS3`, `fakeHost`, `writeFile`.
- Không seam (code gọi trực tiếp `*application.App`): `submoduleBucketMng` (`m.app.Context()`), `submoduleConnMng`, `submoduleDownloadHistoryMng`, `submoduleDownloaderMng`, `profile.Module`, `master.Module` (đều `m.app.Context()`, một số gọi `m.app.Event.Emit`, `m.app.Dialog`).
- `*application.App` rỗng không dùng được: `Context()` trả `a.ctx` (nil nếu không qua `newApplication`, ctx tạo ở `application.go:581`), `Event` nil. Cần `application.New(application.Options{})` trong test: `Event.Emit` chạy được khi chưa có cửa sổ (đọc `event_manager.go`), nhưng việc gọi `application.New` trong tiến trình `go test` trên Windows (init nền tảng, singleton `globalApplication`) **chưa xác minh** -> task spike G1-1.
- `go.mod` ghi `github.com/wailsapp/wails/v3 v3.0.0`, trong khi `CLAUDE.md` ghi `v3.0.0-beta.34`: lệch, cần người dùng cập nhật `CLAUDE.md`.
- `KeyManager.key` unexported; dùng `keyring.MockInit()` của `go-keyring` (đã là dependency) rồi `utils.NewKeyManager()`. Nhánh lỗi Encrypt: set keyring giá trị base64 của khoá sai độ dài (NewKeyManager chỉ decode, `aes.NewCipher` mới lỗi). Chưa xác minh `MockInit` có trong phiên bản đang dùng.
- SQLite: `db.RunMigrations(ctx, sqlDB)` (`internal/pkg/db/migration.go`, exported, embed schemas) + `sql.Open("sqlite", ":memory:")` + `SetMaxOpenConns(1)` (modernc đã import trong `init_db.go`; test cần `_ "modernc.org/sqlite"`). Nhánh lỗi DB: đóng `db` trước khi gọi. Goose dùng global state (`SetBaseFS`, `SetDialect`): không chạy `t.Parallel` giữa các test migrate.
- Framework test AWS: dùng `*s3.Client` thật trỏ tới `httptest.Server` (`BaseEndpoint`, `UsePathStyle`, creds tĩnh), đặt vào `global.Module.PutConnContainer`. Dùng mã lỗi 4xx để SDK không retry (retry 3 lần với 5xx làm chậm).

Frontend (`frontend/src`, nay đã chốt phạm vi **toàn bộ `src`**):
- Hạ tầng sprint-03: `vite.config.ts` có khối `test` (jsdom, globals, setup, include, coverage v8 với `include`/`exclude`, reporter `text-summary,text,json-summary`), chưa có `thresholds`. `src/test/setup.ts` (ResizeObserver, matchMedia, scrollTo stub, cleanup), `renderWithProviders` (Mantine + I18next + NiceModal.Provider). Script `test`, `test:coverage` trong `package.json`.
- `frontend/coverage/coverage-summary.json` (có thể cũ): 780 nhánh, 137 phủ (17,56%). Để đạt > 95% chỉ được để dưới 39 nhánh chưa phủ. Nhánh lớn nhất chưa phủ: `TabDetail` 70, `ConnectionProfiles` 66, `UploadLimitModal` 57, `ConnectModal` 54, `BucketListView` 42, `ipcUtils` 39, `HistoryModal` 39, `stringUtils` 25 (3 phủ), `RegionCombobox` 24, `tabListStore` 36 (7 phủ), `Combobox` 16, `UploaderWindow` 16, `DownloaderWindow` 12, `FieldInput` 11, `modalUtils` 13, `modalStackStore` 10, `downloaderStore` 18, `uploaderStore` 8, `masterDataStore` 8, `profileStore` 6, `convertUtils` 7, `ConfirmModal` 10, `ObjectListView` 101 (65 phủ), `ObjectDetailDrawer` 46 (42 phủ), `ObjectItem` 8 (5 phủ).
- Mock có sẵn trong test sprint-03: `vi.mock('@tanstack/react-virtual')` trả mọi hàng, `vi.mock('@wailsio/runtime')` (giữ actual, thay `Events.On`), `vi.mock('@wails/.../buckethandler')`, `vi.mock('@/common/utils/ipcUtils')` giả `callIPC`, `vi.mock` các modal, `useTabListStore.setState`.
- `callIPC` (`ipcUtils.ts`): nhánh signal/CancellablePromise, stale scope, `showMessages` (E/W/I/default), catch `CancelError`/lỗi khác. Test cần `vi.mock('sonner')` và `CancellablePromise`/`CancelError` thật từ `@wailsio/runtime`.
- `createMantineModal` (`modalUtils.ts`): test qua `NiceModal.Provider` + `useModalStackStore`.

## 1. Tóm tắt yêu cầu
- R1: Unit test Go cho `internal/modules/**` (module, submodule, `uploader_expand.go`), coverage statement > 95%, rà tay nhánh `if`/`switch`, có lệnh kiểm tra ngưỡng; `go build`, `go vet`, golangci-lint, `go test ./...` pass.
- R2: Unit test frontend toàn bộ `src` (đã chốt), branch > 95%, `coverage.thresholds` 95% trong `vite.config.ts`; biome, oxlint, tsc, vitest pass.
- Ràng buộc: không sửa code production; chỉ thêm `_test.go`, `*.test.ts(x)`, helper test, cấu hình test/coverage; file thử quá 3 lần không đạt thì exclude kèm lý do trong `report.md`.
- Ngoài phạm vi: code sinh tự động, `main.go`, `internal/app.go`, `internal/handlers/**`, `internal/pkg/**`, `models/**`, e2e.

## 2. Câu hỏi chưa rõ
| # | Câu hỏi | Đề xuất | Trả lời |
|---|---|---|---|
| Q1 | Phạm vi frontend: toàn bộ `src` hay chỉ logic | Toàn bộ `src` | **Đã trả lời: toàn bộ `frontend/src` (store, utils, hooks, components, pages); requirement.md đã sửa** |
| Q2 | Loại trừ sẵn các file chỉ khai báo? | Có: Go `events.go` không cần exclude (init chạy khi load package). Frontend: `main.tsx` (đã exclude), `*.d.ts` (đã exclude), `locales/*/resource.ts`, `commonConst.ts` có 0 nhánh nên không ảnh hưởng branch, không cần exclude | (chờ người dùng) |
| Q3 | Chia sprint theo wave (G0..G3, F1..F4)? Mỗi wave một chu kỳ B4 tối đa 3 vòng, có xin xác nhận giữa các wave | Có, 7 wave, hoặc tách thành 2 sprint (05 cho frontend) | (chờ người dùng) |
| Q4 | Cho phép loại trừ ở mức hàm (không chỉ mức file) cho Go? `go tool cover` chỉ lọc dễ theo file | Chỉ exclude mức file; hàm không test được (`downloadObject` phần dialog, nhánh GOOS khác) tính vào ngân sách 5% | (chờ người dùng) |
| Q5 | Đo ngưỡng Go là gộp toàn phạm vi (>95% tổng) hay từng file/package? | Gộp theo phạm vi `./internal/modules/...` (khớp requirement), in thêm % từng file để theo dõi | (chờ người dùng) |
| Q6 | Chỗ đặt script kiểm tra ngưỡng Go | `scripts/checkcoverage` (Go) (repo đã có `scripts/build-dev.ps1`) + task `test:go:coverage` trong `Taskfile.yml` gọi nó; hoặc script Go thuần (`scripts/covercheck/main.go`) chạy được trên cả macOS/Linux | (chờ người dùng) |
| Q7 | `application.New` trong test: chấp nhận nếu spike thành công; nếu không chạy được trên Windows/CI thì sao? | Nếu thất bại thì exclude file cần `*application.App` thật (`submodule_bucket_mng`, `submodule_connection_mng`, `submodule_download_history_mng`, `profile`, `master`) là không chấp nhận được (chiếm phần lớn); khi đó đề xuất người dùng cho phép một seam nhỏ (ví dụ `appContext func()`) dù trái ràng buộc | (chờ người dùng) |
| Q8 | `downloadObject` đi qua `m.app.Dialog...PromptForSingleSelection()` (không mock được nếu không sửa production) | Chỉ test nhánh S3E006; phần còn lại tính vào ngân sách chưa phủ. Test `downloadOne`, `finishHistory`, `reserveDest`, `download` trực tiếp | (chờ người dùng) |
| Q9 | `openDownloadDest` gọi `exec.Command("explorer"...)` thật | Đặt `PATH` trỏ thư mục tạm: rỗng để phủ nhánh lỗi S3E016; chép chính test binary thành `explorer.exe`/`open`/`xdg-open` vào thư mục đó để phủ nhánh thành công mà không mở Explorer thật | (chờ người dùng) |
| Q10 | Ngưỡng frontend: bật 95% ngay từ wave đầu (CI đỏ) hay nâng dần (ratchet) | Nâng dần theo từng wave, wave cuối đặt đúng 95 cho branches/statements/lines/functions | (chờ người dùng) |
| Q11 | `CLAUDE.md` lệch với `go.mod` (Wails `v3.0.0` thay vì `beta.34`) và có luật 8 mà requirement nhắc | Người dùng tự cập nhật `CLAUDE.md` | (chờ người dùng) |

## 3. Task backend (go-backend)
Các wave Go (mỗi wave là một chu kỳ B4). Thứ tự: G0 -> G1 -> G2 -> G3.

| # | Task | Yêu cầu | File sửa / tạo | Phụ thuộc |
|---|---|---|---|---|
| G0-1 | Đo baseline: `go test -coverpkg=./internal/modules/... -coverprofile=<scratch> ./internal/modules/...`, ghi % theo file vào report | R1 | (không file) | - |
| G0-2 | Script ngưỡng: chạy test, `go tool cover -func`, lọc file exclude, fail nếu < 95 | R1 | `scripts/checkcoverage` (Go) (tạo), `Taskfile.yml` (sửa, thêm task `test:go:coverage`) | Q4-Q6 |
| G1-1 | Spike `application.New(application.Options{})` trong `TestMain`, helper `newTestApp(t)`, chốt khả thi | R1 | `internal/modules/testutil_test.go` hoặc mỗi package một `helpers_test.go` (tạo) | G0 |
| G1-2 | Helper DB: SQLite in-memory + goose migration + `sqlc` | R1 | cùng helper trên (tạo) | G1-1 |
| G1-3 | `global`: bổ sung test `AcquireConn/release/RemoveConnIfIdle/RemoveAllConn/ReplaceConn/HasConn`, `NewModule` | R1 | `internal/modules/global/submodule_conn_container_test.go` (sửa), `module_test.go` (tạo) | - |
| G1-4 | `master`: `GetMasterData` (code rỗng, lỗi DB, dữ liệu), `GetRegion` (lỗi, nhóm theo Value2) với seed dữ liệu | R1 | `internal/modules/master/modules_test.go` (tạo) | G1-1, G1-2 |
| G1-5 | `profile`: Create/Update/Delete/Get/GetAll, nhánh lỗi mã hoá (khoá sai độ dài), lỗi DB (đóng db), `PFE007` (AcquireConn rồi xoá), Decrypt lỗi (ghi ciphertext rác) | R1 | `internal/modules/profile/module_test.go` (tạo) | G1-1, G1-2 |
| G2-1 | `submodule_cfg_mng`: `buildClient` (aws, minio, endpoint không scheme, endpoint không host), `probe` qua httptest (OK, 403 InvalidAccessKeyId, AccessDenied -> Limited, InvalidRegion, lỗi mạng), `describeConnectStatus` (DeadlineExceeded, `""`, default), `UnwrapAwsError` đủ 6 nhánh, `newHTTPClient` | R1 | `internal/modules/bucket/submodule_cfg_mng_test.go` (tạo), `helpers_test.go` (sửa, thêm httptest S3 giả) | G1-1 |
| G2-2 | `submodule_connection_mng`: test/connect (profile mới, profile có sẵn, `CreateProfile` lỗi), `profileConnectAction` (profile không có, probe lỗi, OK), `disconnectAction`, `replaceConn` (có/không conn cũ) | R1 | `internal/modules/bucket/submodule_connection_mng_test.go` (tạo) | G2-1, G1-5 |
| G2-3 | `submodule_bucket_mng.listBucket`: không kết nối, có/không NextCursor, lỗi, huỷ ctx, map kết quả (XML ListBuckets) | R1 | `internal/modules/bucket/submodule_bucket_mng_test.go` (tạo) | G2-1 |
| G2-4 | `submodule_object_mng`: `listObject` (không kết nối, cursor, CommonPrefixes, bỏ key rỗng/bằng prefix, lỗi, huỷ), `deleteObject` (HeadObject lỗi, DeleteObject lỗi, thành công), constructor `newSubmoduleObjMng` (hai closure `getDeleter`/`getHeader` cả hai nhánh) | R1 | `internal/modules/bucket/submodule_object_mng_test.go` (tạo) | G2-1 |
| G3-1 | `submodule_download_history_mng`: create/update/get (phân trang `hasMore`), lỗi DB, `openDownloadDest` (không tồn tại, lỗi stat khác, `PATH` rỗng, binary giả) | R1 | `internal/modules/bucket/submodule_download_history_mng_test.go` (tạo) | G1-2 |
| G3-2 | `submodule_s3_download`: `download` qua httptest (OK, `Range`/`Content-Range`, 412 PreconditionFailed, lỗi tạo file, rename lỗi, progress với handler chậm >200ms), `countingWriterAt`, `onTransferStart` | R1 | `internal/modules/bucket/submodule_s3_download_test.go` (tạo) | G2-1 |
| G3-3 | `submodule_downloader_mng`: `downloadOne`, `finishHistory`, `reserveDest`, `destTaken`, `suffixedPath` (dot file), `destKey`, cancel one/all, nhánh S3E006 của `downloadObject` | R1 | `internal/modules/bucket/submodule_downloader_mng_test.go` (tạo) | G3-1, G3-2 |
| G3-4 | `bucket/module.go`: `NewModule`, mọi method wrapper, `DisconnectAll` (có `Transport`), `HandleFilesDropped` (event ctx nil) | R1 | `internal/modules/bucket/module_test.go` (tạo) | G2, G3-3 |
| G3-5 | Rà nhánh còn thiếu trong file đã có test (uploader_mng, s3_upload, uploader_expand, object_prefix) theo `cover -html`; thêm case | R1 | các `*_test.go` hiện có (sửa) | G3-4 |

Message code mới: không  |  Migration / sqlc: không (chỉ dùng)  |  Cần sinh lại bindings: không

## 4. Task frontend (react-frontend)
Không có task backend nào đổi bindings nên có thể chạy độc lập sau Go, hoặc song song theo thứ tự tuần tự (không chạy hai agent viết code cùng lúc). Mỗi wave một chu kỳ B4.

| # | Task | Yêu cầu | File sửa / tạo | Phụ thuộc |
|---|---|---|---|---|
| F1-1 | Cấu hình: thêm `coverage.thresholds` (đặt tạm bằng baseline đo được, nâng dần), kiểm tra `exclude` | R2 | `frontend/vite.config.ts` (sửa) | - |
| F1-2 | Test store: `createStore`, `commonStore`, `modalStackStore`, `masterDataStore`, `profileStore`, `downloaderStore`, `uploaderStore`, `tabListStore` (mọi action, nhánh immer) | R2 | `frontend/src/common/stores/*.test.ts` (tạo) | F1-1 |
| F1-3 | Test utils/hooks: `stringUtils`, `convertUtils`, `ipcUtils` (mock `sonner`, `CancellablePromise`, stale scope), `modalUtils` (qua NiceModal), `useFieldError` | R2 | `frontend/src/common/utils/*.test.ts(x)`, `common/hooks/useFieldError.test.ts` (tạo) | F1-1 |
| F2-1 | Test wrapper nhỏ: `buttons/Button`, `ActionIcon`, `inputs/*` (`CheckBoxInput`, `FieldInput`, `SegmentedControl`, `SwitchInput`, `combobox/Combobox`, `RegionCombobox`) | R2 | `frontend/src/components/{buttons,inputs}/**/*.test.tsx` (tạo) | F1 |
| F2-2 | Test `modals/ConfirmModal`, `modalColors`, `router/RouterItem`, `layouts/MainLayout`, `navbar/LeftNavbar`, `HeaderButtonGroup`, `tab/TabLabel`, `uploader/UploaderItem`, `downloader/DownloaderItem` | R2 | `frontend/src/components/**/*.test.tsx` (tạo) | F2-1 |
| F3-1 | Test `ConnectModal` (zod form, test connection, lưu), `UploadLimitModal`, `HistoryModal` (phân trang, mở thư mục) | R2 | `frontend/src/components/modals/*.test.tsx` (tạo) | F2 |
| F3-2 | Test `ConnectionProfiles`, `DownloaderWindow`, `UploaderWindow` (mock `Events`, `callIPC`, store) | R2 | `frontend/src/components/layouts/**/*.test.tsx` (tạo) | F3-1 |
| F4-1 | Test `pages/bucket/BucketListView`, `BucketItem` | R2 | `frontend/src/pages/bucket/*.test.tsx` (tạo) | F3 |
| F4-2 | Test `TabDetail`, `TabLayout`; bổ sung nhánh thiếu cho `ObjectListView`, `ObjectItem`, `ObjectDetailDrawer`; `App.tsx` | R2 | `frontend/src/components/layouts/tab/**/*.test.tsx`, `frontend/src/pages/object/*.test.tsx`, `frontend/src/App.test.tsx` (tạo/sửa) | F4-1 |
| F4-3 | Chốt `thresholds` 95 (branches, statements, lines, functions), chạy biome, oxlint, tsc, vitest | R2 | `frontend/vite.config.ts` (sửa) | F4-2 |

i18n key mới (en/vi/ja): không.

Cách mock (không sửa production):
- Bindings Wails: `vi.mock('@wails/S3Browser/internal/handlers/<x>handler', () => ({ Fn: vi.fn() }))` theo mẫu `ObjectListView.test.tsx`; model dùng class thật từ `@wails/S3Browser/models`.
- `@wailsio/runtime`: giữ `importOriginal`, thay `Events.On/Emit`, `Dialogs`/`Window` nếu component dùng (cần liệt kê khi viết test; chưa xác minh từng component).
- NiceModal: component modal render trong `renderWithProviders` và `NiceModal.show`; hoặc `vi.mock` module modal như mẫu `ConfirmModal`.
- Virtualizer: mock `@tanstack/react-virtual` như mẫu; đặt vào helper chung `src/test/mockVirtual.ts` để dùng lại.
- Store: `useXStore.setState` trong `beforeEach`, dùng `reset()`.
- Toast: `vi.mock('sonner')`.

## 5. Thứ tự thực hiện (luôn tuần tự)
1. Backend: G0 -> G1 -> G2 -> G3 (mỗi wave: viết test, `go vet`, `go build ./...`, `go test`, golangci-lint, review, tối đa 3 vòng).
2. Không cần `go tool wails3 generate bindings` hay `go tool sqlc generate` (không đổi API, không đổi SQL).
3. Frontend: F1 -> F2 -> F3 -> F4 (mỗi wave: biome, oxlint, tsc, `bun run test:coverage`, review, tối đa 3 vòng).

Ngưỡng:
- Go: `scripts/checkcoverage` (Go) đọc `coverage.out`, trừ các file exclude, so với 95 (tham số `-Min 95`), thoát mã khác 0 nếu thấp hơn; in % theo file. Gọi qua `go tool task test:go:coverage` (hoặc `task`, xem repo dùng `go tool wails3 task`).
- Frontend: `test.coverage.thresholds: { branches: 95, statements: 95, lines: 95, functions: 95 }` trong `vite.config.ts`.

## 6. Rủi ro
| # | Rủi ro | Mức độ | Cách giảm thiểu |
|---|---|---|---|
| 1 | `application.New` không chạy được trong `go test` (Windows, singleton, init nền tảng), chặn 5 file Go cần `*application.App` | critical | Spike đầu G1 trước mọi việc khác; nếu thất bại báo người dùng (Q7) thay vì tự đoán |
| 2 | Sprint lớn: 7 wave, hơn 20 task; chi phí vòng review cao | high | Chia wave như trên; đề xuất tách sprint-05 cho frontend (Q3) |
| 3 | Frontend 780 nhánh, 17,6% hiện tại, đạt > 95% là rất lớn (cần phủ khoảng 600 nhánh mới), rủi ro không đạt trong 3 vòng/wave | high | Ratchet ngưỡng (Q10); wave F3 chia nhỏ; file thử quá 3 lần thì exclude kèm lý do |
| 4 | `downloadObject` (dialog), nhánh GOOS khác, nhánh lỗi `f.Close()` không phủ được | medium | Ngân sách 5% (Q4, Q8); đo bằng baseline G0 trước khi cam kết |
| 5 | `openDownloadDest` có thể mở Explorer thật khi test | medium | Luôn đặt `PATH` tạm trước khi gọi (Q9); không gọi nhánh thành công nếu không đặt |
| 6 | Test `download` qua httptest phụ thuộc giao thức Range/ETag của `transfermanager` (chưa xác minh), dễ flaky; progress cần >200ms | medium | Dùng handler tự viết trả `Content-Range`, `ETag`; nhánh progress đặt timeout và có thể bỏ nếu quá 3 lần |
| 7 | goose dùng global state, SQLite in-memory + `MaxOpenConns(1)`; test song song gây lỗi | medium | Không `t.Parallel` trong test DB; mỗi test một DB `:memory:` riêng (`file:name?mode=memory&cache=shared` nếu cần) |
| 8 | `keyring.MockInit` hoặc keyring Windows thật bị chạm khi gọi `NewKeyManager` | medium | Luôn gọi `keyring.MockInit()` trước (chưa xác minh có trong phiên bản hiện dùng) |
| 9 | Test Go có race/flaky ở phần goroutine (downloader, uploader) | medium | Chạy `go test -race` ở máy cục bộ, dùng channel/`sync` thay `time.Sleep` |
| 10 | golangci-lint (lll 120, golines) đỏ do file test dài; `errcheck` đã bỏ qua `_test.go` | low | Chạy lint mỗi wave |
| 11 | `frontend/coverage-summary.json` trong repo có thể cũ so với mã hiện tại (số nhánh thay đổi) | low | Wave F1 đo lại baseline bằng `bun run test:coverage` |
| 12 | `CLAUDE.md` lệch `go.mod` (Wails version) | low | Báo người dùng cập nhật (Q11) |

## 7. Tiêu chí hoàn thành
- [ ] Spike G1-1 thành công hoặc có quyết định của người dùng cho Q7.
- [ ] Coverage Go phạm vi `./internal/modules/...` > 95% (statement), rà tay mọi `if`/`switch`; `scripts/checkcoverage` (Go) fail khi thấp hơn.
- [ ] `go build ./...`, `go vet ./...`, `go tool golangci-lint run ./...`, `go test ./...` pass; `go test -race` pass trên các test mới.
- [ ] Branch coverage frontend toàn bộ `src` > 95%; `coverage.thresholds` 95% trong `vite.config.ts`.
- [ ] biome, oxlint, `tsc --noEmit`, vitest pass.
- [ ] Danh sách file exclude (nếu có) kèm lý do trong `report.md`; không file production nào bị sửa (`git diff` chỉ gồm `_test.go`, `*.test.ts(x)`, helper test, cấu hình test/coverage, script, `Taskfile.yml`).

## Quyết định đã chốt (người dùng, 2026-10-27)
- Q1: phạm vi frontend là toàn bộ `frontend/src`.
- Q2, Q4: theo đề xuất (không exclude trước file khai báo; Go chỉ exclude mức file).
- Q3: gộp cả 7 wave (G0–G3, F1–F4) trong sprint-04.
- Q5, Q6: ngưỡng Go đo gộp toàn `./internal/modules/...`, in thêm % theo file; script `scripts/checkcoverage` (Go) + task trong `Taskfile.yml`.
- Q7: nếu spike `application.New` trong `go test` thất bại thì loại 5 file (`submodule_bucket_mng.go`, `submodule_connection_mng.go`, `submodule_download_history_mng.go`, `profile/module.go`, `master/modules.go`) khỏi phép đo, ghi lý do vào report. Không sửa production.
- Q8, Q9: phần không phủ được (`downloadObject` sau dialog, nhánh `runtime.GOOS` khác, lỗi `f.Close()`) tính vào 5% được phép thiếu; test `openDownloadDest` bằng `PATH` tạm.
- Q10: ngưỡng frontend nâng dần theo wave, chốt 95 ở F4.
- Q11: người dùng đã cập nhật version Wails trong `CLAUDE.md`.
- Q6 (cập nhật): người dùng yêu cầu viết lại script ngưỡng bằng Go: `scripts/checkcoverage`, chạy qua `go run ./scripts/checkcoverage` / task `test:go:coverage`.
