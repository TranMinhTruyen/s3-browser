## Kết quả sprint-13
- Trạng thái: Hoàn thành (R1–R6), chưa test tay trên MinIO/AWS thật
- Tổng thay đổi 3 commit code: +5909 / -255 dòng (185 lượt file; một số file sửa ở nhiều commit)

### Branch
| Branch | Yêu cầu | Số vòng review | Commit | Trạng thái |
|---|---|---|---|---|
| SP-13/bucket_create_policy_detail | R1, R2, R3, R4 | 2/3 | 9ab7dd2 | Đạt |
| SP-13/bucket_create_policy_detail | R5 | 1/3 | deabc60 | Đạt |
| SP-13/bucket_create_policy_detail | R6 | 1/3 | 862a657 | Đạt |

Một branch, mỗi yêu cầu một commit riêng (người dùng chốt), không amend. Commit docs kèm theo gồm `report.md`, `plan.md`, `requirement.md`, `memory/MEMORY.md` và thay đổi ngoài sprint: toast tự ẩn sau 10 giây (`frontend/src/App.tsx`, `duration={10000}`).

| Commit | Số file | Dòng |
|---|---|---|
| 9ab7dd2 (R1–R4) | 109 | +3984 / -99 |
| deabc60 (R5) | 51 | +1400 / -57 |
| 862a657 (R6) | 25 | +525 / -99 |

### File sửa đổi
| File | +/- |
|---|---|
| **R1–R4 (9ab7dd2)** | |
| `frontend/src/test/pages/tab/components/TabDetail.test.tsx` | +204 / -3 |
| `internal/modules/bucket/module.go` | +79 / -0 |
| `frontend/src/test/pages/tab/bucket/BucketItem.test.tsx` | +79 / -0 |
| `frontend/src/pages/tab/bucket/BucketItem.tsx` | +56 / -5 |
| `frontend/src/test/common/stores/tabListStore.test.ts` | +49 / -0 |
| `frontend/src/test/pages/tab/bucket/BucketListView.test.tsx` | +47 / -0 |
| `frontend/src/pages/tab/components/TabDetail.tsx` | +38 / -3 |
| `internal/handlers/bucket_handler.go` | +29 / -0 |
| `frontend/src/test/pages/tab/components/TabActionBar.test.tsx` | +27 / -0 |
| `frontend/src/common/stores/tabListStore.ts` | +18 / -1 |
| `frontend/src/pages/tab/bucket/BucketListView.tsx` | +16 / -2 |
| `frontend/src/test/common/utils/authUtils.test.ts` | +16 / -1 |
| `frontend/src/test/components/modals/lazyModals.test.ts` | +15 / -1 |
| `frontend/src/pages/tab/components/TabActionBar.tsx` | +12 / -1 |
| `models/alias.go` | +12 / -0 |
| `frontend/src/components/modals/lazyModals.ts` | +8 / -0 |
| `internal/modules/bucket/submodule_bucket_mng.go` | +7 / -1 |
| `frontend/src/pages/tab/components/ObjectDetailDrawer.tsx` | +3 / -39 |
| `frontend/src/common/utils/authUtils.ts` | +3 / -0 |
| `frontend/src/locales/{7 ngôn ngữ}/...` (ipcMessage, validateMessage, common, tabLayout, bucket/page, objectDetailDrawer, resource.ts) | thay đổi nhỏ mỗi file |
| **R5 (deabc60)** | |
| `frontend/src/test/pages/tab/components/TabDetail.test.tsx` | +87 / -0 |
| `frontend/src/test/common/stores/tabListStore.test.ts` | +57 / -0 |
| `internal/modules/bucket/submodule_object_prefix.go` (`batchDeleter` xoá theo VersionId) | +53 / -31 |
| `internal/modules/bucket/module.go` | +40 / -1 |
| `frontend/src/test/pages/tab/bucket/BucketItem.test.tsx` | +27 / -0 |
| `frontend/src/pages/tab/components/TabDetail.tsx` | +19 / -0 |
| `internal/handlers/bucket_handler.go` | +16 / -0 |
| `frontend/src/common/stores/tabListStore.ts` (`removeBucket`) | +16 / -0 |
| `internal/modules/bucket/submodule_bucket_mng.go` (`DeleteDenied`) | +15 / -2 |
| `frontend/src/test/pages/tab/bucket/BucketListView.test.tsx` | +15 / -1 |
| `frontend/src/pages/tab/bucket/BucketItem.tsx` (mục Xoá) | +13 / -2 |
| `frontend/src/test/components/modals/lazyModals.test.ts` | +8 / -1 |
| `models/alias.go` | +6 / -0 |
| `internal/modules/global/access_cache.go` (`AccessDelete`) | +5 / -4 |
| `frontend/src/pages/tab/bucket/BucketListView.tsx` | +4 / -1 |
| `frontend/src/components/modals/lazyModals.ts` | +4 / -0 |
| `models/bucket/list_bucket_output.go` (`DeleteDenied`) | +3 / -0 |
| `frontend/src/locales/{7 ngôn ngữ}/...` (ipcMessage, bucket/page.json, resource.ts) | thay đổi nhỏ mỗi file |
| **R6 (862a657)** | |
| `frontend/src/test/components/modals/bucket/CreateBucketModal.test.tsx` | +118 / -1 |
| `internal/modules/bucket/submodule_bucket_policy.go` (tách `applyBucketPolicy`, region bucket cho get/put policy) | +70 / -25 |
| `internal/modules/bucket/submodule_bucket_edit_mng.go` (`applyPolicyAfterCreate`) | +52 / -1 |
| `frontend/src/components/modals/bucket/CreateBucketModal.tsx` | +32 / -6 |
| `frontend/src/common/utils/bucketUtils.ts` (`PolicyMode`, `validatePolicy`) | +17 / -0 |
| `frontend/src/test/common/utils/bucketUtils.test.ts` | +14 / -1 |
| `internal/modules/bucket/module.go` | +11 / -2 |
| `frontend/src/components/modals/bucket/BucketPolicyModal.tsx` | +10 / -42 |
| `models/bucket/create_bucket_input.go` (`Mode`, `Policy`) | +4 / -0 |
| `frontend/src/locales/{7 ngôn ngữ}/...` (ipcMessage, createBucketModal) | 14 file, thay đổi nhỏ |

### File thêm mới
| File | Số dòng |
|---|---|
| **R1–R4** | |
| `internal/modules/bucket/submodule_bucket_policy.go` | 307 |
| `internal/modules/bucket/submodule_bucket_detail.go` | 297 |
| `internal/modules/bucket/submodule_bucket_edit_mng.go` | 123 |
| `models/bucket/bucket_detail_output.go`, `bucket_policy_output.go`, `put_bucket_policy_input.go`, `create_bucket_input.go`, `bucket_detail_input.go`, `bucket_policy_input.go` | 75 |
| `frontend/src/pages/tab/components/BucketDetailDrawer.tsx` | 215 |
| `frontend/src/components/modals/bucket/BucketPolicyModal.tsx` | 173 |
| `frontend/src/components/modals/bucket/CreateBucketModal.tsx` | 131 |
| `frontend/src/components/display/DetailRow.tsx` | 43 |
| `frontend/src/common/utils/bucketUtils.ts` | 18 |
| `frontend/src/locales/{7 ngôn ngữ}/` `createBucketModal.json`, `bucketPolicyModal.json`, `bucketDetailDrawer.json` | 21 file |
| Test: `BucketDetailDrawer.test.tsx` (378), `BucketPolicyModal.test.tsx` (280), `CreateBucketModal.test.tsx` (218), `DetailRow.test.tsx` (46), `bucketUtils.test.ts` (43), `BucketItem.memo.test.tsx` (30) | 995 |
| **R5** | |
| `internal/modules/bucket/submodule_bucket_delete.go` | 279 |
| `models/bucket/delete_bucket_info_output.go`, `delete_bucket_output.go`, `delete_bucket_input.go` | 29 |
| `frontend/src/components/modals/bucket/DeleteBucketModal.tsx` | 164 |
| `frontend/src/locales/{7 ngôn ngữ}/components/modals/deleteBucketModal.json` | 7 file |
| Test: `DeleteBucketModal.test.tsx` | 330 |
| **R6** | |
| `frontend/src/components/inputs/BucketPolicyInput.tsx` | 51 |
| Test: `BucketPolicyInput.test.tsx` | 83 |

### Đối chiếu yêu cầu
| Yêu cầu | Trạng thái | Ghi chú |
|---|---|---|
| R1 Tạo bucket | Đã làm | Nút `FolderPlus` trên `TabActionBar` (chỉ ở bucketList, ẩn khi anonymous); `CreateBucketModal` validate tên theo quy tắc S3; danh sách tự refresh; AWS thật luôn đặt region, chỉ gửi `LocationConstraint` khi khác `us-east-1`; lỗi hiện modal error, không retry |
| R2 Xem và đổi quyền | Đã làm | `GetBucketPolicy`/`PutBucketPolicy` 3 chế độ private / public chỉ đọc / custom; Block Public Access chỉ hiển thị + cảnh báo; so policy theo ngữ nghĩa (`samePolicy`) để MinIO không nhận nhầm thành custom; từ R6 get/put policy dùng region của bucket (Q33) |
| R3 Phân quyền | Đã làm | Anonymous: ẩn nút tạo, mục "Quyền truy cập" và "Xoá", backend chặn `S3E054`. MinIO có credential: kiểm trước qua `AccountInfo` (`EditDenied`, `DeleteDenied`). AWS: thực hiện rồi báo lỗi rõ ràng |
| R4 Chi tiết bucket | Đã làm | `BucketDetailDrawer` (kể cả anonymous): region, ARN, URL endpoint (copy), policy, BPA, versioning, mã hoá, object lock, tag, số object ở gốc (tối đa 10.000, hiện `10,000+`); mục lỗi hiện `-`; lazy load, huỷ được |
| R5 Xoá bucket | Đã làm | Mục "Xoá" trong menu `BucketItem`, ẩn khi anonymous hoặc `deleteDenied`. Gõ đúng tên mới bật nút Xoá; cảnh báo không rỗng / versioning; không rỗng + Object Lock bị chặn `S3E063` (FE và backend). Đang xoá chỉ hiện "Đang xoá…", không Huỷ, không đóng được. Xoá mọi version + delete marker rồi `DeleteBucket`; dừng ở lô lỗi đầu tiên `S3E062`; chỉ refresh tab hiện tại |
| R6 Đặt quyền khi tạo bucket | Đã làm | `CreateBucketModal` chọn private (mặc định) / public / custom qua `BucketPolicyInput` dùng chung với `BucketPolicyModal`. Backend một call: kiểm JSON trước khi tạo, tạo xong mới đặt policy (AWS retry `NoSuchBucket` 3 lần x 1 giây). Đặt policy lỗi thì giữ bucket, `Result=true` + cảnh báo `S3W012` (BPA chặn policy public) hoặc `S3W011` (lỗi khác). AWS có cảnh báo BPA trong modal |
| Đổi tên bucket (Q1) | Không làm | Người dùng bỏ khỏi sprint |

### Kết quả kiểm tra
- go vet, go build: sạch. golangci-lint: 0 issues.
- biome, oxlint, tsc --noEmit, knip: sạch.
- vitest (lần verify R6): 118 file, 2191 test pass, console sạch.
- Wails bindings: sinh thành công, không còn bindings cũ.
- i18n: 7 ngôn ngữ đủ key và placeholder; mọi mã message trong `module.go` có key.

### Coverage frontend (ngưỡng ≥ 95%)
Số liệu từng file đo ở lần verify R5; lần verify R6 xác nhận mọi file đã đổi (thêm `BucketPolicyInput.tsx`, `CreateBucketModal.tsx`, `BucketPolicyModal.tsx`, `bucketUtils.ts`) đều đạt ngưỡng, không ghi số từng file.

| File | Lines | Branches (C1) |
|---|---|---|
| `common/utils/bucketUtils.ts` | 100% | 100% |
| `common/utils/authUtils.ts` | 100% | 100% |
| `common/stores/tabListStore.ts` | 100% | 100% |
| `components/display/DetailRow.tsx` | 100% | 100% |
| `components/modals/lazyModals.ts` | 100% | 100% |
| `components/modals/bucket/BucketPolicyModal.tsx` | 100% | 100% |
| `components/modals/bucket/CreateBucketModal.tsx` | 100% | 95% (R5) |
| `components/modals/bucket/DeleteBucketModal.tsx` | 100% | 98.18% |
| `pages/tab/bucket/BucketItem.tsx` | 100% | 100% |
| `pages/tab/bucket/BucketListView.tsx` | 100% | 98.13% |
| `pages/tab/components/BucketDetailDrawer.tsx` | 100% | 98.5% |
| `pages/tab/components/ObjectDetailDrawer.tsx` | 100% | 97.22% |
| `pages/tab/components/TabActionBar.tsx` | 100% | 100% |
| `pages/tab/components/TabDetail.tsx` | 100% | 96.42% |

### Vấn đề còn lại
- Chưa test tay trên `test-env/` (MinIO) và AWS thật:
  - bucket ở region khác profile (K11), xem/sửa quyền sau khi sửa Q33;
  - mã lỗi thật của MinIO khi bucket không có Object Lock / tag / encryption (K12), hiện nhận diện theo chuỗi mã lỗi AWS;
  - tạo bucket AWS kèm policy public (BPA mặc định bật, K23) và `NoSuchBucket` ngay sau khi tạo (K26);
  - xoá file, xoá folder, xoá bucket có versioning và Object Lock, provider không có `DeleteObjects` (K16: `batchDeleter` đã mở rộng).
- Mức low, không sửa:
  - R1–R4: `BucketPolicyModal` không có `cancelValue: false`; drawer chi tiết không tự reload sau khi lưu policy; BPA cấp account không đọc được nên 403 hiện `S3E052`; policy custom không có cảnh báo nội dung; policy public khác thứ tự statement hiện `custom`.
  - R5: số `deleted` có thể đếm trùng khi server không trả `VersionId` trong `Errors`; fallback `ListObjectsV2` báo `S3E061` dù nguyên nhân là version cũ; vòng phân trang không có chốt khi server trả trang rỗng + `IsTruncated=true` + marker `nil` (kết thúc bằng timeout, không xoá nhầm).
  - R6: 3 điểm low của code-reviewer, không cần quay vòng.
- Docs Wails https://v3.wails.io/ trả 403; sprint không dùng API Wails mới.
- `WarningIcon.test.tsx` (ngoài sprint) fail vài lần khi máy tải nặng, pass khi chạy riêng và ở các lần verify: nghi flaky.
- Ý tưởng sprint sau: hiện policy type trên từng `BucketItem` (load lười cho dòng đang hiện, cache 5 phút).
