## Kết quả sprint-18

- Trạng thái: **DONE** (2026-11-16, người dùng báo sau khi test). PR #36–#40 đã merge vào `SP-18/release` (đỉnh `d90cb6c`). PR docs (`SP-18/sprint_docs`: report, memory, CHANGELOG 7 bản, version `1.1.0-beta.18`) và PR `SP-18/release` → `staging` tạo khi đóng sprint, người dùng tự merge (docs trước, rồi promote).
- Tổng thay đổi `origin/staging...origin/SP-18/release`: 728 file, +13094 / -1355 dòng (gồm `graphify-out`, locale, test, evidence xlsx). Không tính `graphify-out`, `sprints`, `frontend/src/test`: 372 file, +4361 / -1001.
- Backend Go chỉ đổi cho R10 (field `size` trong settings): 4 file, +10 / -2. Không có task Rust native.

### Branch / PR vào `SP-18/release`

| PR | Nội dung | Trạng thái |
|---|---|---|
| — (`a3d1486 chore(temp)`) | R0–R9 chế độ SQL (chỉ UI), commit thẳng lên release | Đã có trên release |
| #36 | docs: plan, Q27 và quyết định git | Merged |
| #37 | fix(frontend): hiện vùng chọn trên dòng active của SQL editor (R8) | Merged |
| #38 | feat(frontend): cỡ giao diện, scale bằng rem (R10) | Merged |
| #39 | fix(frontend): sửa các phát hiện review bản release (C1, C2, mục low) | Merged |
| #40 | docs: đồng bộ R8 Find/Replace, Q33 và badge vào plan | Merged |

### Đối chiếu yêu cầu

| Yêu cầu | Trạng thái | Ghi chú |
|---|---|---|
| R0–R7, R9 | Làm xong | Chế độ SQL chỉ UI, profile DB mock trong RAM, lệnh cần backend hiện toast |
| R8 Find/Replace | Làm xong | Chốt theo code 2026-11-16: ô Replace luôn hiện, 3 nút match case / whole word / regex, không footer Cancel, Ctrl/Cmd+E/Q bị chặn trong ô Find; `requirement.md` và `plan.md` đã sửa theo code (#40) |
| R10 Cỡ giao diện | Làm xong | Slider 3 nấc small/medium/large (root 14/16/18px), kích thước viết bằng rem; quy tắc rem / 3 cỡ đã vào `CLAUDE.md` (`d90cb6c`) |
| Q33 | Chốt A | Giữ toast 14px ở medium |
| Badge (D41/F14) | Làm xong | Việc phụ của R10: `badge.module.css` căn chữ HOA theo cap height, làm tròn ở DPR 1 và 1.5 |

### Ngoài phạm vi (người dùng xác nhận cố ý)

- `a3d1486 chore(temp)`: gom code R0–R9 và thay đổi docs/config (`biome.json`, `package.json`, README/ARCHITECTURE, `shots.mjs`, bỏ `BrowserRouter`, `updateStore.ts`, `style.css`).
- Quyền mới trong `.claude/settings.json` (PR #38).
- `requirement.md`, `testcases.md` và evidence xlsx đã lên release trước bước `sprint_docs`.
- `d90cb6c` của người dùng: quy tắc rem / 3 cỡ trong `CLAUDE.md`, `code-reviewer.md`, `react-frontend.md`.

### Vấn đề còn lại

- Chưa test tay ở 3 cỡ small/medium/large: nút X đóng tab, viền focus SQL editor, hàng danh sách upload, hàng đầu `HistoryModal` khi mở; checklist badge F14 (3 cỡ, sáng/tối, danh sách dài, DPR 1/1,25/1,5).
- Test case R8 trong `testcases.md` lệch so với code sau khi chốt R8 theo code; cần người dùng gọi `qa-tester` để cập nhật.
- Bản dịch vi/ja/zh-CN/zh-TW/ru/de của chế độ SQL và CHANGELOG `1.1.0-beta.18` chưa có người bản ngữ duyệt.
- Chế độ SQL chưa có backend (Go `internal/modules/db`, Rust `s3b_db.dll`); README/user guide cho chế độ SQL làm khi có backend.
- Bước đóng sprint chỉ đổi docs và version nên không chạy lại verifier/code-reviewer; lần chạy cuối là ở PR #39 (tsc, biome, oxlint, knip, `vite build` PASS; vitest 3026 test PASS).
