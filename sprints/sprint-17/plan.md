# Plan sprint-17

> Lập ngày 2026-11-09 từ `requirement.md` (R1–R5). Không có task native Rust, không có docs (trừ khi Q1 đổi nhãn dung lượng hiện trong user guide).
> Danh sách issue lấy từ mục "Vấn đề còn lại"/"Chưa làm" của report sprint-01 → 16, rồi đối chiếu với code trên `staging` (`c6a010e`, v1.0.0). Chỉ mục còn trong code mới vào plan; vị trí dòng ghi bên dưới là lúc lập plan, agent code chạy `graphify query` lại trước khi sửa.
> Docs Wails v3 trả 403: sprint không dùng API Wails mới.
> Cập nhật 2026-11-10: đã xác minh R1b và R4b trong code (mục 1), không còn mục "cần xác minh".

## 1. Tóm tắt yêu cầu và bằng chứng còn tồn tại
| Mã | Issue (nguồn) | Bằng chứng trong code |
|---|---|---|
| R1a | Phân trang versions không có chốt khi `IsTruncated=true` + marker `nil` (sprint-13 R5) | `submodule_bucket_delete.go:65-66` chỉ xét `IsTruncated`; nhánh V2 (dòng 88) đã có chốt `token == nil` |
| R1b | `deleted` đếm trùng khi `Errors` không có `VersionId` (sprint-13 R5) | **Đã xác minh**: `batchDeleter.deleteIDs` (`submodule_object_prefix.go:120-131`) ghép lỗi theo `idKey` = `Key+VersionId`; lỗi thiếu `VersionId` không khớp id có version nên id đó bị tính cả `failed` lẫn `deleted` |
| R1c | Fallback V2 báo `S3E061` dù nguyên nhân là version cũ (sprint-13 R5) | `deleteBucketFailed` map `BucketNotEmpty` → `S3E061` (dòng ~260) |
| R2 | Race `CheckUpdate`/`SetUpdateOptions` (sprint-16) | `setBeta`/`setAutoUpdate` (dòng 424, 452) bỏ qua khi `stateChecking`; `check` (dòng 190) dùng giá trị đọc trước khi fetch |
| R3a | `launchOnStartup` tính là chưa lưu sau Apply (sprint-16) | `settingStore.ts:104` giữ `applied.launchOnStartup` cũ nên `draft != applied` |
| R3b | `ExportProfileModal` đóng được khi đang submit (sprint-16) | modal không khoá X/Esc/click ngoài khi `form.submitting` |
| R4a | Drawer chi tiết không reload sau lưu policy (sprint-13) | `TabDetail.tsx:206` `onSaved` chỉ cập nhật badge (`setPolicyMode`), không đụng `detailBucket` |
| R4b | Policy public khác thứ tự statement hiện `custom` (sprint-13) | **Đã xác minh**: `canonicalPolicy` (`submodule_bucket_policy.go:349`) đã sort `Principal`/`Action`/`Resource` nhưng **không** sort mảng `Statement`, nên hai statement đảo thứ tự thì `DeepEqual` sai |
| R4c | `BucketPolicyModal` không có `cancelValue: false` (sprint-13) | `BucketPolicyModal.tsx:25` |
| R5a | FE nhận `http://127.1`, BE từ chối (sprint-11 GĐ3) | `connectSchema.ts:21` dùng `new URL().hostname` (đã chuẩn hoá thành `127.0.0.1`); BE `url.go:25` dùng `net.ParseIP` |
| R5b | Thuật ngữ `C000011` lệch ở ja/zh-TW/vi (sprint-16) | locale `confirmMessage`/`exportProfileModal.json` |
| R5c | `WarningIcon.test.tsx` flaky (sprint-13, 16) | `findByRole('tooltip')` chờ transition Mantine |
| R5d | Nhãn `GB` cho đơn vị 1024³ (sprint-01, 02) | `stringUtils.ts:91-96` |
| R5e | `BucketItem` tự gọi `useTranslation` (sprint-12) | `BucketItem.tsx:44` |

## 2. Câu hỏi đã chốt (2026-11-10)
| # | Câu hỏi | Trả lời |
|---|---|---|
| Q1 | `formatFileSize` chia 1024 nhưng ghi `KB/MB/GB`: giữ hay đổi nhãn? | **Đổi sang `KiB/MiB/GiB`** (F8, mục 4 và D1, mục 5a). |
| Q2 | `launchOnStartup` sau Apply bị tính là chưa lưu: xử lý thế nào? | **A**: Apply ghi luôn `launchOnStartup` vào registry như Save. Bấm Huỷ sau Apply không hoàn tác trường này. |
| Q3 | Đổi `betaUpdate`/`autoUpdate` đúng lúc đang `checking`? | **B**: để check chạy xong; kênh đã đổi thì bỏ kết quả, về `idle` và check lại một lần. |
| Q4 | Đổi `BucketItem` sang pattern `labels`? | **Có**, gộp vào branch R4. |
| Q5 | Fallback V2 gặp `BucketNotEmpty` báo mã gì? | **Mã mới `S3E064`**, đủ key 7 ngôn ngữ. |
| Q6 | Có sinh checklist test tay `manual-test.md`? | **Không**: giữ danh sách test tay trong memory như hiện tại. |

| Q7 | Ảnh docs có nhãn dung lượng (`12-object-search.png`, `31-bucket-create.png`, có thể còn ảnh khác, ×7 ngôn ngữ) lệch nhãn mới: chụp lại và build lại PDF? | **Có**, trong branch `SP-17/size_units`, làm cuối sprint. Không còn câu hỏi mở. |

## 3. Task backend (go-backend)
- **B1 (R1a)** `submodule_bucket_delete.go` nhánh `ListObjectVersions`: nếu `IsTruncated` mà `NextKeyMarker == nil && NextVersionIdMarker == nil`, hoặc marker mới trùng marker cũ, thì trả lỗi (dùng `S3E060` sẵn có — lỗi đọc danh sách) thay vì lặp. Không đổi nhánh V2.
- **B2 (R1b)** `batchDeleter.deleteIDs` (`submodule_object_prefix.go`): lỗi trong `out.Errors` không có `VersionId` thì khớp với **một** id cùng `Key` chưa bị đánh dấu trong lô (không trừ nhiều version cùng key); id đã khớp lỗi không gọi `d.ok`. `batchDeleter` dùng chung cho xoá file/folder (`deleteBatch` gửi id không version): hành vi ở đó phải giữ nguyên.
- **B3 (R1c, Q5)** Trong `deleteBucketFailed`, khi đã chuyển sang V2 (`c.v2`) và `BucketNotEmpty` thì trả mã mới; thêm `var S3E064` ở `module.go`.
- **B4 (R2, Q3=B)** Lưu kênh (`beta`) lúc bắt đầu `check`; sau `fetchRelease`, nếu `m.beta` đã khác thì về `idle` và gọi lại `check` (một lần), không `startDownload`. `setAutoUpdate(false)` khi đang `checking` thì `check` không tự tải. Mọi đọc/ghi `beta`/`autoUpdate` dưới `m.mu`.
- **B5 (R4b)** `canonicalPolicy`: sau khi chuẩn hoá từng statement (code sẵn có), sort mảng `Statement` theo chuỗi `json.Marshal` của từng statement (map Go marshal theo key đã sort nên ổn định). Không đổi phần chuẩn hoá `Principal`/`Action`/`Resource`.
- **B6 (R3a, Q2=A)** Không đổi backend nếu `SaveSettings`/handler riêng cho launch đã có; nếu phải thêm `SetLaunchOnStartup` thì sinh lại bindings bằng skill `wails3-bindings`.
- Sau mỗi branch có Go: `go vet ./...`, `go build ./...`, `go tool golangci-lint run ./...`; **go-tester** test tạm: package `bucket` (`deleteBucket`, `nextDeleteBatch`, `deleteBucketFailed`, `samePolicy`, `canonicalPolicy`, `readPolicyMode`), package `update` (`check`, `setBeta`, `setAutoUpdate`, `-race` nếu có cgo), rồi xoá file test.

## 4. Task frontend (react-frontend)
- **F1 (R3a, Q2=A)** `settingStore.apply`: khi `draft.launchOnStartup` khác `applied` thì gọi backend ghi registry (dùng lại API backend sẵn có nếu có, xem B6), rồi set `applied` = draft; lỗi `STE003` thì theo giá trị backend trả về. Cancel/Bỏ thay đổi sau Apply không revert registry.
- **F2 (R3b)** `ExportProfileModal`: khi `form.submitting` thì `closeOnEscape=false`, `closeOnClickOutside=false`, ẩn/khoá X và disable nút Huỷ (như `DeleteBucketModal`).
- **F3 (R4a)** `TabDetail.tsx` `onSaved`: nếu `detailBucket` của tab đang là bucket vừa lưu thì cập nhật policy mode trong `tabListStore` (action mới `setDetailPolicyMode` hoặc reload drawer qua key) — chọn cách không gọi thêm IPC nếu body trả đủ dữ liệu.
- **F4 (R4c)** `BucketPolicyModal`: thêm `{ cancelValue: false }`; kiểm nơi gọi không phân biệt `null`/`false`.
- **F5 (R5a)** `isSecureIssuerUrl`: lấy host từ chuỗi gốc (trước chuẩn hoá) và chỉ nhận `localhost`, IPv4 `127.x.x.x` đủ 4 phần, `[::1]` — khớp `net.ParseIP` + `IsLoopback`.
- **F6 (R5b)** Sửa câu `C000011` ở `ja`, `zh-TW`, `vi` cho khớp thuật ngữ `exportProfileModal.json`; giữ đủ key/placeholder.
- **F7 (R5e, Q4)** `BucketListView` tạo `labels` một lần (`useMemo`), truyền xuống `BucketItem` (giữ `memo`); bỏ `useTranslation` trong `BucketItem`.
- **F8 (R5d, Q1)** `formatFileSize` (`stringUtils.ts:91`): `KB/MB/GB` → `KiB/MiB/GiB`, cập nhật doc comment. Nơi gọi (kiểm hồi quy): `UpdateProgress`, `DownloaderItem`, `UploaderItem`, `HistoryModal`, `UploadFileList`, `UploadLimitModal`, `ObjectDetailDrawer`. Chuỗi `PFE011` "1 MB" → "1 MiB" ở `ipcMessage.json` cả 7 ngôn ngữ (giới hạn thật là `1 << 20`) và comment ở `internal/modules/profile/module.go:47`.
- Sau mỗi branch FE: biome, oxlint, `tsc --noEmit`, `knip`.

## 5. Test (react-tester / go-tester)
- react-tester: test hồi quy + mới cho `settingStore`, `SettingModal`, `ExportProfileModal`, `TabDetail`, `BucketDetailDrawer`, `BucketPolicyModal`, `connectSchema`, `BucketItem`, `BucketListView` (C1 ≥ 95%, Lines ≥ 95% từng file); chạy toàn bộ `vitest run`, console sạch.
- **R5c** `WarningIcon.test.tsx`: react-tester sửa test (bỏ phụ thuộc transition: `transitionProps={{ duration: 0 }}` qua theme test hoặc assert bằng `getByRole` sau `act`), chạy cả bộ 3 lần liên tiếp không fail. Chỉ sửa file test.

## 5a. Docs (Q1)
- **D1** User guide `docs/user-guide/<lang>/user-guide.md` (7 ngôn ngữ, dòng ~153 bản en): "1 MB" → "1 MiB"; đọc lại từng bản sau khi sửa (memory mục 3).
- **D2 (Q7)** Chạy lại `docs/scripts/shots.mjs` cả 7 ngôn ngữ (MinIO image local `minio/minio:RELEASE.2025-04-22T22-12-26Z`, memory mục 3), khôi phục các ảnh không có nhãn dung lượng để diff gọn, rồi `bun run build:pdf` (sinh lại cả 7 PDF). Không cần thêm khoá `annotations.json` vì không có ảnh mới.

## 6. Branch (tách từ `origin/SP-17/release`)
| Branch | Yêu cầu | Agent |
|---|---|---|
| `SP-17/bucket_delete_fixes` | R1 (B1–B3) | go-backend → wails3-bindings (không đổi model thì chỉ kiểm) → go-tester → react-frontend (nếu có `S3E064`: key 7 ngôn ngữ) |
| `SP-17/update_race` | R2 (B4) | go-backend → go-tester |
| `SP-17/settings_export_fixes` | R3 (B6, F1, F2) | go-backend (nếu cần) → react-frontend → react-tester |
| `SP-17/bucket_policy_ui` | R4 + R5e (B5, F3, F4, F7) | go-backend → go-tester → react-frontend → react-tester |
| `SP-17/misc_cleanup` | R5a–R5c (F5, F6, R5c) | react-frontend → react-tester |
| `SP-17/size_units` | R5d (F8, D1, D2) — làm cuối | react-frontend → react-tester → docs (như sprint-15/16) |

## 7. Thứ tự thực hiện
Tuần tự theo bảng mục 6; mỗi branch: code → test hồi quy → verifier → code-reviewer (tối đa 3 vòng) → git-flow commit/push/PR vào `SP-17/release`. Không chạy hai agent viết code song song.

## 8. Rủi ro
- R1 sửa `batchDeleter`/vòng xoá dùng chung với xoá file/folder (memory mục 3): chỉ đụng nhánh xoá bucket, go-tester phải test lại `deleteBatch(keys)` của xoá object.
- R2 gọi lại `check` trong `check` dễ đệ quy/deadlock: gọi lại sau khi nhả `m.mu`, tối đa 1 lần.
- R3a (Q2=A) ghi registry ở Apply: Cancel sau Apply không revert registry. Nếu user guide mục 10.1 mô tả Apply/Cancel cho trường này thì sửa đủ 7 bản trong branch R3.
- R5d đổi nhãn dung lượng: test hiện có assert chuỗi `KB/MB/GB` sẽ fail. Đây là thay đổi hành vi **đã duyệt** (Q1), react-tester được sửa assert và phải ghi rõ trong report.
- R4b đổi `canonicalPolicy` ảnh hưởng badge (sprint-14) và cache policy: policy trước đây hiện `custom` có thể đổi thành `public` — đây là hành vi mong muốn.
- R5a làm FE chặt hơn: profile cũ đã lưu issuer dạng lạ sẽ bị form báo lỗi khi Edit (BE vốn đã từ chối nên không mất chức năng).
- `frontend/bindings` gitignore: đổi branch phải sinh lại bindings.

## 9. Tiêu chí hoàn thành
- Mọi tiêu chí trong `requirement.md` được tick hoặc ghi rõ lý do bỏ (theo câu trả lời Q1–Q6).
- Go: vet/build/lint sạch, test hồi quy tạm pass và đã xoá; FE: biome/oxlint/tsc/knip sạch, C1 ≥ 95% từng file đã đổi, toàn bộ vitest pass, console sạch.
- Message code mới có đủ key 7 ngôn ngữ.
