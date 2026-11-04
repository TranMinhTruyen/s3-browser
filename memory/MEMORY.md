# S3Browser — Memory

> Bộ nhớ giữa các session, được import vào `CLAUDE.md` nên mọi session và subagent đều đọc. Chỉ `orchestrator` ghi, ở B5 của mỗi sprint (xem `CLAUDE.md` mục 10). Tối đa 250 dòng. Không ghi secret, endpoint thật, đường dẫn máy cá nhân. Khi mâu thuẫn với code hoặc `CLAUDE.md` thì code và `CLAUDE.md` đúng.

## 1. Trạng thái hiện tại

- Cập nhật: 2026-11-04.
- Sprint gần nhất: sprint-12 (hiệu năng UI, refactor, xoá object theo lô): **DONE** 2026-11-04, mọi PR đã merge vào `staging` (repo cũ #25-#33; repo mới #2-#5).
- Repo đã tách khỏi monorepo ngày 2026-11-03 (`TranMinhTruyen/s3-browser`); sprint branch tách từ `origin/staging`.
- Việc tiếp theo: cập nhật docs ARCHITECTURE và user guide (còn nợ từ sprint-11); sprint mới tạo bằng `/new-sprint`.

## 2. Quyết định

<!-- Cộng dồn. Mẫu: - YYYY-MM-DD [sprint-NN] quyết định — lý do. Quyết định bị thay thế thì xoá dòng cũ, ghi dòng mới. -->

- 2026-10-28 [quy trình] Mỗi yêu cầu một branch `SP-NN/<slug>` và một PR riêng, tách từ `origin/staging` — PR nhỏ, review và merge độc lập.
- 2026-10-28 [quy trình] Agent không bao giờ merge PR; người dùng tự merge — giữ quyền kiểm soát master.
- 2026-10-27 [quy trình] Commit message và PR bằng tiếng Anh, Conventional Commits — thống nhất lịch sử git.
- 2026-10-28 [testing] Backend Go không viết unit test; chỉ frontend, C1 ≥ 95% mỗi file đã đổi — người dùng bỏ go-tester.
- 2026-10-27 [testing] Test FE đặt trong `frontend/src/test/` theo cây `src/`, import qua `@/` — tách test khỏi code.
- 2026-10-30 [sprint-11] Giữ SQLite cho profile (cột JSON `auth_config`, `auth_secret` mã hoá), không chuyển sang file JSON.
- 2026-11-01 [quy trình] Memory này chỉ orchestrator ghi ở B5, commit cùng branch cuối của sprint — tránh conflict giữa các PR và không chặn `git-flow` tách branch.
- 2026-11-02 [quy trình] Harness chặn subagent ghi `report.md`; orchestrator soạn nội dung, session chính ghi `report.md` + `MEMORY.md` khi người dùng đồng ý.
- 2026-11-02 [sprint-11] OIDC chỉ public client + PKCE; phiên đăng nhập chỉ ở RAM, dùng lại tới min(exp, 10 phút), FE chỉ giữ sessionId — không lưu token.
- 2026-11-02 [sprint-11] URL IdP (issuer, endpoint discovery) chỉ https hoặc http loopback (`utils.IsSecureUrl`) — chặn MITM/scheme lạ khi mở trình duyệt.
- 2026-11-02 [sprint-11] File CA tuỳ chọn cho mọi authType MinIO, chỉ áp transport MinIO; IdP dùng CA của OS.
- 2026-11-02 [sprint-11] STS/LDAP MinIO giữ tự gia hạn (secret trong RAM), Close() không xoá cứng credential — tránh hỏng transfer đang chạy khi ReplaceConn.
- 2026-11-02 [sprint-11] madmin đọc credential qua provider từ SwapCreds — Reauth có hiệu lực ngay.
- 2026-11-02 [quy trình] Môi trường test (`test-env/` ở gốc repo, gồm `test-profiles.txt`) dùng chung cho mọi sprint — chuyển ra khỏi `sprints/sprint-11/` để sprint sau dùng lại tài khoản test.
- 2026-11-02 [sprint-11] Badge/Button variant light truyền màu gốc `var(--mantine-color-<c>-6)`; `-light-color` chỉ cho chữ/viền.
- 2026-11-04 [quy trình] Branch sprint tách từ `origin/staging`, `master` chỉ qua PR staging -> master do người dùng tạo — repo tách khỏi monorepo, master là branch release.
- 2026-11-04 [sprint-12] Sprint dừng đo tay theo nhóm: (R5,R6,R1), (R2,R4,R3), (R7a,R7b), (R8c,R8d,R8e) — người dùng kiểm hiệu năng thủ công trước khi sang nhóm sau.
- 2026-11-04 [sprint-12] Key i18n chỉ xoá khi grep toàn FE không còn dùng, kể cả key động (`authType.*`, `form.button.${mode}`, `confirmCode.*`) — tránh hiện key thô.
- 2026-11-04 [sprint-12] Export chỉ test dùng (knip --production báo) không coi là code chết — CLAUDE.md mục 8.
- 2026-11-04 [sprint-12] Tab là page riêng `pages/tab/TabPage.tsx`, bucket/object nằm dưới `pages/tab/` — tab chứa hai view nên không còn là layout; namespace i18n vẫn tên `tabLayout`.
- 2026-11-04 [sprint-12] Padding 4px chỉ cho layout app (pane MainLayout, header navbar, khung TabPage); item và modal giữ padding riêng — người dùng thử padding 4px toàn app rồi bỏ.

## 3. Lỗi và bẫy đã gặp

<!-- Cộng dồn. Mẫu: - YYYY-MM-DD [sprint-NN] triệu chứng — nguyên nhân — cách xử lý. -->

- 2026-10-27 [frontend] `npx biome` chạy sai tool — resolve nhầm sang package `biome@0.3.3` — luôn gọi `node_modules/.bin/biome(.exe)`.
- 2026-10-27 [bindings] `git status` không thấy thay đổi binding — `frontend/bindings` bị gitignore — so sánh bằng snapshot của skill `wails3-bindings`.
- 2026-10-25 [wails] API Wails v3 khác kiến thức có sẵn của model — v3 đổi nhiều so với v2/alpha — luôn tra https://v3.wails.io/ trước khi dùng.
- 2026-11-02 [minio-go] NewSTSCertificateIdentity panic nil pointer — minio-go ghi vào Transport.TLSClientConfig — newHTTPClient luôn đặt `&tls.Config{}`.
- 2026-11-02 [frontend] Nút thứ hai trong ternary bị disabled/loading — React tái dùng instance Button có useAutoLoading — đặt `key` khác nhau.
- 2026-11-02 [frontend] Lần gọi IPC đã huỷ settle muộn ghi đè state mới — thiếu kiểm abort sau await — `if (signal.aborted) return` sau callIPC.
- 2026-11-02 [test] findBy/waitFor treo khi dùng vi.useFakeTimers — chỉ giả setTimeout/clearTimeout/Date và dùng `await act(async () => {})` + getBy.
- 2026-11-02 [test] Set mức module (vd. `relogging`) phải settle hết promise trong afterEach (runtime đã mock toàn cục trong `setup.ts`).
- 2026-11-02 [test-env] MinIO TLS chờ OpenID — phải chạy Keycloak trước, nếu không thì `docker restart s3b-test-minio-tls`.
- 2026-11-02 [wails] Huỷ dialog chọn file hiện toast lỗi trên Windows — Wails trả lỗi "cancelled by user" (sentinel ở package internal) thay vì path rỗng — kiểm tra bằng `utils.IsDialogCancelled`.
- 2026-11-02 [git] Branch SP-11/auth_minio_oidc_cert có upstream trỏ origin/master — push phải ghi rõ `-u origin <branch>`.
- 2026-11-04 [bindings] Bước 4 phần B skill `wails3-bindings` báo nhầm "bindings cũ" — `find -newer frontend/bindings` so với mtime thư mục, mà mtime không đổi khi sinh lại file bên trong — so với file mới nhất trong thư mục bindings.
- 2026-11-04 [test] Báo cáo coverage `text` của vitest ẩn file đạt 100% — chỉ liệt kê file chưa đủ — thêm `--coverage.reporter=json-summary` để lấy số từng file.
- 2026-11-04 [git] Branch tách bằng `git switch -c ... origin/staging` có upstream trỏ origin/staging — push phải ghi rõ `git push -u origin <branch>`.
- 2026-11-04 [quy trình] Subagent bị harness chặn ghi `report.md` và `MEMORY.md` — session chính ghi từ nội dung orchestrator soạn.
- 2026-11-04 [quy trình] Orchestrator không nhận lời đồng ý push/PR do session chính chuyển lại — B6 chạy qua `claude --agent orchestrator` hoặc gọi thẳng `git-flow` publish.
- 2026-11-04 [git] `gh pr create` có thể lỗi HTTP 502 tạm thời — kiểm `gh pr list --head <branch> --state all` rồi mới tạo lại để tránh trùng.
- 2026-11-04 [vite] Ghi đè file bằng `git show > file` khi dev server đang chạy làm Vite cache module rỗng (lỗi "does not provide an export named ...") — ghi ra file tạm rồi move, hoặc touch lại từng file.

## 4. Tóm tắt cũ

<!-- Khi file vượt 250 dòng: gộp các mục cũ nhất của mục 2 và 3 thành dòng ngắn ở đây (giữ ngày, sprint). -->

- (chưa có)
