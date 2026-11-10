# Sprint 17: Dọn issue tồn đọng của các sprint trước

## Mục tiêu
Sửa các bug và điểm low còn ghi trong mục "Vấn đề còn lại" / "Chưa làm" của report sprint-01 → sprint-16 mà **vẫn còn trong code** (đã đối chiếu ngày 2026-11-09), để bản sau v1.0.0 sạch nợ kỹ thuật.

Nguồn: `sprints/sprint-NN/report.md` (sprint-14 không có report), `memory/MEMORY.md`. Các mục đã được sửa ở sprint sau (vd. `useAutoLoading` unhandled rejection, `writeJSONAtomic` thiếu `Sync`, `frontend/coverage/` chưa ignore, helper test sai chỗ, backup đặt tên local/UTC, phím Space/Enter kéo tab, toast trước khi `Toaster` mount, `V000003` không dùng) **không** đưa vào sprint này.

## Yêu cầu

### R1: Xoá bucket — vòng phân trang và số liệu
- **Mô tả:** Sửa 3 điểm low của sprint-13 R5 trong `internal/modules/bucket/submodule_bucket_delete.go`.
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** modal xoá bucket (`DeleteBucketModal`)
- **Tiêu chí chấp nhận:**
  - [ ] `ListObjectVersions` trả trang `IsTruncated=true` nhưng `NextKeyMarker` và `NextVersionIdMarker` đều `nil` (hoặc trang rỗng lặp lại) thì dừng vòng lặp ngay, báo lỗi, không chờ hết timeout 30 phút, không gọi `DeleteBucket`.
  - [ ] Số `deleted` không đếm trùng khi server không trả `VersionId` trong `Errors`.
  - [ ] Fallback `ListObjectsV2` (provider không hỗ trợ versions) gặp `BucketNotEmpty` thì báo mã mới `S3E064` (bucket còn version cũ mà provider không cho liệt kê), đủ key 7 ngôn ngữ, thay vì `S3E061`.
  - [ ] Hành vi cũ giữ nguyên: Object Lock chặn `S3E063`, dừng ở lô lỗi đầu tiên, không force-delete MinIO.

### R2: Updater — race `CheckUpdate` / `SetUpdateOptions`
- **Mô tả:** Sprint-16 để lại race nhỏ: đổi công tắc `betaUpdate`/`autoUpdate` đúng lúc đang `check` có thể dùng kênh/cờ cũ.
- **Nền tảng:** Cả hai (chỉ build Windows)
- **Màn hình liên quan:** modal Settings, thông báo cập nhật
- **Tiêu chí chấp nhận:**
  - [ ] Đổi công tắc khi đang `checking`: lần check đang chạy xong thì bỏ kết quả của kênh cũ, về `idle` và check lại một lần theo giá trị mới; không bắt đầu tải bản beta khi beta vừa tắt, không tự tải khi `autoUpdate` vừa tắt.
  - [ ] `go test -race` (test tạm) không báo race ở package `update`.

### R3: Settings và Export profile
- **Mô tả:** Hai điểm còn lại của sprint-16.
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** `SettingModal`, `ExportProfileModal`
- **Tiêu chí chấp nhận:**
  - [ ] Apply ghi luôn `launchOnStartup` vào registry (như Save), nên sau Apply trường này không còn bị tính là "chưa lưu"; Huỷ sau Apply không hoàn tác trường này.
  - [ ] `ExportProfileModal` khi đang submit: X, Esc, click ngoài và nút Huỷ không đóng được modal.

### R4: Bucket policy — drawer và nhận diện chế độ
- **Mô tả:** Điểm low của sprint-13 R1–R4.
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** `BucketPolicyModal`, drawer "Chi tiết" bucket, badge policy
- **Tiêu chí chấp nhận:**
  - [ ] Lưu policy khi drawer "Chi tiết" của cùng bucket đang mở thì drawer tự cập nhật mục policy.
  - [ ] Policy public chỉ đọc có statement/action khác thứ tự vẫn nhận là `public`, không phải `custom` (cả badge lẫn modal).
  - [ ] `BucketPolicyModal` đóng bằng X/Esc trả `false` như các modal khác dùng `cancelValue` (nếu nơi gọi cần).

### R5: Dọn nhỏ frontend / i18n / test
- **Mô tả:** Các điểm low lẻ.
- **Nền tảng:** Cả hai
- **Tiêu chí chấp nhận:**
  - [ ] `isSecureIssuerUrl` (FE) khớp `utils.IsSecureUrl` (BE): `http://127.1` bị từ chối ở cả hai (sprint-11 GĐ3).
  - [ ] Thuật ngữ câu confirm `C000011` đồng nhất với `exportProfileModal.json` ở `ja` (`認証情報`/`シークレット`), `zh-TW` (`金鑰`/`密鑰`), `vi` (Profile/hồ sơ).
  - [ ] `WarningIcon.test.tsx` không còn flaky khi chạy cả bộ `vitest run` lúc máy tải.
  - [ ] Nhãn dung lượng đổi sang `KiB/MiB/GiB` (đúng với phép chia 1024) ở mọi chỗ hiện dung lượng; "1 MB" của `PFE011` và user guide thành "1 MiB", đủ 7 ngôn ngữ.
  - [ ] `BucketItem` dùng pattern `labels` như `ObjectItem` (không tự gọi `useTranslation` mỗi dòng).

## Ngoài phạm vi
- Các mục **test tay** (sprint-11, 13, 16: AWS thật khác region, Object Lock/versioning, ghi đè file trong hộp thoại lưu native, tốc độ PBKDF2 trên máy yếu, MinIO STS/LDAP/OIDC...): người dùng tự chạy; lỗi tìm được sẽ mở sprint sửa.
- Duyệt bản dịch bởi người bản ngữ (zh-CN, zh-TW, ru, de...).
- Đọc BPA cấp account (cần quyền `s3control`), cảnh báo nội dung policy custom: là tính năng mới, không phải issue.
- Đổi lint `revive` var-naming (đổi bindings/json), đổi tên namespace `tabLayout`.
- Cập nhật `CLAUDE.md` (người dùng tự sửa).

## Ràng buộc / ghi chú
- Không đổi hành vi đã chốt trong memory mục 2; mọi function đã sửa phải có test hồi quy (Go tạm, FE C1 ≥ 95%).
- Message code mới (nếu có) phải đủ key 7 ngôn ngữ.

## Câu hỏi đã biết
- Q1–Q6 đã chốt 2026-11-10 (xem `plan.md` mục 2). Không làm checklist test tay riêng (Q6).
- Q7 đã chốt: chụp lại ảnh docs có nhãn dung lượng (7 ngôn ngữ) và build lại PDF. Không còn câu hỏi mở.
