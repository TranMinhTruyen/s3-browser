# Plan sprint-01

## 0. Hiện trạng / gap analysis (đã đọc code)

Luồng hiện có: `TabDetail.tsx` đặt `data-file-drop-target` + `data-tab-id` (chỉ khi view là objectList) -> `main.go` bật `EnableFileDrop` và gắn `WindowFilesDropped` -> `BucketHandler.FilesDropped` -> `Module.HandleFilesDropped` -> `submoduleUploaderMng.handleFilesDropped` (os.Stat, chỉ giữ file thường, đếm `Skipped`) -> event `uploader:files-dropped` -> `ObjectListView.onFilesDropped` -> (modal `UploadLimitModal` nếu quá giới hạn) -> `UploadObject` -> `uploadObject` (đồng thời 5 file, `uploadFile` = PutObject nếu <8 MiB, ngược lại multipart song song 4 part, có progress, có cancel).

| Tiêu chí | Đánh giá | Chi tiết |
|---|---|---|
| Upload 1 file | Có vẻ đạt (chưa kiểm thử thực tế) | Luồng đầy đủ; key = `prefix + tên file`, trùng tên thì đổi thành `prefix + uuid_tên`. |
| Upload nhiều file | Có vẻ đạt, nhưng lệch ràng buộc | Backend `maxUploadFiles = 6` và frontend `MAX_UPLOAD_FILES = 6`, trong khi yêu cầu là tối đa 5. Quá giới hạn thì frontend cắt bớt và hỏi xác nhận. |
| Upload folder giữ prefix theo tên folder | **Chưa đạt, chưa có** | `handleFilesDropped` bỏ mọi thứ không phải file thường (folder bị đếm `Skipped`, hiện cảnh báo S3W006 "chỉ hỗ trợ file"). `uploadObject` dùng `filepath.Base(item.Path)` nên không giữ cấu trúc con. Chưa có duyệt đệ quy thư mục. |
| Ràng buộc file > 5GB | **Chưa có** | Không có chỗ nào kiểm tra kích thước trước khi upload. Backend dùng multipart cho file lớn nên về kỹ thuật không bị giới hạn 5GB của PutObject. |
| Unit test Go C1 | **Chưa có** | Không có file `*_test.go` nào trong repo. `go.mod` không có testify/gomock. Code upload phụ thuộc `*s3.Client` cụ thể và `*application.App` (Event.Emit, Context) nên khó test; cần seam (interface) hoặc dùng `smithy` middleware/HTTP stub. |

Lưu ý khác:
- `S3W006` chỉ được frontend dùng, backend không phát (hợp lệ nhưng cần lưu ý khi sửa).
- `existingKeys` gọi HeadObject cho từng tên file; với folder nhiều file sẽ tốn request (liên quan R-folder).
- Chưa xác minh: cách `ctx.DroppedFiles()` của Wails v3 beta.34 trả về khi thả folder (đường dẫn folder hay đã mở rộng), và hành vi trên macOS/Linux. Phải tra https://v3.wails.io/ và thử trên máy trước khi chốt thiết kế (xem Q-phụ).

## 1. Tóm tắt yêu cầu
- R1: Kéo thả file vào ObjectListView thì upload lên profile/bucket/prefix của tab đang chọn (cả hai nền tảng).
  - R1.1: 1 file upload được.
  - R1.2: nhiều file upload được tất cả.
  - R1.3: 1 folder nhiều file: upload tất cả file, key có prefix là tên folder.
  - R1.4: Unit test Go đạt C1 (branch coverage).
- Ràng buộc A: tối đa 5 file khi kéo thả.
- Ràng buộc B: nếu có file > 5GB thì cảnh báo user; "lúc đó chỉ được upload có dung lượng lớn nhất" (mơ hồ, xem Q2).

## 2. Câu hỏi chưa rõ
| # | Câu hỏi | Đề xuất | Trả lời |
|---|---|---|---|
| Q1 | Giới hạn "5 file" hiện đang là 6 trong code (backend + frontend). Sửa thành 5? Khi thả quá 5 file thì giữ hành vi hiện tại (cắt còn 5 đầu tiên + modal xác nhận) hay từ chối hẳn? | Sửa về 5; giữ hành vi cắt + xác nhận. | (chờ người dùng) |
| Q2 | Câu "lúc đó chỉ được upload có dung lượng lớn nhất" hiểu thế nào? (a) bỏ qua các file > 5GB, chỉ upload các file còn lại; (b) chỉ upload đúng 1 file có dung lượng lớn nhất trong số thả vào; (c) chỉ upload các file > 5GB; (d) chặn upload cả lô cho tới khi user bỏ file lớn. | (a): cảnh báo liệt kê file > 5GB, hỏi xác nhận, rồi upload các file còn lại. (b)/(c) nghe ngược với ý "cảnh báo vì file quá lớn". | (chờ người dùng) |
| Q3 | 5GB là giới hạn cứng của PutObject đơn, nhưng backend đã dùng multipart nên upload file > 5GB vẫn được (S3 tối đa 5TB). 5GB ở đây là quy tắc nghiệp vụ (chặn/cảnh báo do thời gian, chi phí) hay do hiểu nhầm giới hạn PutObject? Có cần cho phép user chọn "vẫn upload" không? | Coi là quy tắc nghiệp vụ: cảnh báo + cho user chọn bỏ file lớn hoặc vẫn upload (tuỳ trả lời Q2). 5GB tính là 5 * 1024^3 byte hay 5 * 10^9? Đề xuất 1024^3. | (chờ người dùng) |
| Q4 | "5 file" áp dụng cho folder thế nào? (a) đếm item thả vào (1 folder = 1 item, bên trong bao nhiêu file cũng được); (b) đếm tổng số file sau khi mở rộng folder (folder 100 file -> vượt 5); (c) tối đa 5 item thả vào và không giới hạn file trong folder nhưng upload theo lô. | (a) cho giới hạn thả vào, nhưng cần mức trần an toàn cho tổng số file trong folder (ví dụ 1000) để tránh treo UI. Cần người dùng chốt con số. | (chờ người dùng) |
| Q5 | Folder lồng nhau (subfolder) thì sao? Key = `prefix + tên-folder-gốc + "/" + đường-dẫn-tương-đối`? Có upload cả subfolder không? Folder rỗng có tạo "folder marker" (`name/`) không? File ẩn/symlink có bỏ qua không? | Đệ quy toàn bộ, giữ đường dẫn tương đối, bỏ qua folder rỗng, bỏ symlink và file không đọc được (đếm vào cảnh báo). | (chờ người dùng) |
| Q6 | Khi key đã tồn tại: hiện tại đổi thành `prefix + uuid_tên` (không ghi đè). Với folder, giữ quy tắc này cho từng file, hay hỏi ghi đè/bỏ qua? | Giữ nguyên quy tắc đổi tên, áp dụng từng file; không thêm UI mới trong sprint này. | (chờ người dùng) |
| Q7 | Phạm vi C1: package nào phải đạt? (a) chỉ `internal/modules/bucket` phần upload (`submodule_uploader_mng.go`, `submodule_s3_upload.go`, hàm thuần mới); (b) toàn bộ `internal/modules/bucket`; (c) toàn bộ Go backend. Có chấp nhận mock S3 bằng HTTP test server / interface, và có được thêm thư viện test (testify) không? `go.mod`/`go.sum` bị chặn ghi cho agent. | (a) và chỉ dùng thư viện chuẩn (`testing`, `httptest`) để không đụng go.mod/go.sum. Đo bằng `go test` + `-coverprofile`; Go chỉ có statement coverage, nên C1 sẽ được xác minh bằng rà soát nhánh thủ công (bảng nhánh trong test) chứ không có công cụ đo branch tự động. Người dùng xác nhận chấp nhận cách đo này. | (chờ người dùng) |
| Q8 | Được phép refactor để test được không (ví dụ tách interface S3 API cho `uploadFile`/`existingKeys`, tách `emitter` thay `*application.App`, tách hàm duyệt folder thuần)? | Có, refactor nhỏ, hành vi giữ nguyên. | (chờ người dùng) |
| Q9 | Cách báo cảnh báo >5GB: dùng modal mới (kiểu `UploadLimitModal`) hay toast? | Modal (cần người dùng chọn), tái dùng/mở rộng `UploadLimitModal`. | (chờ người dùng) |
| Q10 | Việc mở rộng folder do backend làm (trong `handleFilesDropped`) hay frontend? Chỉ backend có quyền truy cập file system. Backend cũng phải trả về kích thước từng file để kiểm tra >5GB trước khi hiện modal. Có chấp nhận đổi payload `FilesDroppedOutput` (thêm size, relative key) và `UploadObj` (thêm đường dẫn tương đối) không? | Có; backend mở rộng folder, trả về `{path, relKey, size}`. | (chờ người dùng) |
| Q11 | Chưa xác minh Wails: thả folder trên Windows/macOS/Linux, `DroppedFiles()` có trả đường dẫn folder không, và có giới hạn nền tảng nào không? Yêu cầu ghi "Cả hai" nền tảng (hiểu là Windows + macOS?). | Planner/dev sẽ tra docs v3.wails.io và chạy thử trước; nếu docs không rõ, xin người dùng test thủ công trên macOS. | (chờ người dùng) |

## 3. Task backend (go-backend)
Giả định theo đề xuất (Q1 = 5, Q2 = (a), Q4 = (a) + trần, Q7 = (a), Q8 = có). Cần chỉnh nếu người dùng trả lời khác.

| # | Task | Yêu cầu | File sửa / tạo | Phụ thuộc |
|---|---|---|---|---|
| B1 | Đổi `maxUploadFiles` 6 -> 5 (dùng chung một nguồn cho backend/frontend nếu có thể, ví dụ trả qua payload) | Ràng buộc A | internal/modules/bucket/submodule_uploader_mng.go (sửa) | - |
| B2 | Thêm hàm thuần duyệt đường dẫn thả vào: file thường -> 1 mục; folder -> đệ quy (filepath.WalkDir), mỗi file có `relKey = <tên folder>/<đường dẫn tương đối>` (dùng `/`), bỏ symlink/file lỗi (đếm skipped), áp trần tổng số file (Q4) | R1.3 | internal/modules/bucket/uploader_expand.go (tạo) | B1 |
| B3 | `handleFilesDropped` dùng B2, trả thêm size từng file và danh sách file > 5GB (hoặc trả size để frontend so sánh); không còn đếm folder là Skipped | R1.3, Ràng buộc B | internal/modules/bucket/submodule_uploader_mng.go (sửa); models/bucket/files_dropped_output.go (sửa); models/bucket/upload_obj_input.go (sửa: thêm `RelKey`/`Size`) | B2 |
| B4 | `uploadObject`: dùng `RelKey` để dựng key (`prefix + relKey`, kiểm tra không có `..`/đường dẫn tuyệt đối), giữ nguyên quy tắc đổi tên khi trùng; `existingKeys` kiểm theo key đầy đủ thay vì chỉ tên file; kiểm tra lại >5GB phía backend (không tin frontend) -> trả message cảnh báo/bỏ file theo Q2 | R1.3, Ràng buộc A/B | internal/modules/bucket/submodule_uploader_mng.go (sửa) | B3 |
| B5 | Message code mới (ví dụ `S3W007` file > 5GB bị bỏ qua, `S3E019` folder vượt trần số file) kèm key en/vi/ja; cập nhật nội dung S3W006 nếu không còn "folder" bị bỏ qua | Ràng buộc B | internal/modules/bucket/module.go (sửa); frontend/src/locales/{en,vi,ja}/messages/ipcMessage.json (sửa) | B4 |
| B6 | Tách seam để test: interface `s3Uploader` (PutObject, CreateMultipartUpload, UploadPart, CompleteMultipartUpload, AbortMultipartUpload, HeadObject) cho `uploadFile`/`putMultipart`/`existingKeys`; interface `eventEmitter` thay `*application.App` trong uploader; giữ hành vi (Q8) | R1.4 | internal/modules/bucket/submodule_s3_upload.go (sửa); internal/modules/bucket/submodule_uploader_mng.go (sửa) | B4 |
| B7 | Viết unit test đạt C1 cho phạm vi Q7: `uploadPartSize`, `normalizePrefix`, `nonEmpty`, `progressReader` (Read/Seek, lỗi Seek), `uploadFile` (open lỗi, không phải file thường, <8MiB, >=8MiB, lỗi part, huỷ giữa chừng + abort lỗi), `existingKeys` (404, lỗi khác, trùng tên), hàm duyệt folder (B2), `uploadObject` (rỗng, quá 5, busy, conn không có, thành công, trùng tên, canceled, lỗi), `handleFilesDropped` (nếu tách được logic thuần), `cancelUploadOne/All`. Dùng bảng nhánh trong test để chứng minh C1 | R1.4 | internal/modules/bucket/submodule_s3_upload_test.go, submodule_uploader_mng_test.go, uploader_expand_test.go (tạo) | B6 |

Message code mới: S3W007, S3E019 (tạm đặt, chốt khi có trả lời Q2/Q4)  |  Migration / sqlc: không  |  Cần sinh lại bindings: có (đổi `FilesDroppedOutput`, `UploadObj`)

## 4. Task frontend (react-frontend)
| # | Task | Yêu cầu | File sửa / tạo | Phụ thuộc |
|---|---|---|---|---|
| F1 | `MAX_UPLOAD_FILES` 6 -> 5 (hoặc đọc từ backend); `onFilesDropped` dùng payload mới (path + relKey + size), không còn cảnh báo "bỏ qua folder" sai, truyền `relKey` vào `UploadObject` | Ràng buộc A, R1.3 | frontend/src/pages/bucket/components/views/ObjectListView.tsx (sửa) | B5 + bindings |
| F2 | Cảnh báo file > 5GB: mở rộng modal (liệt kê file lớn, cho user xác nhận upload phần còn lại theo Q2); hiển thị cả trường hợp folder bị cắt/vượt trần | Ràng buộc B | frontend/src/components/modals/UploadLimitModal.tsx (sửa) hoặc modal mới frontend/src/components/modals/LargeFileWarningModal.tsx (tạo) | F1 |
| F3 | Chuỗi i18n cho cảnh báo mới (en/vi/ja) và đăng ký namespace nếu tạo modal mới | Ràng buộc B | frontend/src/locales/{en,vi,ja}/components/modals/*.json, resource.ts của cả 3 ngôn ngữ (sửa/tạo) | F2 |

i18n key mới (en/vi/ja): `uploadLimitModal` (sửa nội dung `description`, thêm `largeFileDescription`...), `ipcMessage` S3W007/S3E019 (thuộc B5). Không đổi `tabListStore` (đã có `uploadingTabId`).

## 5. Thứ tự thực hiện (luôn tuần tự)
1. Backend: B1 -> B2 -> B3 -> B4 -> B5 -> B6 -> B7 (chạy `go vet ./...`, `go build ./...`, `go test -cover ./internal/modules/bucket/...`, `go tool golangci-lint run ./...`)
2. `go tool wails3 generate bindings -clean=true -ts` (không cần `go tool sqlc generate`)
3. Frontend: F1 -> F2 -> F3 (biome, oxlint, `node_modules/.bin/tsc.exe --noEmit`)

## 6. Rủi ro
| # | Rủi ro | Mức độ | Cách giảm thiểu |
|---|---|---|---|
| 1 | Yêu cầu ràng buộc B mơ hồ (Q2) có thể làm lại phần backend/frontend | high | Chốt Q2/Q3 trước khi triển khai |
| 2 | Wails `DroppedFiles()` với folder chưa xác minh trên các nền tảng; nếu không trả folder thì R1.3 không làm được bằng drag-drop | high | Tra docs + thử trước B2; nếu không được thì dừng và hỏi |
| 3 | Mock S3 phức tạp (`*s3.Client` cụ thể); C1 không có công cụ đo branch trong Go | medium | Interface seam (B6), httptest, bảng nhánh; thống nhất cách đo ở Q7 |
| 4 | Folder lớn: nhiều HeadObject, nhiều file, UI treo; `uploadObject` đang chặn tới khi xong và `maxUploadFiles` đang chặn số mục | medium | Trần số file (Q4), HeadObject theo lô có giới hạn đồng thời |
| 5 | Path traversal / key không hợp lệ từ `RelKey` do frontend gửi | medium | Validate ở backend (B4) |
| 6 | Đổi payload event/model ảnh hưởng bindings và tab khác | low | Sinh lại bindings, type-check |
| 7 | Sprint có 10 task (7 BE + 3 FE), sát ngưỡng ~10 | low | Nếu Q4/Q5 mở rộng thì tách sprint: (1) sửa giới hạn + cảnh báo 5GB, (2) folder, (3) unit test |
| 8 | `go.mod`/`go.sum` bị chặn ghi: không thêm được thư viện test | low | Chỉ dùng thư viện chuẩn |

## 7. Tiêu chí hoàn thành
- [ ] Thả 1 file: upload lên đúng bucket/prefix của tab đang chọn.
- [ ] Thả nhiều file (tối đa 5): upload tất cả; thả >5 hiện đúng hành vi đã chốt ở Q1.
- [ ] Thả 1 folder nhiều file: mọi file được upload với key `prefix/<tên folder>/<đường dẫn tương đối>`.
- [ ] File > 5GB: hiện cảnh báo và xử lý đúng theo Q2.
- [ ] Unit test Go cho phạm vi Q7 đạt C1 (có bảng nhánh), `go test` xanh, `go vet` và golangci-lint sạch.
- [ ] Message mới có đủ key en/vi/ja; bindings đã sinh lại; biome, oxlint, tsc sạch.

## Quyết định của người dùng (2026-10-26)

- **Q1:** Giới hạn 5. Thả quá 5 file thì giữ 5 file đầu, hiện modal xác nhận; user đồng ý mới upload.
- **Q2:** Nếu trong các file được giữ có file > 5 GiB thì chỉ upload **duy nhất file lớn nhất** (kể cả khi có nhiều file > 5 GiB), bỏ qua các file khác. Luôn hiện modal báo cho user; user xác nhận mới upload.
- **Q3:** 5 GiB là quy tắc nghiệp vụ của người dùng, tính theo 5×1024³ byte.
- **Q4:** Thả folder thì **đếm tổng số file** sau khi mở rộng folder (đệ quy). Tổng > 5 thì giữ 5 file đầu và hỏi xác nhận (như Q1).
- **Q5:** Theo đề xuất: duyệt đệ quy, giữ đường dẫn tương đối làm key (prefix = tên folder), bỏ qua folder rỗng và symlink. Ưu tiên hiệu năng (dừng duyệt sớm khi đủ số file cần thiết nếu được); module dài thì tách submodule con.
- **Q6:** Giữ quy tắc đổi tên `uuid_tên` hiện có khi key đã tồn tại.
- **Q7:** Unit test C1 cho `internal/modules/bucket`, chỉ dùng thư viện chuẩn (go.mod/go.sum bị chặn ghi).
- **Q8:** Được tách interface S3 client và emitter, miễn dễ bảo trì.
- **Q9:** Cảnh báo dùng modal.
- **Q10:** Được đổi payload `FilesDroppedOutput`/`UploadObj`, miễn đúng nghiệp vụ và dễ bảo trì.
- **Q11:** Tạm thời chỉ Windows.
