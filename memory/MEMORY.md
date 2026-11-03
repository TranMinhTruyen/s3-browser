# S3Browser — Memory

> Bộ nhớ giữa các session, được import vào `CLAUDE.md` nên mọi session và subagent đều đọc. Chỉ `orchestrator` ghi, ở B5 của mỗi sprint (xem `CLAUDE.md` mục 10). Tối đa 250 dòng. Không ghi secret, endpoint thật, đường dẫn máy cá nhân. Khi mâu thuẫn với code hoặc `CLAUDE.md` thì code và `CLAUDE.md` đúng.

## 1. Trạng thái hiện tại

<!-- Ghi đè mỗi lần cập nhật. Ngắn gọn: sprint gần nhất, branch/PR, việc dở dang, việc tiếp theo. -->

- Cập nhật: 2026-11-02.
- Sprint gần nhất: sprint-11 (nhiều phương thức xác thực, AWS + MinIO).
  - GĐ1 `SP-11/auth_core` (PR #21) và GĐ2 `SP-11/auth_minio_anonymous` (PR #23): đã merge.
  - GĐ3 `SP-11/auth_minio_oidc_cert` (R3 OIDC, mTLS, CA file, dọn Low GĐ2): đã commit local, chưa push.
- 2026-11-02 người dùng chấp nhận test tay GĐ3 (bug phát sinh sửa ở sprint sau).
- Việc tiếp theo: push với `git push -u origin SP-11/auth_minio_oidc_cert` (upstream đang trỏ origin/master) và tạo PR. Sau đó cập nhật docs ARCHITECTURE và user guide.

## 2. Quyết định

<!-- Cộng dồn. Mẫu: - YYYY-MM-DD [sprint-NN] quyết định — lý do. Quyết định bị thay thế thì xoá dòng cũ, ghi dòng mới. -->

- 2026-10-28 [quy trình] Mỗi yêu cầu một branch `SP-NN/<slug>` và một PR riêng, tách từ `origin/master` — PR nhỏ, review và merge độc lập.
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
- 2026-11-02 [quy trình] Môi trường test (`test-env/` ở gốc App/S3Browser, gồm `test-profiles.txt`) dùng chung cho mọi sprint — chuyển ra khỏi `sprints/sprint-11/` để sprint sau dùng lại tài khoản test.
- 2026-11-02 [sprint-11] Badge/Button variant light truyền màu gốc `var(--mantine-color-<c>-6)`; `-light-color` chỉ cho chữ/viền.

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

## 4. Tóm tắt cũ

<!-- Khi file vượt 250 dòng: gộp các mục cũ nhất của mục 2 và 3 thành dòng ngắn ở đây (giữ ngày, sprint). -->

- (chưa có)
