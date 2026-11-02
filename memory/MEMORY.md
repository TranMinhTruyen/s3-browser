# S3Browser — Memory

> Bộ nhớ giữa các session, được import vào `CLAUDE.md` nên mọi session và subagent đều đọc. Chỉ `orchestrator` ghi, ở B5 của mỗi sprint (xem `CLAUDE.md` mục 8). Tối đa 250 dòng. Không ghi secret, endpoint thật, đường dẫn máy cá nhân. Khi mâu thuẫn với code hoặc `CLAUDE.md` thì code và `CLAUDE.md` đúng.

## 1. Trạng thái hiện tại

<!-- Ghi đè mỗi lần cập nhật. Ngắn gọn: sprint gần nhất, branch/PR, việc dở dang, việc tiếp theo. -->

- Cập nhật: 2026-11-01 (khởi tạo thủ công, master @ 01ea768).
- Sprint gần nhất: sprint-11 (nhiều phương thức xác thực khi connect, AWS + MinIO).
  - GĐ1 `SP-11/auth_core` (R1, R2 trừ anonymous, R4): đã xong và commit theo `report.md`; tại 01ea768 chưa thấy được merge vào master.
  - GĐ2 `SP-11/auth_minio_anonymous` (R2 anonymous, R3 STS/LDAP/anonymous, RR1): chưa làm, chỉ tách branch sau khi PR GĐ1 được merge.
  - GĐ3 `SP-11/auth_minio_oidc_cert` (R3 OIDC, mTLS): chưa làm, chờ merge GĐ2.
- Việc tiếp theo: kiểm tra PR GĐ1 đã merge chưa, rồi `làm sprint-11` tiếp GĐ2.

## 2. Quyết định

<!-- Cộng dồn. Mẫu: - YYYY-MM-DD [sprint-NN] quyết định — lý do. Quyết định bị thay thế thì xoá dòng cũ, ghi dòng mới. -->

- 2026-10-28 [quy trình] Mỗi yêu cầu một branch `SP-NN/<slug>` và một PR riêng, tách từ `origin/master` — PR nhỏ, review và merge độc lập.
- 2026-10-28 [quy trình] Agent không bao giờ merge PR; người dùng tự merge — giữ quyền kiểm soát master.
- 2026-10-27 [quy trình] Commit message và PR bằng tiếng Anh, Conventional Commits — thống nhất lịch sử git.
- 2026-10-28 [testing] Backend Go không viết unit test; chỉ frontend, C1 ≥ 95% mỗi file đã đổi — người dùng bỏ go-tester.
- 2026-10-27 [testing] Test FE đặt trong `frontend/src/test/` theo cây `src/`, import qua `@/` — tách test khỏi code.
- 2026-10-30 [sprint-11] Giữ SQLite cho profile (cột JSON `auth_config`, `auth_secret` mã hoá), không chuyển sang file JSON.
- 2026-11-01 [quy trình] Memory này chỉ orchestrator ghi ở B5, commit cùng branch cuối của sprint — tránh conflict giữa các PR và không chặn `git-flow` tách branch.

## 3. Lỗi và bẫy đã gặp

<!-- Cộng dồn. Mẫu: - YYYY-MM-DD [sprint-NN] triệu chứng — nguyên nhân — cách xử lý. -->

- 2026-10-27 [frontend] `npx biome` chạy sai tool — resolve nhầm sang package `biome@0.3.3` — luôn gọi `node_modules/.bin/biome(.exe)`.
- 2026-10-27 [bindings] `git status` không thấy thay đổi binding — `frontend/bindings` bị gitignore — so sánh bằng snapshot của skill `wails3-bindings`.
- 2026-10-25 [wails] API Wails v3 khác kiến thức có sẵn của model — v3 đổi nhiều so với v2/alpha — luôn tra https://v3.wails.io/ trước khi dùng.

## 4. Tóm tắt cũ

<!-- Khi file vượt 250 dòng: gộp các mục cũ nhất của mục 2 và 3 thành dòng ngắn ở đây (giữ ngày, sprint). -->

- (chưa có)
