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

Ngày: 2026-10-26. Ba việc này người dùng yêu cầu thêm sau R2, nằm ngoài tiêu chí chấp nhận của sprint.

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

## Kết quả kiểm tra
- `go tool golangci-lint run ./...`: **0 issues**.
- `gofmt -l`, `go build ./...`, `go vet ./...`, `go test -count=1 ./...`: **pass**.

## Còn lại
- Chưa chạy app thật để xác nhận tắt app không còn panic.
- Các mục "Chưa làm / lưu ý" ở R1 (1, 3–6) và R2 (1–4) vẫn còn nguyên.
