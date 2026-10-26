# Plan sprint-02

## 0. Hiện trạng (đã đọc code)

Xoá object:
- `ObjectItem.tsx`: nhánh `item.isFolder` render Card không có menu; chỉ object thường có `Menu` (Download, Delete). Comment trong code ghi "folder không thể chọn, tải, xoá".
- `ObjectListView.onClickMenuButton` lọc bỏ key kết thúc bằng `/` ("xoá chỉ xoá folder marker, không xoá file bên trong"), nên hiện không có đường nào xoá prefix. Giới hạn chọn tối đa 5 mục (`C000005`).
- Có 2 lần xác nhận cho cùng một lần xoá: `ObjectItem.onClickDeleteButton` hiện `ConfirmModal C000004`, rồi `onClickMenuButton(..., 'delete')` lại hiện `ConfirmModal C000004` lần nữa (xác minh bằng đọc code; có vẻ là lỗi sẵn có, ngoài phạm vi nhưng ảnh hưởng thiết kế R1).
- Backend `Module.DeleteObject` -> `submoduleObjMng.deleteObject` (`submodule_object_mng.go`): với mỗi key chạy HeadObject rồi DeleteObject, `errgroup` limit `concurrency` (=6, khai báo ở `submodule_downloader_mng.go`), timeout 5 phút, trả một message `S3S005`/`S3E013` cho mỗi key. Input `DeleteObjInput{ConnectionId, ProfileName, Bucket, Objects []string}`. Chưa có DeleteObjects (batch), chưa có list đệ quy, chưa có event tiến độ xoá.
- `GetListObject` dùng `ListObjectsV2` với Delimiter "/" (folder = CommonPrefixes). Folder item chỉ là `ObjectItem{Key: "a/b/", IsFolder: true}`.

Upload:
- Luồng: `main.go` bật EnableFileDrop -> `handleDrop` -> `dropFiles` -> `expandDropped(paths, maxUploadFiles)` -> event `uploader:files-dropped` (`FilesDroppedOutput{Files, Truncated, Skipped, MaxFiles, LargeFileSize}`) -> `ObjectListView.onFilesDropped` -> (`UploadLimitModal` nếu `truncated` hoặc có file lớn) -> `UploadObject` -> `uploadObject`.
- Giới hạn hiện tại (đã xác minh trong code): `maxUploadFiles = 5` (cho cả một lần thả lẫn một lần gọi `uploadObject`, backend trả `S3E018` nếu vượt), `largeFileSize = 5 << 30` (5 GiB), `uploadFileConcurrency = 5`. Sprint-01 từng ghi 6, nay đã là 5.
- Quy tắc file lớn hiện tại: nếu BẤT KỲ file nào > 5 GiB thì chỉ upload đúng 1 file lớn nhất (`limitToLargest`, cả frontend và backend), cảnh báo `S3W007`.
- Folder thả vào: `walkDropped` đã duyệt đệ quy bằng `filepath.WalkDir` và đã giữ `RelKey = <tên folder>/<đường dẫn tương đối>` cho mọi sub folder. Tức là R2.1 về mặt walk có vẻ đã chạy; điểm chặn thực tế là tổng 5 file/lần thả (walk dừng ngay khi đủ `limit+1` file nên sub folder phía sau bị cắt) và quy tắc file lớn. Chưa xác minh bằng chạy thật.
- Folder rỗng không tạo gì. Symlink/file lỗi được đếm `Skipped` (`S3W006`). Walk dừng ở `maxWalkEntries = 100000`.
- Upload với prefix: `uploadObject` dùng `prefix + RelKey` (`normalizePrefix`, bỏ "/" đầu, thêm "/" cuối), có kiểm tra `RelKey` an toàn (`cleanRelKey`) và đổi tên `uuid_` khi trùng key. Frontend truyền `prefix` của tab hiện tại. Nghĩa là "upload object với prefix" đã được hỗ trợ trong code (chưa xác minh bằng chạy thật trên S3/MinIO).
- Một goroutine pool duy nhất: một `errgroup.Group` limit 5 cho cả lô; `busy` atomic chỉ cho một `uploadObject` chạy cùng lúc trên toàn app. Mỗi file có job riêng (cancel được) và phát event started/progress/finished; `UploaderWindow` hiển thị theo file (không nhóm theo folder).
- `uploadFile` (`submodule_s3_upload.go`): multipart khi file lớn, `maxUploadParts = 10000`, part size tự tăng theo kích thước file nên 10 GB về kỹ thuật không bị chặn bởi S3 (chưa kiểm chứng thực tế, cần xem `uploadPartSize`).

## 1. Tóm tắt yêu cầu
- R1: Xoá prefix và toàn bộ object/sub folder con.
  - R1.1: ObjectItem loại folder mở được menu (nút `...`).
  - R1.2: Menu chỉ có mục Delete.
  - R1.3: Delete xoá folder, mọi object và sub folder bên trong.
- R2: Upload folder gồm mọi sub folder và file bên trong.
  - R2.1: Upload được tất cả sub folder trong folder được thả.
  - R2.2: Có từ 5 file dung lượng 10 GB trở lên thì dừng và hiện modal cảnh báo.
  - R2.3: Hỏi: folder cha và từng sub folder mỗi cái một goroutine upload riêng được không.
  - R2.4: Sub folder nhiều hơn 50 file thì modal cảnh báo chỉ upload 50 file đầu.
  - R2.5: Sub folder có từ 5 file 10 GB trở lên thì modal cảnh báo chỉ upload 5 file có dung lượng từ 10 GB trở xuống.
  - R2.6: Nếu vi phạm cả R2.4 và R2.5 thì hiện chung một modal, hỏi dùng Mantine Accordion được không.
- Mục "Ngoài phạm vi" (4 dòng) trông giống yêu cầu thật, xem Q2.

## 2. Câu hỏi chưa rõ
| # | Câu hỏi | Đề xuất | Trả lời |
|---|---|---|---|
| Q1 | Tiêu đề `requirement.md` ghi "Sprint 01" trong khi thư mục là sprint-02. Gõ nhầm hay cố ý? | Coi là gõ nhầm, sprint này là sprint-02; người dùng sửa tiêu đề (agent không sửa file requirement). | (chờ người dùng) |
| Q2 | Mục "Ngoài phạm vi" có 4 dòng giống yêu cầu thật: (a) giới hạn tối đa 50 file; (b) "có từ 5 file >= 10GB thì dừng, chỉ cho upload 5 file <= 10GB"; (c) nâng dung lượng tối đa 1 file 5GB -> 10GB; (d) kiểm tra upload object với prefix. Chúng có thật sự ngoài phạm vi không? Dòng (a)(b) trùng R2.4/R2.5, dòng (c) quyết định ngưỡng 10 GB của R2.2/R2.5. | (a)(b)(c) hiểu là VÀO phạm vi vì R2.2/2.4/2.5 không làm được nếu thiếu (nếu thật sự ngoài phạm vi thì R2.2/2.4/2.5 mâu thuẫn). (d) Không viết code; tôi trả lời từ code: đã hỗ trợ prefix, ghi trong mục 0 (chưa chạy thử thật). Cần người dùng xác nhận. | (chờ người dùng) |
| Q3 | Ngưỡng và hành vi file lớn. Hiện: file > 5 GiB thì chỉ upload file lớn nhất (1 file). R2.2 nói "từ 5 file >= 10GB thì dừng" (dừng cả lô), R2.5 nói "chỉ cho upload 5 file <= 10GB" (upload một phần), ngưỡng ">=10GB" và "<=10GB" không nhất quán, và 5 GB hiện tại có đổi thành 10 GB hay không (Ngoài phạm vi (c))? | Chọn một hành vi duy nhất, đề xuất: "file lớn" = size > 10 GiB (10 << 30; hỏi 10 GiB hay 10 GB = 1e10). Nếu một lần thả có >= 5 file lớn: hiện modal cảnh báo, KHÔNG dừng cứng, user chọn "Upload bỏ qua file lớn" (upload mọi file còn lại <= ngưỡng, bỏ các file lớn) hoặc Huỷ. Nếu có 1..4 file lớn: upload bình thường. Phải bỏ quy tắc `limitToLargest` (chỉ upload file lớn nhất) vì xung đột. Cần người dùng chốt. | (chờ người dùng) |
| Q4 | "5 file >= 10 GB" đếm trên toàn lần thả hay theo từng sub folder (R2.5 nói "sub folder nhiều file")? | Đếm theo từng nhóm (group, xem Q5) để khớp R2.4/R2.5, hiển thị theo nhóm trong Accordion. | (chờ người dùng) |
| Q5 | "Sub folder" nghĩa là thư mục trực tiếp chứa file (mỗi thư mục là một nhóm, không tính file của thư mục con) hay cây con tính từ folder gốc được thả? | Nhóm = thư mục trực tiếp chứa file (RelKey bỏ phần tên file). File lẻ thả vào thuộc nhóm gốc "(root)". | (chờ người dùng) |
| Q6 | Giới hạn 50 file áp dụng theo từng sub folder (mỗi folder tối đa 50) hay tổng cả lần thả? Hiện tại là TỔNG 5 file/lần thả, cái này có bị thay bằng 50 hay chỉ còn 50/sub folder? Giới hạn 5 file tổng (`maxUploadFiles`, `S3E018`) có bị bỏ không? Tổng cả lần thả có trần không (vd. 1000 file)? | 50 file đầu tiên mỗi sub folder (R2.4 nói "sub folder"); bỏ giới hạn 5 file tổng; thêm trần tổng cả lần thả để bảo vệ UI/memory (đề xuất 1000 file, người dùng chốt) hoặc giữ `maxWalkEntries`. "50 đầu tiên" theo thứ tự nào: lexical của WalkDir (hiện tại)? | (chờ người dùng) |
| Q7 | R2.3 (goroutine riêng cho folder cha/sub folder): hiện có 1 errgroup limit 5 cho toàn lô, mỗi file một goroutine. Mục đích muốn đạt là gì (nhanh hơn, tách tiến độ theo folder, cô lập lỗi)? | Khả thi về kỹ thuật (mỗi nhóm một goroutine điều phối). Nhưng nếu mỗi nhóm có pool riêng limit 5 thì N nhóm x 5 file x 4 part song song = rất nhiều kết nối/RAM (part buffer) và không nhanh hơn do băng thông. Đề xuất: mỗi nhóm một goroutine điều phối (tách kết quả/lỗi theo nhóm) nhưng dùng MỘT semaphore/limit chung (giữ 5 file đồng thời, hoặc hỏi nâng). Không đổi UploaderWindow. | (chờ người dùng) |
| Q8 | Modal gộp (R2.6): dùng Mantine `Accordion` được (đã có Mantine 9). Cấu trúc đề xuất: mỗi mục (vi phạm >50 file, vi phạm file lớn) là một Accordion.Item, bên trong liệt kê theo sub folder (tên nhóm, số file, số file bị bỏ, danh sách file lớn). Nút "Upload phần hợp lệ" / "Huỷ". Có đồng ý, và có cần liệt kê từng file không (danh sách có thể rất dài, phải virtualize hoặc giới hạn hiển thị)? | Accordion theo nhóm vi phạm; hiển thị tên + dung lượng file lớn, với phần ">50 file" chỉ hiện số lượng bị bỏ, không liệt kê từng file. | (chờ người dùng) |
| Q9 | R1: xoá prefix có cần modal xác nhận không? Mức xác nhận nào, vì thao tác không hoàn tác được và có thể xoá hàng nghìn object. | Có. Dùng `ConfirmModal` (`warning`) với mã mới (vd. `C000006`) ghi rõ "xoá folder [x] và TOÀN BỘ nội dung bên trong, không thể hoàn tác". Chỉ một lần xác nhận (xử lý luôn lỗi xác nhận 2 lần ở Mục 0 cho đường folder). | (chờ người dùng) |
| Q10 | Prefix có rất nhiều object (hàng chục nghìn+): xử lý thế nào? | Backend: lặp `ListObjectsV2` (không Delimiter, theo `ContinuationToken`) và `DeleteObjects` theo batch tối đa 1000 key; `errgroup` limit nhỏ; kiểm tra `Errors` trong response từng batch; tăng timeout (hiện 5 phút) hoặc không để timeout cứng cho thao tác này. | (chờ người dùng) |
| Q11 | Bucket bật versioning: xoá prefix chỉ tạo delete marker cho object hiện tại (các version cũ vẫn còn, vẫn tính phí). Có cần xoá cả version/delete marker (`ListObjectVersions`) không? Chưa xác minh MinIO/S3 phía user có bật versioning. | Sprint này chỉ xoá bản hiện tại (hành vi giống DeleteObject đang có); ghi rõ trong modal/tài liệu. Xoá hết version tách sprint sau. | (chờ người dùng) |
| Q12 | MinIO: `DeleteObjects` cần header Content-MD5/checksum; SDK v2 hiện tự thêm checksum, một số provider S3-compatible cũ không hỗ trợ. User dùng MinIO bản nào / provider nào khác? | Dùng DeleteObjects; nếu lỗi `NotImplemented`/`MissingContentMD5` thì fallback DeleteObject từng key. Chưa xác minh được với MinIO của user, cần người dùng thử. | (chờ người dùng) |
| Q13 | Hiển thị tiến độ/kết quả xoá prefix? Hiện xoá trả một message thành công cho MỖI key (`S3S005`), với hàng nghìn object sẽ spam toast. | Một message tổng: "Đã xoá N object trong [prefix]" (mã mới), lỗi gộp "M object lỗi" kèm chi tiết lỗi đầu tiên; trong lúc xoá hiển thị `loading` trên nút `...` (dùng `deletingItems` của tab như đang làm); không thêm event tiến độ trong sprint này. | (chờ người dùng) |
| Q14 | Xoá khi đang upload vào cùng prefix, hoặc xoá prefix đang mở/ancestor của tab khác: có chặn không? | Không chặn ở backend; sau khi xoá thì `onRefresh` list hiện tại. Nếu tab đang đứng sâu trong prefix bị xoá thì danh sách rỗng (chấp nhận). Báo lại nếu cần chặn khi `uploadingTabId !== null`. | (chờ người dùng) |
| Q15 | Prefix gốc (key rỗng) hoặc xoá nhầm: chặn xoá khi key là "" hoặc "/"? | Có, backend từ chối prefix rỗng/"/" (không bao giờ xoá cả bucket). | (chờ người dùng) |
| Q16 | Lưu ý nền tảng: yêu cầu ghi "Windows". Giữ giả định chỉ Windows (`cleanRelKey` cấm `\` và `:`). | Giữ nguyên. | (chờ người dùng) |

## 3. Task backend (go-backend)
Giả định theo đề xuất (Q2 = vào phạm vi, Q3 = ngưỡng 10 GiB + modal cho tuỳ chọn, Q5 = thư mục trực tiếp, Q6 = 50/nhóm + trần tổng, Q7 = một limit chung, Q9..Q15 = đề xuất). Phải chỉnh nếu người dùng trả lời khác.

| # | Task | Yêu cầu | File sửa / tạo | Phụ thuộc |
|---|---|---|---|---|
| B1 | Model xoá prefix: input `DeletePrefixInput{ConnectionId, ProfileName, Bucket, Prefix}`, output nếu cần (số object đã xoá/lỗi). Re-export trong `models/alias.go` | R1.3 | models/bucket/delete_prefix_input.go (tạo); models/bucket/delete_prefix_output.go (tạo, nếu trả body); models/alias.go (sửa) | - |
| B2 | `deletePrefix(ctx, input)`: kiểm tra prefix hợp lệ (không rỗng, kết thúc "/", Q15), lặp `ListObjectsV2` theo `ContinuationToken` + `DeleteObjects` batch <= 1000 key (Quiet), đọc `Errors`, tuân thủ context huỷ (trả `Result=false` im lặng), timeout riêng cho thao tác lớn, gộp kết quả thành message tổng (Q13). Ghi log theo `slog`. Xoá luôn object "marker" có key chính là prefix | R1.3 | internal/modules/bucket/submodule_object_mng.go (sửa) hoặc submodule_prefix_mng.go (tạo mới, theo quy ước `submoduleXxxMng`) | B1 |
| B3 | Public API trong module + handler `DeletePrefix` (handler mỏng, truyền ctx) | R1.3 | internal/modules/bucket/module.go (sửa); internal/handlers/bucket_handler.go (sửa) | B2 |
| B4 | Viết lại luồng mở rộng thả file theo nhóm: `expandDropped` trả danh sách nhóm theo thư mục trực tiếp (`Group{Name/Path, Files, TotalFiles, Kept, ExcessCount}`), giữ tối đa 50 file/nhóm theo thứ tự WalkDir, vẫn duyệt hết (có trần entries) để đếm số file vượt, phát hiện file lớn theo ngưỡng mới (10 GiB), đếm file lớn theo nhóm. Giữ `Skipped`, `isVolumeRoot`, `maxWalkEntries`. Cập nhật `FilesDroppedOutput`/`DroppedFile` (thêm `Groups`, các hằng `MaxFilesPerFolder`, `LargeFileSize`, `LargeFileMaxCount`), giữ field cũ chỉ khi frontend còn cần | R2.1, R2.4, R2.5, R2.6 | internal/modules/bucket/uploader_expand.go (sửa); internal/modules/bucket/submodule_uploader_mng.go (`dropFiles`, hằng số) (sửa); models/bucket/files_dropped_output.go (sửa); models/alias.go (sửa nếu thêm type) | - |
| B5 | `uploadObject`: bỏ giới hạn 5 file tổng (và `S3E018`) thay bằng giới hạn mới (Q6), bỏ `limitToLargest`; kiểm tra lại phía backend (không tin frontend) 50 file/nhóm và quy tắc file lớn theo size đọc từ đĩa; tách theo nhóm, mỗi nhóm một goroutine điều phối nhưng chung một limit (Q7), kết quả ghi theo index, không khoá. `existingKeys` hiện HeadObject cho mọi key trước khi upload: với hàng trăm file là nhiều request, cân nhắc giữ nguyên nhưng giới hạn concurrency | R2.1-R2.5 | internal/modules/bucket/submodule_uploader_mng.go (sửa); internal/modules/bucket/submodule_s3_upload.go (sửa nếu cần); models/bucket/upload_obj_input.go (sửa nếu thêm field nhóm) | B4 |
| B6 | Message code mới + key i18n en/vi/ja: tổng kết xoá prefix thành công/lỗi (vd. `S3S007`, `S3E020`), cảnh báo file bỏ qua do vượt 50/nhóm (vd. `S3W008`), cảnh báo file lớn (sửa/thay `S3W007` đang ghi "5 GiB, chỉ upload file lớn nhất"), cập nhật/loại `S3E018` nếu không còn dùng. Số mã cụ thể chốt khi viết code | R1, R2 | internal/modules/bucket/module.go (sửa); frontend/src/locales/{en,vi,ja}/messages/ipcMessage.json (sửa) | B2, B5 |
| B7 | Cập nhật/ bổ sung unit test hiện có cho phần thay đổi (tests đã tồn tại: `submodule_uploader_mng_test.go`, `uploader_expand_test.go` đang assert `maxUploadFiles`, `largeFileSize`, `TestUploadObject_TooMany`, `limitToLargest`, sẽ hỏng khi đổi hành vi) và test cho `deletePrefix` (phân trang, batch >1000, lỗi từng key, huỷ ngữ cảnh, prefix rỗng) bằng mock S3 interface như đã làm với `s3Uploader` (cần seam tương tự cho client xoá) | R1, R2 | internal/modules/bucket/submodule_uploader_mng_test.go (sửa); internal/modules/bucket/uploader_expand_test.go (sửa); internal/modules/bucket/submodule_object_mng_test.go hoặc tương đương (tạo) | B2, B4, B5 |

Message code mới: có (xem B6)  |  Migration / sqlc: không  |  Cần sinh lại bindings: có (handler `DeletePrefix`, đổi `FilesDroppedOutput`/model)

## 4. Task frontend (react-frontend)
| # | Task | Yêu cầu | File sửa / tạo | Phụ thuộc |
|---|---|---|---|---|
| F1 | `ObjectItem` nhánh folder: thêm `Card.Section` chứa `Menu` (nút `...` dùng `ActionIcon`, chặn lan `onClick` ra thẻ folder bằng `onClickMenuSection`, giống object thường) với đúng một item Delete; `loading` theo `deletingItems`; callback bọc `useCallback`; thêm prop xử lý xoá prefix (vd. `onClickDeletePrefix`) | R1.1, R1.2 | frontend/src/pages/object/components/ObjectItem.tsx (sửa) | B3 (bindings) |
| F2 | `ObjectListView`: thêm `onClickDeleteFolder(prefix)` -> `ConfirmModal` (mã mới, Q9) -> `setDeleting` -> `callIPC(DeletePrefix, ...)` -> `onRefresh`; giữ nguyên bộ lọc key `/` cho download/xoá nhiều mục. Truyền callback xuống `ObjectItem`. Sửa kèm trường hợp xác nhận 2 lần nếu người dùng đồng ý (Q9) | R1.3 | frontend/src/pages/object/components/views/ObjectListView.tsx (sửa) | F1 |
| F3 | Viết lại `UploadLimitModal` thành modal gộp dùng Mantine `Accordion` (cần wrapper trong `components/` nếu quy ước yêu cầu bọc component Mantine): mục "vượt 50 file/sub folder" và mục "file lớn" theo sub folder; nút "Upload phần hợp lệ"/"Huỷ"; danh sách dài phải giới hạn/virtualize | R2.2, R2.4, R2.5, R2.6 | frontend/src/components/modals/UploadLimitModal.tsx (sửa); frontend/src/components/... (Accordion wrapper, tạo nếu cần) | B4 (bindings) |
| F4 | `ObjectListView.onFilesDropped`: dùng payload nhóm mới thay `truncated/maxFiles/largeFileSize/largeFile`; bỏ logic "chỉ upload file lớn nhất"; tính danh sách file hợp lệ (<= 50/nhóm, bỏ file lớn nếu user chọn), hiện modal khi có vi phạm, gọi `UploadObject` với danh sách đã lọc | R2.1-R2.6 | frontend/src/pages/object/components/views/ObjectListView.tsx (sửa) | F3 |
| F5 | i18n en/vi/ja: namespace `uploadLimitModal` (tiêu đề Accordion, mô tả từng vi phạm, nút), `confirmModal` (mã mới xoá folder), `object` (nhãn menu nếu cần); đăng ký trong `resource.ts` cả 3 ngôn ngữ nếu thêm namespace mới | R1, R2 | frontend/src/locales/{en,vi,ja}/components/modals/uploadLimitModal.json (sửa); .../confirmModal.json (sửa); frontend/src/locales/{en,vi,ja}/resource.ts (sửa nếu cần) | F1-F4 |

i18n key mới (en/vi/ja): `confirmModal.C000006` (xác nhận xoá folder, tên tạm); `uploadLimitModal.*` (tiêu đề, tên Accordion item theo vi phạm, nhãn nhóm/số file bỏ qua, nút upload phần hợp lệ); các key `ipcMessage.bucket.*` thuộc B6.

## 5. Thứ tự thực hiện (luôn tuần tự)
1. Backend: B1 -> B2 -> B3 -> B4 -> B5 -> B6 -> B7
2. `go tool wails3 generate bindings -clean=true -ts` (không có sqlc)
3. Frontend: F1 -> F2 -> F3 -> F4 -> F5

Ghi chú: R1 (B1-B3, F1-F2) và R2 (B4-B5, F3-F4) độc lập nhau; nếu muốn giảm rủi ro thì làm R1 trước rồi review, sau đó R2.

## 6. Rủi ro
Sprint có 12 task (B1-B7, F1-F5), gần ngưỡng 10 task: chi phí vòng review cao vì hai tính năng độc lập. Đề xuất tách thành sprint-02a (R1: xoá prefix) và sprint-02b (R2: upload folder) nếu người dùng đồng ý.

| # | Rủi ro | Mức độ | Cách giảm thiểu |
|---|---|---|---|
| 1 | Yêu cầu mâu thuẫn/mơ hồ (R2.2 "dừng" vs R2.5 "upload một phần"; ngưỡng >=10GB vs <=10GB; "Ngoài phạm vi" trùng R2), làm sai hành vi | high | Chốt Q2-Q6 trước khi code; chưa trả lời thì không bắt đầu R2 |
| 2 | Xoá prefix là thao tác phá huỷ, không hoàn tác; lỗi key/prefix (rỗng, "/", prefix cha) có thể xoá nhầm cả bucket/folder | critical | Backend từ chối prefix rỗng/"/" (Q15), yêu cầu kết thúc "/", modal xác nhận ghi rõ tên folder; unit test cho validate prefix |
| 3 | Prefix rất lớn: timeout 5 phút hiện tại, ListObjectsV2 phân trang, DeleteObjects 1000/batch, UI chờ lâu không có tiến độ | high | Phân trang + batch; timeout riêng; huỷ qua context; hiển thị `loading` trên item (Q10, Q13); có thể thêm event tiến độ ở sprint sau |
| 4 | Bucket có versioning: object chỉ bị delete marker, version cũ còn | medium | Ghi rõ trong plan/modal, xoá version tách sprint (Q11) |
| 5 | MinIO/S3-compatible không hỗ trợ `DeleteObjects` hoặc yêu cầu checksum | medium | Fallback DeleteObject từng key; user thử trên MinIO (Q12); chưa xác minh |
| 6 | Mở rộng giới hạn từ 5 lên 50 file/nhóm và nhiều nhóm: số kết nối đồng thời, RAM part buffer (multipart song song 4 part x nhiều file), `existingKeys` gọi HeadObject cho mọi file, event progress nhiều cho `UploaderWindow` | high | Giữ limit đồng thời chung (Q7), trần tổng file (Q6), cân nhắc batch HeadObject; kiểm thử với folder lớn; kiểm tra `UploaderWindow` có virtualize danh sách upload hay không (chưa xác minh) |
| 7 | "Mỗi folder một goroutine" (R2.3) không nhanh hơn nếu băng thông là nút cổ chai; pool riêng từng folder gây quá tải | medium | Chỉ dùng goroutine điều phối theo nhóm + limit chung; làm rõ mục đích (Q7) |
| 8 | Đổi hành vi giới hạn làm hỏng test hiện có (`TestUploadObject_TooMany`, assert `maxUploadFiles`, `largeFileSize`, `limitToLargest`) và payload `FilesDroppedOutput` đổi làm lệch bindings | medium | B7 cập nhật test; sinh lại bindings trước khi làm frontend |
| 9 | Duyệt toàn bộ cây thư mục thả vào để đếm vượt 50 file/nhóm (trước đây dừng sớm ở limit+1) có thể chậm với cây lớn (tối đa `maxWalkEntries` = 100000) | medium | Giữ trần entries, walk chạy trong goroutine sự kiện drop (không chặn UI), có thể hạ trần |
| 10 | Backend phải enforce lại giới hạn (không tin frontend); sai lệch giữa lọc ở frontend và backend gây upload thừa/thiếu | medium | Backend là nguồn sự thật, trả về cấu trúc nhóm đã lọc sẵn để frontend chỉ hiển thị |
| 11 | Xác nhận xoá hiện bị lặp 2 lần cho object thường (`ObjectItem` + `ObjectListView`); thêm folder dễ nhân bản lỗi này | low | Xử lý trong F2 nếu người dùng đồng ý (Q9) |
| 12 | Wails API (`DroppedFiles`, WindowEvent) còn beta; chưa tra lại docs trong lần này vì sprint không đổi API Wails, chỉ đổi payload | low | Chỉ thêm handler/model; nếu cần API Wails mới thì tra https://v3.wails.io/ trước |

## 7. Tiêu chí hoàn thành
- [ ] Item folder trong ObjectListView có nút `...` mở menu chỉ có Delete
- [ ] Delete folder (sau khi xác nhận) xoá mọi object và sub folder bên trong, danh sách được làm mới
- [ ] Backend từ chối prefix rỗng/"/"; xoá được prefix > 1000 object (phân trang + batch)
- [ ] Thả folder nhiều cấp upload đủ mọi sub folder với key đúng `prefix + <tên folder>/<đường dẫn con>`
- [ ] Sub folder > 50 file chỉ upload 50 file đầu, có cảnh báo trong modal
- [ ] Quy tắc file lớn theo kết luận Q3 hoạt động, có cảnh báo trong modal
- [ ] Nếu vi phạm cả hai quy tắc thì cùng một modal dùng Accordion
- [ ] Upload theo nhóm chạy đồng thời đúng thiết kế Q7, không vượt giới hạn concurrency
- [ ] Mọi message code mới có key en/vi/ja; i18n UI mới có đủ 3 ngôn ngữ
- [ ] `go vet ./...`, `go build ./...`, golangci-lint, `go test` đạt; biome, oxlint, tsc đạt
- [ ] Bindings được sinh lại bằng lệnh, không sửa tay

## Quyết định của người dùng (2026-10-26)

Các quyết định dưới đây thay thế mọi giả định "(chờ người dùng)" ở trên.

- **Q1:** tiêu đề "Sprint 01" là gõ nhầm.
- **Q2:** đưa toàn bộ mục "Ngoài phạm vi" vào phạm vi:
  - giới hạn 50 file;
  - quy tắc file lớn;
  - ngưỡng 10 GiB.
  - Việc upload có prefix đã được hỗ trợ sẵn.
- **Q3 (file lớn):**
  - "File lớn" là file có size > 10 GiB (`10 << 30`).
  - Mỗi sub folder được upload **tối đa 4** file lớn. Từ 5 file lớn trở lên là vi phạm.
  - Bỏ `limitToLargest`.
  - Khi vi phạm thì không dừng cứng mà hiện modal cho người dùng chọn file.
- **Chọn file (mới):** chỉ hiện modal khi có vi phạm (>50 file trong một sub folder hoặc ≥5 file lớn).
  - Modal dùng `Accordion` với **2 mục**: vi phạm >50 file và vi phạm file lớn.
  - Trong mỗi mục, liệt kê file theo từng sub folder, mỗi file có checkbox.
  - Mặc định tick sẵn phần hợp lệ: 50 file đầu và tối đa 4 file lớn.
  - Nút Upload bị khoá khi lựa chọn vẫn còn vi phạm. Nút Huỷ thì không upload gì.
  - Danh sách phải virtualize (`@tanstack/react-virtual`).
  - Backend vẫn kiểm tra lại giới hạn, không tin frontend.
- **Q4:** số file lớn đếm theo từng sub folder (nhóm).
- **Q5 (nhóm):** mỗi thư mục (ở bất kỳ độ sâu nào trong cây được thả) **trực tiếp chứa file** là một nhóm.
  - Thư mục rỗng, hoặc chỉ chứa thư mục con, không tạo nhóm.
  - Phải upload đủ mọi sub folder đệ quy.
- **Q6:**
  - Tối đa 50 file mỗi nhóm, theo thứ tự WalkDir.
  - Bỏ giới hạn 5 file tổng.
  - Trần tổng mỗi lần thả là 1000 file.
- **Q7:** mỗi nhóm có một goroutine điều phối, tất cả dùng **một** limit chung.
- **Q8:** Accordion gồm 2 mục như trên.
- **Q9–Q15:** theo đề xuất.
  - Có `ConfirmModal` xác nhận một lần, và sửa lỗi hỏi xác nhận 2 lần.
  - Xoá theo batch 1000 và dùng timeout riêng.
  - Chỉ xoá bản hiện tại.
  - Nếu `DeleteObjects` không được hỗ trợ thì fallback xoá từng key.
  - Trả một message tổng.
  - Không chặn xoá khi đang upload.
  - Chặn prefix rỗng hoặc "/".
- **Mới:** `UploaderWindow` phải virtualize danh sách upload giống `ObjectListView`.
- **Thứ tự triển khai:**
  1. R1 (xoá folder) chạy trọn vòng Go → bindings → FE → verify → review.
  2. Sau đó R2.
