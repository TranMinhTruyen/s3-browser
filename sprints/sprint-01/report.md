# Sprint 01: Báo cáo kết quả

Ngày: 2026-10-26. Số vòng B4: 2/3. Kết luận review: **ĐẠT** (không có bug, không có rủi ro từ medium trở lên).

## Thống kê

- File sửa: 14 file, **+292 / −104** dòng.
- File mới: 5 file, **1144** dòng (khoảng 3/4 là test).
- Bindings `frontend/bindings/**` đã sinh lại. Thư mục này nằm trong `.gitignore`, nên không tính vào số liệu trên.

### File sửa
- `internal/modules/bucket/module.go`: thêm message code `S3E019`, `S3W007`. Đổi nội dung `S3W006`.
- `internal/modules/bucket/submodule_uploader_mng.go`: giới hạn 5 file, mở rộng folder, quy tắc file > 5 GiB, `relKey`, tách interface để test.
- `internal/modules/bucket/submodule_s3_upload.go`: tách interface `s3Uploader`.
- `models/bucket/files_dropped_output.go`, `models/bucket/upload_obj_input.go`, `models/alias.go`
- `frontend/src/pages/bucket/components/views/ObjectListView.tsx`
- `frontend/src/components/modals/UploadLimitModal.tsx`
- `frontend/src/locales/{en,vi,ja}/messages/ipcMessage.json`
- `frontend/src/locales/{en,vi,ja}/components/modals/uploadLimitModal.json`

### File mới (`internal/modules/bucket/`)
- `uploader_expand.go`: duyệt folder đệ quy. Dừng sớm khi tìm thấy file thứ 6, hoặc khi đã duyệt 100.000 mục. Bỏ qua symlink, folder rỗng và gốc ổ đĩa. `cleanRelKey` chặn path traversal.
- `helpers_test.go`, `uploader_expand_test.go`, `submodule_s3_upload_test.go`, `submodule_uploader_mng_test.go`

## Đối chiếu tiêu chí chấp nhận

| Tiêu chí | Trạng thái |
|---|---|
| Kéo thả 1 file | Đã có code và unit test backend. **Chưa chạy thử trên app.** |
| Kéo thả nhiều file (tối đa 5; quá 5 thì giữ 5 file đầu và hỏi xác nhận) | Đã có code và unit test. **Chưa chạy thử trên app.** |
| Kéo thả folder, upload với prefix là tên folder | Đã có code và unit test. **Chưa chạy thử trên app.** Code dựa trên mã nguồn Wails beta.34: trên Windows, `DroppedFiles()` trả đường dẫn folder chưa mở rộng. Docs v3.wails.io trả 403 nên chưa đối chiếu được với docs. |
| File > 5 GiB: chỉ upload file lớn nhất, có modal xác nhận | Đã có ở cả frontend và backend. Backend tự `os.Stat` để kiểm tra lại. |
| Unit test Go đạt C1 | Mọi hàm upload/drop trong `internal/modules/bucket` đạt 100% statement. Bảng nhánh nằm ở comment đầu mỗi file test. Hai ngoại lệ: `handleFilesDropped` đạt 50% (nhánh uỷ quyền sang `handleDrop`, không dựng được `WindowEventContext` của Wails), và `appHost.Context`/`Emit` đạt 0% (lớp bọc mỏng). Coverage toàn package là 32.2%, vì các submodule khác ngoài phạm vi (Q7). |

## Kết quả kiểm tra

- `go build ./...`, `go vet ./...`, `gofmt -l`, `go test -count=1 ./internal/modules/bucket/...`: **pass**.
- biome 2.5.15, oxlint, `tsc.exe --noEmit`: **pass**.
- `go tool golangci-lint`: lúc làm R1 **không chạy được** (`no such tool`). Đã bổ sung tool sau đó, hiện **0 issues** (xem mục "Bổ sung sau sprint").
- `go test -race`: không chạy được vì cần CGO.

## Phần chưa làm / cần người dùng xử lý

1. **Chạy thử thủ công trên Windows**: thả 1 file, nhiều file, quá 5 file, folder lồng nhau, file > 5 GiB.
2. ~~**golangci-lint**: `go.mod` chỉ khai báo tool `wails3`, không có `golangci-lint` và `sqlc`.~~ **Đã xử lý**: xem mục "Bổ sung sau sprint".
3. **Lệnh biome trong CLAUDE.md §5**: `npx biome` trong `frontend/` chạy nhầm một package khác (0.3.3). Lệnh này thoát với exit 0 mà không làm gì. Lệnh đúng: chạy từ `App/S3Browser` (nơi có `biome.json`) bằng `frontend/node_modules/.bin/biome.exe check [--write] <files>`.
4. **Chờ quyết định**: khi vừa thả quá 5 file vừa có file > 5 GiB, modal hiện cả hai dòng "chỉ giữ 5 file đầu" và "chỉ upload file lớn nhất". Reviewer đề xuất ẩn dòng đầu cho đỡ rối. Hiện đang giữ cả hai.
5. Nhãn dung lượng trong modal hiện "5.00 GB", vì `formatFileSize` dùng nhãn GB. Giá trị vẫn tính theo 5×1024³.
6. `cleanRelKey` cấm `\` và `:` vì hiện chỉ hỗ trợ Windows (Q11). Cần xem lại khi hỗ trợ macOS/Linux.

---

# R2: UploaderWindow — Báo cáo

Ngày: 2026-10-26. Số vòng B4: 2/3. Kết luận review: **ĐẠT** (vòng 1 CHƯA ĐẠT vì UploaderWindow chưa mount và vị trí tính sai; đã sửa ở vòng 2).

## Thống kê
- R2 (phần chưa stage): sửa 9 file **+74 / −11**, file mới 6 file **326 dòng**; cộng phần Go của R2 nằm trong các file đã stage (`events.go`, `module.go`, `submodule_uploader_mng.go`, test, `models/bucket/upload_state_output.go`).
- Tổng toàn sprint so với HEAD: 28 file, **+1757 / −126** (bao gồm 1628 dòng của file mới).

## Thay đổi
**Backend**
- Event mới `uploader:upload-started` (`UploadStartedOutput`: uploadId, fileName, key, bucket, total) và `uploader:upload-finished` (`UploadFinishedOutput`: uploadId, status `success|error|canceled`), emit trong `uploadOne`. Thứ tự: started → progress* → finished (file không mở được thì không có progress).
- Handler `CancelUploadOne(id)`, `CancelAllUploads()` (`module.go`, `internal/handlers/bucket_handler.go`).
- Test C1: `TestUploadObject_EventsSuccess|Error|MissingFile|Canceled`. Các hàm upload/drop 100%, ngoại lệ như R1 (`handleFilesDropped` 50%, `appHost.Context/Emit` 0%).

**Frontend**
- Mới: `common/stores/uploaderStore.ts` (start/progress/finish/reset, tombstone `finishedIds` tối đa 200 chống race), `components/layouts/uploader/UploaderWindow.tsx`, `UploaderItem.tsx`, `locales/{en,vi,ja}/components/uploaderWindow.json`.
- Sửa: `MainLayout.tsx` (mount), `resource.ts` ×3, `downloaderStore.ts` + `DownloaderWindow.tsx` (cờ mở/đóng chuyển vào store; đo kích thước thật bằng `useElementSize` → `windowSize` để Uploader tính vị trí; giao diện/hành vi Downloader giữ nguyên).
- Vị trí: không có download → góc dưới phải 16/16. Có download: Uploader window mở nằm bên trái Downloader; Uploader đóng thì button nằm trên Downloader.

## Kiểm tra
- go build/vet, gofmt, go test, biome 2.5.15, oxlint, tsc: **pass**. golangci-lint: lúc làm R2 chưa chạy được (như R1); hiện **0 issues**.

## Chưa làm / lưu ý
1. Chưa chạy app thật: cần kiểm tra bằng mắt vị trí khi vừa download vừa upload, huỷ từng file, huỷ tất cả.
2. (low) Khi Downloader đổi window↔button, Uploader có thể giật vị trí 1 frame (ResizeObserver + rAF).
3. (low) Nếu event `started` bị tombstone bỏ qua, cờ mở của Uploader vẫn bật → lần upload sau mở thẳng window thay vì button.
4. (có từ trước) `DownloaderWindow`/`DownloaderItem`, `ObjectItem` còn hard-code chuỗi "Downloading", "Downloaded", "Remaining", "Size", "Last Modified" — nên i18n ở sprint sau.

---

# Bổ sung sau sprint

Ngày: 2026-10-26. Các việc này người dùng yêu cầu thêm sau R2, nằm ngoài tiêu chí chấp nhận của sprint.

## 1. Bổ sung tool vào `go.mod`
- Thêm `golangci-lint` (`github.com/golangci/golangci-lint/v2/cmd/golangci-lint`) và `sqlc` (`github.com/sqlc-dev/sqlc/cmd/sqlc`) vào khối `tool (...)`, cạnh `wails3`. Như vậy `go.mod` đã khớp với CLAUDE.md §4.
- Thêm bằng `go get -tool`. `go.mod` tăng +208 dòng, `go.sum` tăng +467 dòng, toàn bộ là dependency indirect của tool.

## 2. Sửa 15 lỗi lint có từ trước
Sau khi có golangci-lint, lần chạy đầu báo 15 lỗi. Các lỗi này đều có từ trước, không do sprint-01 sinh ra.
- File sửa: `internal/pkg/db/init_db.go`, `internal/app.go`, `internal/handlers/profile_handler.go`, `internal/modules/bucket/submodule_s3_download.go`, `submodule_bucket_mng.go`, `submodule_connection_mng.go`, `submodule_object_mng.go`, `submodule_downloader_mng.go`.
- Phần lớn là lỗi bỏ qua error, chủ yếu khi gọi `Close`. Riêng `backupIfExists` trong `init_db.go`, lỗi `Close` của file đích được gộp vào error trả về bằng `errors.Join`.
- Xoá field `cfg` không dùng trong `App`.

## 3. Sửa bug tắt app (`internal/app.go`)
- **Bug có từ trước:** `NewApp` không gán `logger`, `sqlDb`, `app` vào struct `App`. Khi tắt app, `Shutdown` (đăng ký qua `mainApp.OnShutdown`) sẽ panic ở `a.app.Event.Reset()` vì nil pointer, và DB không được đóng.
- **Đã sửa:** gán đủ ba field này trong `NewApp`.
- **Bổ sung:** `Shutdown` gọi thêm `a.BucketHandler.CancelAllUploads()`, để upload đang chạy được huỷ khi tắt app (trước đây chỉ huỷ download).

## 4. Nút "Huỷ tất cả" trên DownloaderWindow
- Thêm nút huỷ tất cả (icon `X` màu đỏ) vào header của `DownloaderWindow`, cạnh nút đóng. Nút này giống nút trên `UploaderWindow`. Bấm nút sẽ gọi binding `CancelAllDownloads`, có sẵn từ trước. Backend huỷ mọi download **đang chạy**; file đã tải xong không bị ảnh hưởng.
- Chỉ sửa frontend; backend không thay đổi.
- File sửa: `frontend/src/components/layouts/downloader/DownloaderWindow.tsx`, `frontend/src/locales/{en,vi,ja}/resource.ts`.
- File mới: `frontend/src/locales/{en,vi,ja}/components/downloaderWindow.json` (`title`, `action.cancelAll`). Tiêu đề "Downloading" trước đây hard-code, giờ đã đi qua i18n.

## 5. Bổ sung i18n cho các màn hình còn hard-code
Đã quét toàn bộ `frontend/src` và chuyển mọi chuỗi UI hard-code sang i18n (en, vi, ja). Giữ nguyên các chuỗi là tên riêng hoặc mã: `AWS`, `MinIO`, `EN`/`VI`/`JA`.

| Màn hình / component | Chuỗi đã chuyển | Namespace |
|---|---|---|
| `pages/bucket/components/TabDetail.tsx` | Tooltip Connect, Refresh … | `bucket.page` → `tooltip.*` |
| `pages/bucket/components/TabDetail.tsx` (phần chỉ hiện khi xem object list) | Back to parent folder / bucket, Clear / Download / Delete selected, "object list" | `object.page` → `tooltip.*` |
| `pages/object/components/ObjectItem.tsx` | Size, Last Modified, menu Download / Delete | `object.page` → `label.*`, `action.*` |
| `pages/bucket/components/BucketItem.tsx` | Create date: | `bucket.page` → `label.createDate` |
| `pages/bucket/Page.tsx` | aria-label Close tab | `bucket.page` → `tooltip.closeTab` |
| `components/layouts/downloader/DownloaderItem.tsx` | Object, Downloaded, Remaining | `downloaderWindow` → `label.*` |
| `components/layouts/navbar/components/HeaderButtonGroup.tsx` | Tooltip Connect, Create connection profile, Refresh connection profile list | `connectionProfiles` → `tooltip.*` |
| `components/layouts/MainLayout.tsx` | Tooltip Download history | dùng lại `historyModal:title` |
| `components/inputs/combobox/Combobox.tsx`, `RegionCombobox.tsx` | aria-label "Clear region" | `common:button.clear` (key mới) |

- Tooltip Refresh trước đây ghép chuỗi `` `Refresh ${…}` ``, nên không dịch được đúng thứ tự từ (ví dụ tiếng Nhật). Giờ dùng template `tooltip.refresh` với tham số `{target}`, điền qua `formatStringJson`.
- Combobox dùng chung trước đây có aria-label "Clear region" bị sai nghĩa với combobox không phải region. Giờ đổi thành "Clear" chung.
- File locale sửa (×3 ngôn ngữ): `common.json`, `components/navbar/connectionProfiles.json`, `components/downloaderWindow.json`, `pages/bucket/page.json`, `resource.ts`.
- File locale mới (×3 ngôn ngữ): `pages/object/page.json`, đăng ký thành namespace `object.page`. Object list là page riêng, nên key của nó không để chung với `bucket.page`.

### Tách object list ra khỏi page bucket
Object list là page riêng, nên code, CSS và i18n của nó được tách khỏi `pages/bucket`:
- **Chuyển file** (chỉ đổi vị trí, nội dung giữ nguyên trừ import):
  - `pages/bucket/components/ObjectItem.tsx` → `pages/object/components/ObjectItem.tsx`
  - `pages/bucket/components/views/ObjectListView.tsx` → `pages/object/components/views/ObjectListView.tsx`
- **CSS:** file mới `pages/object/page.module.css` chứa `card`, `iconSection`, `label`, `dropZone`. `pages/bucket/page.module.css` chỉ giữ `card` và `iconSection`, vì `BucketItem` chỉ dùng hai class này.
- **Import:** `TabDetail` lấy `dropZone` từ CSS của object (drop zone chỉ bật khi đang xem object list). `UploadLimitModal` lấy `label` từ CSS của object.
- **i18n:** `TabDetail` dùng thêm `tObject` (namespace `object.page`) cho các tooltip của object list. Tooltip Refresh chọn `target` theo view hiện tại.
- Các đường dẫn `ObjectListView.tsx` / `ObjectItem.tsx` ghi ở phần R1 và R2 phía trên là vị trí cũ.

### Tách phần tab thành component layout
Mục tiêu: `pages/bucket` và `pages/object` chỉ chứa view và component riêng của chúng. Phần tab dùng chung được chuyển vào layout.
- **File mới `components/layouts/tab/TabLayout.tsx`**: phần thanh tab trước đây nằm trong `pages/bucket/Page.tsx`, gồm danh sách tab, nút đóng tab, nút thêm tab, cuộn đến tab đang chọn và khung panel. Mỗi panel render `TabDetail`.
- **Chuyển file:**
  - `pages/bucket/components/TabLabel.tsx` → `components/layouts/tab/components/TabLabel.tsx`
  - `pages/bucket/components/TabDetail.tsx` → `components/layouts/tab/components/TabDetail.tsx` (header gồm chọn profile, Connect, Refresh, Back, breadcrumb, thao tác trên mục đã chọn, rồi chuyển giữa `BucketListView` và `ObjectListView`)
- **Xoá `pages/bucket/Page.tsx`.** Route `/` trong `components/router/RouterItem.tsx` giờ lazy-load thẳng `TabLayout`.
- **Cấu trúc `pages` sau khi tách:**
  - `pages/bucket`: `components/BucketItem.tsx`, `components/views/BucketListView.tsx`, `page.module.css`
  - `pages/object`: `components/ObjectItem.tsx`, `components/views/ObjectListView.tsx`, `page.module.css`
- **Sửa nhỏ:** hàm đóng tab trước đây viết dạng curry, không bọc `useCallback`. Giờ đổi thành `onClickCloseTab`, có bọc `useCallback`, theo đúng quy ước.
- **i18n:** namespace mới `tabLayout` (`locales/{en,vi,ja}/components/tabLayout.json`, có đăng ký trong `resource.ts`) gồm `title.defaultTabName`, `tooltip.closeTab`, `tooltip.connect`, `tooltip.refresh`. Các key này đã được xoá khỏi `bucket.page`, nên `bucket.page` giờ chỉ còn `tooltip.bucketList` và `label.createDate`. `TabDetail` dùng `tabLayout` cho header chung, `bucket.page` / `object.page` cho các chuỗi riêng của từng view.

## 6. Sửa lỗi sau review (code-reviewer + verifier)
**Frontend:**
- **Lỗi verifier:**
  - Format biome của `common/stores/tabListStore.ts`.
  - `confirmModal.json` bản vi/ja dùng sai key `confirmText`, đã đổi thành `confirmCode`.
  - Thêm `C000005` còn thiếu.
- **`TabDetail.tsx`:**
  - Trước đây select nguyên object `connectionProfiles`, giờ đổi sang selector hẹp:
    - danh sách tên dùng `useShallow`;
    - profile đang chọn lấy riêng.
  - Đổi tên `onCLickConnect` thành `onClickConnect`.
  - Thêm `onClickClearSelected` và `onClickBreadcrumb`, bọc `useCallback`.
- **Bọc `useCallback` cho mọi handler:**
  - `HeaderButtonGroup.tsx`: `onClickConnect`, `onClickCreateProfile`, `onClickRefresh`.
  - `BucketItem.tsx`: `onClickBucket`.
  - `ObjectItem.tsx`: `onClickFolder`, `onClickCard`, `onChangeCheckbox`, `onClickMenuSection`, `onClickDownloadButton`.

**Backend (`internal/modules/bucket`):**
- **Huỷ được trong giai đoạn kiểm tra key.**
  - Trước đây `cancelAllUploads` chỉ huỷ được các job đã vào `uploadOne`. Nếu bấm huỷ lúc `existingKeys` đang gọi `HeadObject`, upload vẫn tiếp tục.
  - Giờ `uploadObject` tạo một context cho cả lần gọi, lưu cancel vào `batchCancel` (có `batchMu` bảo vệ). `cancelAllUploads` gọi thêm cancel này.
  - Trong `uploadOne`, nếu context đã bị huỷ trước khi file bắt đầu, file đó không được gửi lên mà báo `S3W004` (canceled).
- **Chặn symlink:** `uploadFile` gọi `os.Lstat` trước `os.Open`, nên symlink bị từ chối thay vì bị đi theo. Kiểm tra `IsRegular` sau khi `Open` vẫn được giữ.
- **Sửa comment** trong `cleanRelKey` (`uploader_expand.go`): comment ghi thiếu ký tự `\`.
- **Test mới:**
  - `TestUploadObject_CanceledDuringKeyCheck`.
  - `TestUploadFile_Symlink`: bị skip trên Windows nếu không có quyền tạo symlink.
  - Đã cập nhật bảng nhánh C1 ở đầu file test.

**Không sửa, có lý do:**
- `S3W006`: reviewer báo không dùng, nhưng frontend `ObjectListView` có dùng để báo số file bị bỏ qua.
- `normalizePrefix` với `..`: không gây hại, vì S3 coi `..` là ký tự thường trong key.
- `handleDrop` chạy đồng bộ: chấp nhận được.
- Ngoại lệ context cho upload: upload dùng `app.Context()` thay vì ctx của IPC, cần ghi vào CLAUDE.md. Người dùng tự cập nhật, vì file này bị chặn ghi.

## Kết quả kiểm tra
- `go tool golangci-lint run ./...`: **0 issues**.
- `gofmt -l`, `go build ./...`, `go vet ./...`, `go test -count=1 ./...`: **pass**.
- Mục 4, 5, 6: biome, oxlint, `tsc.exe --noEmit`: **pass**. Quét lại bằng grep không còn chuỗi UI hard-code.

## Còn lại
- Chưa chạy app thật để xác nhận tắt app không còn panic, để thử nút huỷ tất cả download, và để xem bản dịch hiển thị ở cả 3 ngôn ngữ.
- Các mục "Chưa làm / lưu ý" ở R1 (1, 3–6) và R2 (1–3) vẫn còn. R2 mục 4 (chuỗi hard-code) đã xử lý ở mục 5.
