# Báo cáo Sprint 07a: Rà soát, refactor và tối ưu hiệu năng (R1–R3)

**Trạng thái: chờ người dùng smoke test thủ công (S3 + MinIO).** Phần 07b (R4–R5: tài liệu, version) làm ở lượt sau.

## Kết quả

- Đã làm đủ các đợt Đợt 0, B0–B5, F0–F6. Mỗi đợt F đều chạy hết quy trình code → test → verify → review, và không đợt nào phải quá 1 vòng sửa.
- Review của mọi đợt đều **ĐẠT**, không có blocker hay major.
- Verify tổng thể (F6) **PASS** toàn bộ.
- Quyết định của người dùng (ngoài plan mục 1.1):
  - `OBJECT_PAGE_SIZE` chốt **20** sau khi đo. Ban đầu dự kiến 50, nhưng 50 làm trang đầu trên MinIO chậm khoảng 3 lần.
  - Khi tải chunk modal lỗi: hiện `toast.error` (key i18n `common:modalLoadError`) và ghi `console.error`.

## Kiểm tra cuối (F6)

| Kiểm tra | Kết quả |
|---|---|
| `go build` / `go vet` / `golangci-lint` | PASS, 0 issues |
| Bindings | Đã sinh lại sau cùng và giống hệt bản trước (diff rỗng); `tsc --noEmit` PASS |
| Message code Go ↔ `ipcMessage.json` | PASS: 50 mã Go có đủ ở en/vi/ja. Chỉ frontend dùng: `common.CME001`, `master.MTE001` |
| `models/alias.go` | PASS, đủ 43 alias |
| biome / oxlint | PASS (179 file) |
| i18n | PASS: 17 file mỗi ngôn ngữ, cùng tập key, đăng ký đủ trong `resource.ts` |
| vitest + coverage v8 | PASS: 56 file test, **683 test** (baseline 580; 680 ở F6, thêm 3 test cho `createUUID` khi quay lại dùng thư viện `uuid`) |
| Coverage per-file | Không còn file production nào dưới 95% ở Branches, Lines hay Functions. Tổng: Branches 98,91%, Lines 100%, Functions 100% (baseline: 98,64%, 99,47%, 98,48%) |
| `bun run build` | PASS, không còn cảnh báo chunk > 500 kB |
| Smoke test thủ công S3 + MinIO | **Chưa làm, chờ người dùng** |

## Bảng hiệu năng (trước/sau)

Số đo chi tiết từng đợt nằm ở `baseline.md`. Bundle tính gzip bằng `zlib.gzipSync` từng file, chỉ gồm js + css.

| # | Vấn đề | Mức | Xử lý | Trước | Sau |
|---|---|---|---|---|---|
| P1 | `lodash` nạp cả gói chỉ để dùng 2 hàm | Trung | Thay bằng code native, gỡ `lodash`/`@types/lodash` | Tổng gzip 375,579 | 349,745 (−6,9%) ở F0 |
| P2 | Modal nặng nằm trong bundle chính | Trung | `ConnectModal` và `HistoryModal` tải lazy qua `lazyModals.ts`. `TabDetail` cũng đổi sang `showConnectModal` | JS tải ban đầu gzip 320,874; cộng CSS 357,060 | JS **233,863 (−27,1%)**; cộng CSS **270,212 (−24,3%)**. `ConnectModal` là chunk riêng 33,971 |
| P3 | `OBJECT_PAGE_SIZE = 10`: nhiều round trip | Trung | Đổi thành 20 (đã đo, người dùng chốt) | 1.020 mục: 102 lần gọi; MinIO list hết 5,96 s; Floci 129 ms | 51 lần gọi; MinIO 5,16 s (−13%); Floci 73 ms (−43%). Trang đầu MinIO 81 → 130 ms |
| P4 | `ObjectListView` 473 dòng, nhiều state | Trung | Tách `useObjectPaging` và `useFilesDroppedUpload`. `TabDetail` tách `TabBreadcrumb` và `TabActionBar`; selection chuyển xuống `TabActionBar` nên chọn hay bỏ chọn không còn re-render cả tab | n/a | Test xác nhận: đổi tab không re-render `TabDetail` của tab khác. Chưa đo số render trong app thật |
| P5 | i18n nạp 3 ngôn ngữ cùng lúc | Thấp | Chưa làm (deferred) | n/a | n/a |
| P6 | `loadNextPage` tạo `Set` O(n) mỗi trang | Thấp | Chưa làm (deferred), ưu tiên giữ hành vi | n/a | n/a |
| P7–P9 | Selector uploader, immer theo progress, listener files-dropped theo tab | Thấp | Chấp nhận, theo plan | n/a | n/a |
| P10 | Lặp `WithTimeout` + `AfterFunc` | Thấp | Gom thành helper `withCallContext`, `isCallCanceled`, `notConnectedMessage` (`call_helper.go`), dùng ở 7 submodule. Timeout giữ nguyên | n/a | n/a |
| P11 | `MaxKeys` không kiểm biên | Thấp | Chỉ thêm comment (AWS tự giới hạn 1000). Deferred | n/a | n/a |
| P12 | Tìm kiếm quét tuần tự | Thấp | Dùng helper chung, huỷ context vẫn dừng vòng lặp, ngữ nghĩa không đổi | n/a | n/a |
| P13 | Dependency không dùng | Thấp | Gỡ `lodash`, `redux`, `@types/lodash`. `uuid` đã gỡ ở F5 nhưng người dùng quyết định giữ lại (gói ESM tree-shake được, nên ảnh hưởng bundle không đáng kể) | 4 gói | Gỡ 3, giữ `uuid` |
| P14 | History/profile không phân trang | Thấp | Ghi lại để làm sau | n/a | n/a |

Tổng js + css (gzip): 375,579 → **357,743 (−4,8%)**. Phần tải lúc mở app giảm mạnh hơn (−24,3%) vì phần còn lại đã tách ra các chunk lazy.

## Danh sách refactor

### Backend (Go)
- **B0** (entry, hạ tầng, model):
  - Thêm comment package và doc comment cho `main.go`, `internal/app.go`, `config.go`, cnst, db, logger, utils, portable, models.
  - Xoá code chết: `DateTimeFormatPattern`, `DateFormatPattern`, `WailsAdapter`, `DownloadObjOutput` (`models/bucket/download_obj_output.go`). Đổi `LogDir` thành `logDir`.
- **B1** (global, master, profile, handlers):
  - global: xoá `PutConnContainer`.
  - master: thêm `toMasterOutput`, bỏ tham số thừa `global` của `NewModule`.
  - profile: gom mapping lặp thành `toProfileOutput`, thêm `encryptSecret`, chuyển sang `ThrowError`.
  - Thêm doc cho handler.
- **B2** (bucket: connection, bucket, search): file mới `call_helper.go` (gom timeout/huỷ/kiểm connection), thêm `probe` và `connectTimeout`.
- **B3** (object): dùng helper chung. Thêm comment "tại sao" cho xoá theo batch/đồng thời/timeout và cho `MaxKeys`.
- **B4** (upload/download):
  - Tách `submodule_uploader_mng.go` (555 → khoảng 350 dòng) ra 2 file mới `uploader_items.go` và `uploader_drop.go`.
  - Thêm doc cho downloader, history, s3_upload, s3_download.
- **B5**:
  - Sửa doc theo revive.
  - Xoá hằng `S3E010` và `S3W003`.
  - Đánh dấu `S3W006` và `S3W007` là "Used by the frontend only".
  - Sinh lại bindings (chỉ đổi JSDoc).

### Frontend
- **F0** (common):
  - `stringUtils` không còn dùng lodash.
  - `createUUID` vẫn dùng `v7()` của thư viện `uuid` như trước sprint. Trong sprint từng thay bằng bản tự viết, nhưng người dùng chọn giữ thư viện.
  - Thêm JSDoc cho utils và stores.
  - Xoá code chết:
    - `commonStore.ts`, `convertUtils.ts`;
    - `selectActiveTab`;
    - action không dùng của profileStore và masterDataStore;
    - 4 hằng ngày giờ.
- **F1** (component dùng chung):
  - Thêm `useAutoLoading`, `useSelectCombobox`, `ComboboxClearButton` để gom code lặp của Button/ActionIcon/Combobox/RegionCombobox.
  - Thêm hằng màu `INFO_BG_COLOR` và `INFO_COLOR`.
  - Xoá `SwitchInput.tsx` (không dùng).
- **F2** (layout, kết nối):
  - `ConnectModal` 354 → khoảng 290 dòng; schema và giá trị mặc định chuyển sang `connectSchema.ts`.
  - Thêm `lazyModals.ts`.
  - Gom `setConnecting` trong `ConnectionProfiles`.
  - `TabLabel` dùng `memo`.
- **F3** (bucket, object, tab):
  - Thêm `useObjectPaging`, `useFilesDroppedUpload`, `TabBreadcrumb`, `TabActionBar`.
  - `OBJECT_PAGE_SIZE` = 20.
  - Bỏ `memo` thừa trong `TabLayout`.
  - Thêm xử lý lỗi cho `lazyModals`.
  - Thêm JSDoc cho BucketListView, BucketItem, ObjectItem, ObjectDetailDrawer.
- **F4** (upload/download):
  - `UploadFileList.tsx` (`FileRow`, `VirtualRowList`) gộp phần trùng của `UploadLimitModal` và `UploadPickerModal`; các chỗ khác nhau truyền qua props, UI giữ nguyên.
  - Dùng `INFO_BG_COLOR` ở `HistoryModal` và `UploadPickerModal`.
  - Thêm JSDoc cho uploader/downloader.
- **F5** (i18n, dependency):
  - Xoá key `S3E010`, `S3W003` và `connectModal.label.saveProfileLabel` ở cả 3 ngôn ngữ.
  - Gỡ `lodash`, `redux`, `@types/lodash`. `uuid` được giữ lại theo quyết định của người dùng.

## Thống kê thay đổi (so với HEAD, không tính `sprints/`)

| Nhóm | File sửa/xoá | File mới | Dòng thêm | Dòng xoá |
|---|---|---|---|---|
| Go | 62 (1 xoá) | 3 | +773 | −581 |
| Frontend production | 42 (3 xoá) | 10 | +1,138 | −1,006 |
| Frontend test | 17 (2 xoá) | 10 | +1,347 | −109 |
| Locale | 9 | 0 | +6 | −18 |
| `package.json` | 1 | 0 | 0 | −3 |
| **Tổng** | **131** | **23** | **+3,264** | **−1,717** |

Riêng code production (Go + FE): +1,911 / −1,587. Phần thêm chủ yếu là doc comment, JSDoc và code chuyển sang file tách mới.

### File mới
- Go: `internal/modules/bucket/call_helper.go`, `uploader_items.go`, `uploader_drop.go`.
- Frontend production (`frontend/src/`):
  - `components/buttons/useAutoLoading.ts`
  - `components/inputs/combobox/useSelectCombobox.ts`, `ComboboxClearButton.tsx`
  - `components/layouts/tab/components/TabActionBar.tsx`, `TabBreadcrumb.tsx`
  - `components/modals/UploadFileList.tsx`, `connectSchema.ts`, `lazyModals.ts`
  - `pages/object/useObjectPaging.ts`, `useFilesDroppedUpload.ts`
- Frontend test: mỗi file mới ở trên có 1 file test tương ứng trong `frontend/src/test/` (10 file).
- Sprint: `sprints/sprint-07/plan.md`, `baseline.md`, `report.md`.

### File xoá
- `frontend/src/common/stores/commonStore.ts`, `frontend/src/common/utils/convertUtils.ts`, `frontend/src/components/inputs/SwitchInput.tsx`
- `frontend/src/test/common/stores/commonStore.test.ts`, `frontend/src/test/common/utils/convertUtils.test.ts`
- `models/bucket/download_obj_output.go`

## Lưu ý về git (người dùng tự xử lý, agent không chạy lệnh git thay đổi index)

- **Index đang lẫn trạng thái.** Có 4 file xoá **đã bị stage** vì agent chạy `git rm --cached` ở đợt đầu:
  - `commonStore.ts`, `convertUtils.ts`, `SwitchInput.tsx`, `commonStore.test.ts`.
  - Hai file xoá khác chưa stage: `convertUtils.test.ts`, `download_obj_output.go`.
  - Từ sau đó mọi agent đều bị cấm chạy lệnh git.
  - Muốn bỏ stage thì chạy `git restore --staged <file>`.
- **Cần `git add` 23 file mới** (danh sách ở trên) trước khi commit.
- `frontend/bun.lock` nằm trong `.gitignore`, nên git không ghi lại thay đổi lockfile. Khối `workspaces` khớp với `package.json` mới, nhưng không so được với bản cũ để chắc là không có gói nào khác bị bump.
- `frontend/coverage/` do reporter `json-summary` trong `vite.config.ts` sinh ra mỗi lần chạy coverage. Thư mục này chưa có trong `.gitignore`; tôi đã xoá bản sinh ra trong sprint. Nên thêm vào `.gitignore`.

## Chưa làm / deferred

| Mục | Lý do |
|---|---|
| Smoke test thủ công S3 + MinIO | Cần người dùng chạy app |
| P5 lazy i18n, P6 dedupe `Set`, P11 kiểm biên `Limit` | Mức thấp, ưu tiên giữ hành vi |
| `probe` dùng `MaxBuckets=1` | Chờ người dùng quyết |
| Download mở tối đa 36 connection đồng thời; `os.Stat` tuần tự trong `groupUploadItems`; `Lstat` nằm trong `destsMu` | Mức thấp, cần đo trước khi đổi |
| `useAutoLoading`: `onClick` reject thì sinh unhandled rejection | Có từ trước sprint. Sửa bằng `.catch(noop)` nếu người dùng muốn |
| revive: 29 lỗi var-naming và stutter `master.MasterOutput` | Sửa sẽ đổi bindings/json |
| `DownloaderWindow` chưa virtualize | Kích thước cửa sổ dùng để xếp `UploaderWindow`; đổi có thể lệch layout |
| `memo(FileRow)` không có tác dụng vì `style` là object mới mỗi lần render | Có từ trước, chỉ khoảng 20 dòng được virtualize |
| `.catch` của `lazyModals` bắt cả lỗi trong `show()`, không chỉ lỗi tải chunk | Thông báo vẫn đúng nghĩa, console ghi lỗi gốc |
| Key `V000003` (`validateMessage.json`) chưa nơi nào dùng | Giữ để dùng khi thêm validate định dạng; người dùng quyết có xoá không |
| Bucket `s3browser-bench` (MinIO + Floci) | Dữ liệu đo; xoá khi người dùng đồng ý |

## Cần cập nhật `CLAUDE.md` (agent không tự sửa)

1. **Mục 5, Context:** submodule trong `internal/modules/bucket` dùng `withCallContext(ctx, m.app.Context(), timeout)`, `isCallCanceled(ctx)` và `notConnectedMessage(profile)` trong `call_helper.go`, thay cho việc tự viết `WithTimeout` + `AfterFunc`.
2. **Mục 6, Component:** modal nặng (`ConnectModal`, `HistoryModal`) mở qua `components/modals/lazyModals.ts`, không import trực tiếp ở nơi gọi.
3. **Mục 7, Testing:**
   - Helper dùng chung thực tế là `frontend/src/test/renderWithProviders.tsx`, không phải `src/test/_helpers/`.
   - `vite.config.ts` có thêm ngưỡng Functions 95%.
4. Tuỳ chọn:
   - Mọi `oxlint-disable` phải kèm lý do sau `--`.
   - Module helper có nhiều named export (ví dụ `UploadFileList.tsx`) được miễn quy ước `export default`.

---

# Sprint 07b (R4–R5): Tài liệu và version `0.0.1-beta.1`

## Sửa thêm sau 07a (theo phản hồi smoke test)

| Việc | File | Test |
|---|---|---|
| Cửa sổ "Uploading" trống: `Affix` render qua Portal mount trễ nên ref của virtualizer là null; đổi sang `useState` + callback ref | `components/layouts/uploader/UploaderWindow.tsx` | Thêm `UploaderWindow.virtualizer.test.tsx` (virtualizer thật, fail với code cũ) |
| Nhấn ESC / kéo ra khỏi cửa sổ thì overlay thả file vẫn còn: runtime Wails 3.0.0 bỏ qua `dragleave` có `relatedTarget` null; thêm listener gỡ class `file-drop-target-active` (chỉ trên WebView2) | `common/utils/dropTargetUtils.ts` (mới), `main.tsx` | `dropTargetUtils.test.ts` (7 test, 100%) |
| Modal upload: chia khu có viền (đích upload / thao tác / danh sách), dòng hướng dẫn kéo thả xuống dưới 2 nút, bỏ label "Target bucket" (xoá key `bucketLabel` en/vi/ja) | `components/modals/UploadPickerModal.tsx`, locale `uploadPickerModal.json` x3 | 54 test pass; Branches 96.96%, Lines 100% |
| Debug VS Code luôn xoá cache Vite (`frontend/node_modules/.vite`) trước khi chạy dev server | `.vscode/tasks.json` (task `vite: clear cache`) | Không áp dụng |

## R4: Tài liệu

| Đợt | Kết quả |
|---|---|
| D1 | `docs/ARCHITECTURE{,.vi,.ja}.md`: luồng handler → module → submodule, `callIPC`, store, event, message code, bindings, lệnh dev/build/test |
| D2 | `docs/package.json` (markdown-it 15, markdown-it-anchor, markdown-it-toc-done-right, playwright 1.64, @fontsource/noto-sans + noto-sans-jp), `docs/scripts/build-pdf.mjs`, `docs/scripts/shots.mjs`, `docs/theme.css`; task `docs:pdf` trong `Taskfile.yml`; `docs/node_modules`, `docs/bun.lock` vào `.gitignore` |
| D3 | `docs/seed/seed.mjs` (seed bucket `demo-photos`, `demo-reports`, `demo-backups`), 21 ảnh x 3 ngôn ngữ, `docs/user-guide/<lang>/user-guide.md` + PDF |
| D4 | `README{,.vi,.ja}.md` (viết lại), `CHANGELOG{,.vi,.ja}.md` (Keep a Changelog), `LICENSE` (MIT, 2026, `minh-truyen`) |

### Công cụ và lệnh

- Sinh PDF (một lệnh): `bun run --cwd docs build:pdf` hoặc `go tool wails3 task docs:pdf`. Lần đầu: `bun install --cwd docs` và `cd docs && bunx playwright install chromium`.
- Script chạy bằng **Node** (gọi qua `bun run`): Playwright treo ở `chromium.launch` khi chạy dưới runtime bun trên Windows. Máy sinh docs cần có Node.
- Chụp ảnh: build server mode + `portable` ra thư mục tạm (`go build -tags server,production,portable -o <tmp>/S3Browser-server.exe .`), chạy với `WAILS_SERVER_PORT=8090`, rồi `SHOTS_URL=http://localhost:8090 S3_ENDPOINT=... S3_ACCESS_KEY=... S3_SECRET_KEY=... node docs/scripts/shots.mjs`. DB nằm cạnh exe tạm, không đụng `%APPDATA%`. Credential chỉ truyền qua env.

| PDF | Trang | Dung lượng |
|---|---|---|
| en | 18 | 776 KB |
| vi | 18 | 817 KB |
| ja | 19 | 1.03 MB |

### Giới hạn ảnh chụp

- `19-download-progress`: server mode không mở được hộp thoại chọn nơi lưu, nên ảnh dùng event tiêm vào (UI thật, dữ liệu giả).
- `14-upload-modal-files`: danh sách file tiêm qua event `uploader:picker-files-dropped`; hộp thoại chọn file và kéo thả từ Explorer chỉ mô tả bằng chữ.
- Ảnh lịch sử tải xuống bị bỏ (modal trống, không có nội dung).
- Ảnh 06/07 (danh sách bucket) có cả bucket `file`, `s3browser-bench` của người dùng.
- Chưa render PDF ra ảnh để xem (máy không có pdftoppm/mutool/gs); đã kiểm số trang, ảnh và font nhúng. Header/footer chưa xem trực tiếp.
- Chỉ kiểm thủ công 16/63 ảnh; còn lại chưa xem từng tấm.

## R5: Version `0.0.1-beta.1`

| File | Cũ → mới |
|---|---|
| `build/config.yml` | `0.0.1` → `0.0.1-beta.1` |
| `frontend/package.json` | `0.0.0` → `0.0.1-beta.1` |
| `build/windows/info.json` | `file_version` `0.0.1.1`, `ProductVersion` `0.0.1-beta.1` |
| `build/windows/wails.exe.manifest` | `0.0.1.1` |
| `build/windows/nsis/wails_tools.nsh` | `INFO_PRODUCTVERSION` `0.0.1-beta.1` (→ `DisplayVersion`) |
| `build/windows/nsis/project.nsi` | thêm `INFO_NUMERIC_VERSION "0.0.1.1"` cho `VIProductVersion`/`VIFileVersion` (tránh `0.0.1-beta.1.0`) |
| `build/darwin/Info{,.dev}.plist` | `CFBundleShortVersionString` giữ `0.0.1`, `CFBundleVersion` `1` |
| `build/linux/nfpm/nfpm.yaml` | thêm `prerelease: "beta.1"` |
| iOS, `linux/desktop` | giữ nguyên |

### Build kiểm chứng

| Build | Kết quả |
|---|---|
| `go tool wails3 task build` | PASS; exe có fixed `FileVersion` `0.0.1.1` |
| `go tool wails3 task build:portable WEBVIEW2_DIR=...` (dùng lại WebView2 Fixed Version 156.0.4314.50 có sẵn trong bản portable cũ) | PASS; chạy thử 8 giây: khởi động được, `data/` tạo cạnh exe, WebView2 chạy từ `webview2/` đi kèm |
| `go tool wails3 task package` (installer NSIS) | **Chưa chạy**: máy không có `makensis`. Rủi ro R-08 chưa kiểm bằng build thật |
| macOS / Linux | Chưa build (theo Q9) |

### Phát hiện

- **Chuỗi VersionInfo của exe trống** (`ProductVersion`, `ProductName`... đọc bằng PowerShell ra rỗng; fixed version số vẫn đúng). Có từ trước sprint: mọi exe cũ trong `build/bin` (kể cả portable 27/10) đều như vậy. Resource có `StringFileInfo` `040904b0` và `Translation` 0409/04B0 khớp nhau; nguyên nhân chưa rõ (cách `wails3 generate syso` ghi resource). Đề xuất điều tra ở sprint sau.
- `data/` của `build/bin/S3Browser-portable` còn dữ liệu từ lần chạy thử (lệnh xoá bị chặn). Cần xoá tay trước khi đóng gói portable để phát hành.

## Thống kê 07b

- File đã có sửa: 12 file (`build/**` 9, `Taskfile.yml`, `.gitignore`, `README.md`, `frontend/package.json`), +131 / −27 dòng.
- File mới: `README.vi.md`, `README.ja.md`, `CHANGELOG{,.vi,.ja}.md`, `LICENSE`, `docs/**` (khoảng 2,157 dòng văn bản/script, 63 ảnh, 3 PDF).

## Chưa làm / cần người dùng

| Mục | Ghi chú |
|---|---|
| Build installer NSIS | Cài NSIS (`makensis`) rồi chạy `go tool wails3 task package`; kiểm Properties → Details và `DisplayVersion` |
| Xoá `build/bin/S3Browser-portable/data/*` | Dữ liệu chạy thử |
| Ảnh có bucket thật `file`, `s3browser-bench` | Giữ hay chụp lại với MinIO chỉ có bucket demo |
| Ngôn ngữ không được lưu giữa các lần mở app | Có thể là bug; xử lý ở sprint sau |
| Bucket demo `demo-*` trong MinIO | Giữ để chụp lại ảnh, hoặc xoá |
| Đọc lướt 3 user guide và 3 README trước khi phát hành | Nội dung do agent viết, đã đối chiếu nhãn với locale |
| Chạy thử lệnh cài docs trên máy trống | Chưa chạy |
