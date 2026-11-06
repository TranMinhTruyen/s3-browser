# S3Browser — Memory

> Bộ nhớ giữa các session, được import vào `CLAUDE.md` nên mọi session và subagent đều đọc. Chỉ `orchestrator` ghi, ở B5 của mỗi sprint (xem `CLAUDE.md` mục 10). Tối đa 250 dòng. Không ghi secret, endpoint thật, đường dẫn máy cá nhân. Khi mâu thuẫn với code hoặc `CLAUDE.md` thì code và `CLAUDE.md` đúng.

## 1. Trạng thái hiện tại

- Cập nhật: 2026-11-06.
- Sprint-15 (cập nhật README, user guide, ARCHITECTURE, CHANGELOG 0.1.0, mở rộng `docs/scripts/shots.mjs` chụp ảnh tự động cho bản release v0.1): đã có `sprints/sprint-15/requirement.md`, chưa lập plan; còn câu hỏi mở trong file (thêm 4 ngôn ngữ docs, server mode với Wails v3.1.0, chụp OIDC/LDAP, chụp với AWS).
- Sprint-14 (R1 badge policy type, R3 `CloseButton` dùng chung, R2 auto-update từ GitHub Releases): mọi PR đã merge vào `staging` (#7 R1+R3, #10 R2); #8 đưa sprint-12/13/14 R1-R3 lên `master`. Chưa có `report.md`.
- Release: version hiện `0.0.1-beta.1.1`; có workflow `release.yml` và `pre-release.yml` (pre-release từ `staging`).
- Sprint-13 DONE 2026-11-05 (PR #6); sprint-12 DONE 2026-11-04.
- Repo đã tách khỏi monorepo ngày 2026-11-03 (`TranMinhTruyen/s3-browser`); từ sprint-15 dùng luồng `SP-NN/release` (mục 2).
- 2026-11-06: thêm agent `go-tester` và quy tắc test hồi quy (xem `CLAUDE.md` mục 9).
- Lưu ý: các mục test tay của sprint-13 (bucket khác region, Object Lock/versioning khi xoá, xoá file/folder sau khi sửa `batchDeleter`, tạo bucket public trên AWS) chưa ghi nhận kết quả; gặp lỗi thì mở sprint sửa.
- Việc tiếp theo: làm sprint-15 (`claude --agent orchestrator`, `làm sprint-15`).

## 2. Quyết định

<!-- Cộng dồn. Mẫu: - YYYY-MM-DD [sprint-NN] quyết định — lý do. Quyết định bị thay thế thì xoá dòng cũ, ghi dòng mới. -->

- 2026-11-06 [quy trình] Mỗi sprint có `SP-NN/release` tạo từ `origin/staging`; mỗi yêu cầu một branch `SP-NN/<slug>` tách từ release ngay khi tới lượt (không chờ merge), tự push + PR vào release không hỏi; feature không PR vào `staging` — gom code sprint, chỉ đưa lên staging khi đã test.
- 2026-11-06 [quy trình] Sprint DONE (người dùng báo sau khi test, `sprint-NN DONE`): branch `SP-NN/sprint_docs` PR docs + memory vào release, rồi PR `SP-NN/release` → `staging` để ra bản beta — cần người dùng đồng ý.
- 2026-10-28 [quy trình] Agent không bao giờ merge PR; người dùng tự merge — giữ quyền kiểm soát master.
- 2026-10-27 [quy trình] Commit message và PR bằng tiếng Anh, Conventional Commits — thống nhất lịch sử git.
- 2026-11-06 [testing] Mọi function đã sửa (FE và Go) phải test hồi quy; Go dùng test tạm do `go-tester` viết, chạy xong xoá, không commit `*_test.go`; FE giữ C1 ≥ 95% và chạy toàn bộ vitest — người dùng muốn chặn bug hồi quy nhưng không giữ test Go trong repo (thay quyết định 2026-10-28 bỏ go-tester).
- 2026-10-27 [testing] Test FE đặt trong `frontend/src/test/` theo cây `src/`, import qua `@/` — tách test khỏi code.
- 2026-10-30 [sprint-11] Giữ SQLite cho profile (cột JSON `auth_config`, `auth_secret` mã hoá), không chuyển sang file JSON.
- 2026-11-01 [quy trình] Memory này chỉ orchestrator ghi ở B5, commit trên `SP-NN/sprint_docs` khi sprint DONE — tránh conflict giữa các PR và không chặn `git-flow` tách branch.
- 2026-11-02 [quy trình] Harness chặn subagent ghi `report.md`; orchestrator soạn nội dung, session chính ghi `report.md` + `MEMORY.md` khi người dùng đồng ý.
- 2026-11-02 [sprint-11] OIDC chỉ public client + PKCE; phiên đăng nhập chỉ ở RAM, dùng lại tới min(exp, 10 phút), FE chỉ giữ sessionId — không lưu token.
- 2026-11-02 [sprint-11] URL IdP (issuer, endpoint discovery) chỉ https hoặc http loopback (`utils.IsSecureUrl`) — chặn MITM/scheme lạ khi mở trình duyệt.
- 2026-11-02 [sprint-11] File CA tuỳ chọn cho mọi authType MinIO, chỉ áp transport MinIO; IdP dùng CA của OS.
- 2026-11-02 [sprint-11] STS/LDAP MinIO giữ tự gia hạn (secret trong RAM), Close() không xoá cứng credential — tránh hỏng transfer đang chạy khi ReplaceConn.
- 2026-11-02 [sprint-11] madmin đọc credential qua provider từ SwapCreds — Reauth có hiệu lực ngay.
- 2026-11-02 [quy trình] Môi trường test (`test-env/` ở gốc repo, gồm `test-profiles.txt`) dùng chung cho mọi sprint — chuyển ra khỏi `sprints/sprint-11/` để sprint sau dùng lại tài khoản test.
- 2026-11-02 [sprint-11] Badge/Button variant light truyền màu gốc `var(--mantine-color-<c>-6)`; `-light-color` chỉ cho chữ/viền.
- 2026-11-04 [quy trình] `master` chỉ qua PR staging -> master do người dùng tạo — repo tách khỏi monorepo, master là branch release.
- 2026-11-04 [sprint-12] Sprint dừng đo tay theo nhóm: (R5,R6,R1), (R2,R4,R3), (R7a,R7b), (R8c,R8d,R8e) — người dùng kiểm hiệu năng thủ công trước khi sang nhóm sau.
- 2026-11-04 [sprint-12] Key i18n chỉ xoá khi grep toàn FE không còn dùng, kể cả key động (`authType.*`, `form.button.${mode}`, `confirmCode.*`) — tránh hiện key thô.
- 2026-11-04 [sprint-12] Export chỉ test dùng (knip --production báo) không coi là code chết — CLAUDE.md mục 8.
- 2026-11-04 [sprint-12] Tab là page riêng `pages/tab/TabPage.tsx`, bucket/object nằm dưới `pages/tab/` — tab chứa hai view nên không còn là layout; namespace i18n vẫn tên `tabLayout`.
- 2026-11-04 [sprint-12] Padding 4px chỉ cho layout app (pane MainLayout, header navbar, khung TabPage); item và modal giữ padding riêng — người dùng thử padding 4px toàn app rồi bỏ.
- 2026-11-05 [sprint-13] Bỏ đổi tên bucket (Q1); R1–R6 chung 1 branch `SP-13/bucket_create_policy_detail`, mỗi yêu cầu một commit — người dùng chốt, R4–R6 thêm giữa sprint.
- 2026-11-05 [sprint-13] "Quyền" bucket = bucket policy 3 chế độ: private (xoá policy), public chỉ đọc (GetObject, ListBucket, GetBucketLocation cho `*`), custom JSON; không ACL; Block Public Access chỉ hiển thị + cảnh báo.
- 2026-11-05 [sprint-13] Anonymous: ẩn nút tạo, mục "Quyền truy cập" và "Xoá", backend chặn `S3E054`; vẫn có mục "Chi tiết", `GetBucketDetail` cho anonymous (Q4, Q12).
- 2026-11-05 [sprint-13] Tạo bucket: chỉ AWS thật có region; lỗi chỉ hiện modal error, không retry (Q10); tạo xong `onRefresh()` + `Access.Reset()`.
- 2026-11-05 [sprint-13] Menu `BucketItem` theo mẫu `ObjectItem` (mount khi mở); drawer bucket dùng state riêng `detailBucket` trong `tabListStore`; `DetailRow` dùng chung ở `components/display/`.
- 2026-11-05 [sprint-13] Đếm object ở gốc trong drawer tối đa 10 trang (10.000 mục), chạm giới hạn hiện `10,000+` (Q11).
- 2026-11-05 [sprint-13] Xoá bucket: luôn gõ đúng tên; không rỗng thì xoá mọi version + delete marker rồi `DeleteBucket`; không dùng force-delete MinIO (Q13, Q21); dừng ở lô lỗi đầu tiên, không gọi `DeleteBucket` (Q18); chỉ refresh tab hiện tại (Q17).
- 2026-11-05 [sprint-13] Xoá bucket không rỗng có Object Lock thì chặn hẳn `S3E063`, backend kiểm trước khi xoá object nào (Q14); đọc Object Lock lỗi `NotImplemented` = Disabled, lỗi khác + không rỗng → dừng `S3E060`, rỗng vẫn xoá (Q23).
- 2026-11-05 [sprint-13] Xoá bucket không event tiến trình, không nút Huỷ, modal khoá X/Esc/click ngoài; backend timeout 30 phút (Q15).
- 2026-11-05 [sprint-13] Mục Xoá chỉ ẩn khi chắc bị từ chối `s3:DeleteBucket` (MinIO `AccountInfo`, policy đơn giản, cờ `Bucket.deleteDenied` qua `AccessDelete`); không chắc thì hiện, lỗi thì báo (Q19).
- 2026-11-05 [sprint-13] Đặt quyền khi tạo bucket: backend một call, kiểm JSON trước khi tạo; đặt policy lỗi thì giữ bucket, `Result=true` + `S3W012` (BPA chặn policy public) hoặc `S3W011` (lỗi khác), không rollback (Q24, Q26); AWS retry `NoSuchBucket` 3 lần x 1 giây (Q27).
- 2026-11-05 [sprint-13] Get/put bucket policy dùng region của bucket (`readBucketRegion`) với AWS thật — tránh lỗi 301 với bucket khác region profile (Q33).
- 2026-11-05 [frontend] Toast sonner mặc định tự ẩn sau 10 giây (`duration` ở `<Toaster>` trong `App.tsx`); toast credential sắp hết hạn giữ `Infinity` — người dùng chọn.

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
- 2026-11-05 [sprint-13] Policy Public trên MinIO hiện thành custom — MinIO trả policy đã chuẩn hoá (`Principal {"AWS":["*"]}`, mảng) nên DeepEqual sai — so theo ngữ nghĩa (`samePolicy`/`canonicalPolicy`).
- 2026-11-05 [sprint-13] Panic trong goroutine `errgroup` không được Wails `recover`, crash cả app (vd. `json.Unmarshal("null", &m)` rồi gán vào nil map) — code trong `g.Go` phải không thể panic, kiểm `m == nil`.
- 2026-11-05 [sprint-13] Tạo bucket AWS `us-east-1` lỗi khi profile ở region khác — request đi tới endpoint region profile — AWS thật luôn đặt `o.Region`, chỉ gửi `LocationConstraint` khi khác us-east-1.
- 2026-11-05 [sprint-13] `failCall` luôn trả `Result=false` — không dùng cho bước phụ sau khi đã tạo bucket — tự dựng message Warn, trả `Result=true` (`callIPC` vẫn chạy `resolveAction` + `toast.warning`).
- 2026-11-05 [sprint-13] `isCallCanceled` chỉ bắt `context.Canceled`, `DeadlineExceeded` vẫn trả lỗi — thao tác dài (xoá bucket) hết timeout sẽ báo message, không im lặng.
- 2026-11-05 [sprint-13] `batchDeleter` dùng chung cho xoá file/folder và xoá bucket — sửa dễ đổi hành vi cũ — giữ `deleteBatch(keys)` chuyển sang identifier không version rồi gọi `deleteIDs`; test tay xoá file/folder sau khi sửa.
- 2026-11-05 [test] Dropdown `Menu` Mantine trong jsdom bị `display: none` — truy vấn bằng `{ hidden: true }`; đóng modal có transition nên kiểm unmount bằng `waitFor`.
- 2026-11-05 [test] Component thêm prop bắt buộc làm `tsc` lỗi ở test cũ — react-tester cập nhật helper props (agent code không sửa test).
- 2026-11-05 [test] `WarningIcon.test.tsx` fail khi chạy cả bộ lúc máy tải nặng (`findByRole('tooltip')` quá thời gian), pass khi chạy riêng — nghi flaky, ngoài sprint-13.
- 2026-11-05 [wails] Docs https://v3.wails.io/ trả 403 cho agent — tránh dùng API Wails mới, ghi "chưa xác minh" trong plan.
- 2026-11-05 [quy trình] Orchestrator chạy làm subagent của session chính được (gọi được agent con), nhận B3 do session chính chuyển; dừng do rate limit thì SendMessage để chạy tiếp.

## 4. Tóm tắt cũ

<!-- Khi file vượt 250 dòng: gộp các mục cũ nhất của mục 2 và 3 thành dòng ngắn ở đây (giữ ngày, sprint). -->

- (chưa có)
