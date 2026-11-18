# S3Browser — Memory

> Bộ nhớ giữa các session, được import vào `CLAUDE.md` nên mọi session và subagent đều đọc. Chỉ `orchestrator` ghi, ở B5 của mỗi sprint (xem `CLAUDE.md` mục 10). Tối đa 250 dòng. Không ghi secret, endpoint thật, đường dẫn máy cá nhân. Khi mâu thuẫn với code hoặc `CLAUDE.md` thì code và `CLAUDE.md` đúng.

## 1. Trạng thái hiện tại

- Cập nhật: 2026-11-17.
- Sprint-19 (backend SQLite cho chế độ SQL: Rust `s3b_db.dll` + Go `modules/db` + FE nối): R2 đã commit ở `SP-19/sqlite_native_backend`, PR #43 vào `SP-19/release` chờ người dùng merge (review 3/3 ĐẠT, verifier PASS). R1 `SP-19/db_object_tree` (F5, F6, F7, chỉ FE) CHƯA làm: tách sau khi PR #43 merge. Chưa DONE, chưa version beta. `plan.md` (modified) và `report.md` chỉ vào `SP-19/sprint_docs`. Còn dở mức low: Q6, Q8, B7 (xem `report.md`).
- Chế độ SQL: SQLite chạy qua backend thật; PostgreSQL profile lưu DB app nhưng Connect/cây/dữ liệu vẫn mock.
- Sprint-18 (chế độ SQL chỉ UI: chuyển S3/SQL, profile DB mock trong RAM, tab SQL với editor, Ctrl+Q/F/E, R8 Find/Replace, R10 cỡ giao diện): **DONE** 2026-11-16; PR #36–#40 đã merge vào `SP-18/release` (đỉnh `d90cb6c`). PR `SP-18/sprint_docs` (report, memory, CHANGELOG `[1.1.0-beta.18]` 7 bản, version `1.1.0-beta.18`) vào release và PR `SP-18/release` → `staging` chờ người dùng merge (docs trước, promote sau).
- Sprint-17 (dọn issue low, KiB/MiB/GiB): **DONE** 2026-11-10, đã lên `staging` và `master` (`1.0.1`, #35).
- Chế độ SQL chưa có tài liệu README/user guide.
- Sprint-16 (export/import profile, công tắc cập nhật có hiệu lực ngay): **DONE** 2026-11-09, đã lên `staging`; bản `1.0.0` đã lên `master` (#23). Bản dịch vi/ja/zh-CN/zh-TW/ru/de của sprint-16 và 17 chưa có người bản ngữ duyệt.
- Sprint-15 (tài liệu v0.1: README, user guide + PDF, ARCHITECTURE, CHANGELOG 0.1.0, `shots.mjs` chụp ảnh có ghi chú): **DONE** 2026-11-09, đã lên `staging` (`5570c4d`).
- Sprint-14 (badge policy type, `CloseButton` dùng chung, auto-update từ GitHub Releases): **DONE** 2026-11-06, đã lên `staging`; #8 đưa sprint-12/13/14 R1-R3 lên `master`. Không có `report.md`.
- Release: stable mới nhất `1.0.1`; `SP-18/sprint_docs` đổi `build/config.yml` thành `1.1.0-beta.18`. Chỉ build Windows (bỏ macOS/Linux/iOS ở `cedf08a`); có workflow `release.yml` và `pre-release.yml` (pre-release từ `staging`).
- Sprint-13 DONE 2026-11-05 (PR #6); sprint-12 DONE 2026-11-04.
- Repo đã tách khỏi monorepo ngày 2026-11-03 (`TranMinhTruyen/s3-browser`); từ sprint-15 dùng luồng `SP-NN/release` (mục 2).
- 2026-11-06: thêm agent `go-tester` và quy tắc test hồi quy (xem `CLAUDE.md` mục 4 và 10).
- Chưa test tay: lưu đè file ở hộp thoại lưu native của Windows, `AddFilter`/`AttachToWindow` của `SaveFile()` (docs Wails 403), tốc độ 600.000 vòng PBKDF2 trên máy yếu; các mục test tay của sprint-13 (bucket khác region, Object Lock/versioning khi xoá, xoá file/folder sau khi sửa `batchDeleter`, tạo bucket public trên AWS) chưa ghi nhận kết quả; gặp lỗi thì mở sprint sửa. Sprint-18: nút X tab, viền focus SQL editor, hàng upload, hàng đầu `HistoryModal` ở 3 cỡ; checklist badge F14; test case R8 trong `testcases.md` lệch code, cần `qa-tester` cập nhật.
- Việc tiếp theo: người dùng merge PR #43, rồi làm R1 (`SP-19/db_object_tree`); test tay R2 (chạy app với DLL, 3 cỡ giao diện, NSIS/portable). Sprint-18 đã DONE và lên `staging` (`1.1.0-beta.18`, #42).

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
- 2026-11-06 [docs] Mọi tài liệu (README, CHANGELOG, ARCHITECTURE, user guide + PDF + ảnh) viết đủ 7 ngôn ngữ, tên file theo mã locale app (`README.zh-CN.md`, `docs/user-guide/<mã>/`); viết `en` trước rồi dịch, nhãn UI lấy nguyên văn từ locale app — sprint-15 Q1-B, Q20, Q21. Sprint sau sửa tài liệu phải sửa đủ 7 bản.
- 2026-11-08 [docs] Ảnh docs luôn có ghi chú do `shots.mjs` vẽ (khung theo `boundingBox()`), chuỗi trong `docs/scripts/annotations.json` đủ 7 ngôn ngữ; ảnh mới phải thêm khoá, script tự thoát nếu thiếu; README dùng chung ảnh có ghi chú — sprint-15 Q25–Q27, Q30.
- 2026-11-09 [sprint-16] Export profile: PBKDF2-SHA256 600.000 vòng, salt 16 byte, AES-256-GCM nonce 12 byte (stdlib, không đổi `go.mod`), mật khẩu tối thiểu 8 ký tự (đếm code point), file ghi quyền 0o600, import tối đa 1 MB; định dạng `{"format":"s3browser-profile","version":1,...}` — người dùng chốt, `version` giữ 1 vì chưa phát hành.
- 2026-11-09 [sprint-16] AAD của AES-GCM = JSON `["s3browser-profile", provider, endpoint, authType]`; sửa một trong ba trường thì import báo `PFE014` như sai mật khẩu, sửa name/color vẫn mở được — chặn gắn secret vào profile khác.
- 2026-11-09 [sprint-16] Import không tự kết nối (kể cả `autoConnect`), tên trùng thêm ` (2)`, ` (3)`; đường dẫn file (CA, cert, key, config, credentials) không tồn tại hoặc là đường dẫn mạng/thiết bị bị xoá trống, vẫn nhập và cảnh báo `PFW001` (Q6=A), chỉ một toast `PFW001` thay vì kèm `PFS001`.
- 2026-11-09 [sprint-16] Export không kèm secret mà profile có secret đã lưu thì xác nhận bằng `ConfirmModal` mã `C000011`; tên file gợi ý snake_case ASCII (bảng ở `internal/pkg/cnst/file_name.go`) — người dùng yêu cầu giữa sprint.
- 2026-11-09 [sprint-16] Công tắc `betaUpdate`/`autoUpdate` trong Settings có hiệu lực ngay với updater (không ghi `settings.json`), Apply giữ chúng, Cancel/Bỏ thay đổi revert; đóng modal khi còn thay đổi chưa lưu thì hiện cảnh báo 3 nút; Cancel ở footer không cảnh báo — người dùng chốt.
- 2026-11-09 [quy trình] Người dùng có thể commit thẳng lên `SP-NN/release` (sprint-16: `a372dbe`) và cho `git-flow` ngoại lệ mang `requirement.md` (M) và `plan.md` (??) sang branch mới — hai file đó chỉ vào branch `sprint_docs`, không vào branch feature.
- 2026-11-10 [sprint-17] Dung lượng hiển thị nhãn nhị phân KiB/MiB/GiB (giá trị vẫn chia 1024; ru dùng КиБ/МиБ/ГиБ), giới hạn import profile ghi 1 MiB — nhãn KB/MB/GB trước đó sai đơn vị (Q1).
- 2026-11-10 [sprint-17] Apply trong Settings ghi luôn `launchOnStartup` vào registry; Huỷ sau Apply không hoàn tác trường này (Q2=A).
- 2026-11-10 [sprint-17] Đổi kênh beta khi đang check update: để check chạy xong, bỏ kết quả kênh cũ, về `idle` rồi check lại đúng một lần (Q3=B); fallback V2 xoá bucket gặp `BucketNotEmpty` báo `S3E064` (Q5).
- 2026-11-10 [docs] CHANGELOG: mỗi bản beta có mục `## [n.n.n-beta.N] - ngày` riêng (7 bản), mục Known issues của bản cũ giữ nguyên làm lịch sử — người dùng chọn khi đóng sprint-17.
- 2026-11-16 [sprint-18] R8 Find/Replace chốt theo code: ô Replace luôn hiện, 3 nút match case/whole word/regex, không footer Cancel, Ctrl/Cmd+E/Q bị chặn trong ô Find (#39); Q33=A giữ toast 14px ở medium — người dùng chốt khi review bản release, `requirement.md`/`plan.md` đã sửa theo code (#40).
- 2026-11-16 [sprint-18] Cỡ giao diện small/medium/large = font-size `<html>` 14/16/18px (Slider 3 nấc), kích thước viết bằng rem; quy tắc vào `CLAUDE.md` mục 9 (`d90cb6c`). Badge căn chữ (D41/F14) là việc phụ của R10: `text-box` + `will-change`, `.snap` chỉ ở DPR 1 và 1.5 vì ở 1.25 xấu hơn.
- 2026-11-17 [sprint-19] Backend DB: Rust sqlx 0.9 + tokio + sqlparser, `libsqlite3-sys = "*"` (Cargo.lock ghim), trang kết quả 500 dòng / 16 MiB, BLOB hiện hex đầy đủ, timeout truy vấn 5 phút (DBE015), metadata 30 giây — người dùng chốt Q1–Q12.
- 2026-11-17 [sprint-19] Toolchain Rust `stable` + target msvc không ghim số, cho agent cài Rust/VS Build Tools qua winget; DLL link `crt-static` để không cần VCRUNTIME140.
- 2026-11-17 [sprint-19] Bảng `db_profiles` lưu mọi provider (`provider`, `config` JSON, `secret` mã hoá KeyManager), FE dùng `provider` `sqlite`/`postgres` nhưng giữ key i18n `form.dbType.*`; sửa thẳng migration 000003 vì chưa phát hành; sửa profile để trống mật khẩu thì giữ secret cũ nếu cùng provider, đổi provider thì bỏ (Q13, Q14).
- 2026-11-17 [sprint-19] Profile đang kết nối: khoá ô loại DB/filePath/readOnly kèm gợi ý "ngắt kết nối để sửa", không tự đóng connection (B2=B). Đổi profile của tab thì `CloseDbTab` và `detach` runner.
- 2026-11-17 [quy trình] Sprint-19 chia 2 branch: R2 (backend + FE nối) trước, R1 cây object sau khi người dùng merge PR R2 (Q1=A).

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
- 2026-11-05 [wails] Docs https://v3.wails.io/ trả 403 cho agent — tránh dùng API Wails mới, ghi "chưa xác minh" trong plan.
- 2026-11-05 [quy trình] Orchestrator chạy làm subagent của session chính được (gọi được agent con), nhận B3 do session chính chuyển; dừng do rate limit thì SendMessage để chạy tiếp.
- 2026-11-09 [docs] Server mode không điều khiển được hộp thoại native, kéo thả, đăng nhập OIDC ngoài, updater (bản portable) — `shots.mjs` tiêm event Wails qua `window._wails.dispatchWailsEvent` để có UI thật với dữ liệu giả.
- 2026-11-09 [quy trình] Commit/PR do người dùng tự đưa vào `SP-NN/release` có thể nằm ngoài phạm vi sprint (sprint-15: bump deps trong PR #12, bỏ macOS/Linux + đổi version ở `cedf08a`) — khi đóng sprint so `origin/staging..origin/SP-NN/release` và ghi vào report.
- 2026-11-09 [sprint-16] Đường dẫn UNC (`\\host`, `\\?\`, `\\.\`, `//host`) bị `os.Stat` có thể làm lộ NTLM qua SMB — chỉ `Stat` đường dẫn tương đối hoặc dạng ổ đĩa `X:`; `isUnsafePath` là allowlist, các dạng mạng/thiết bị bị xoá mà không `Stat`.
- 2026-11-09 [sprint-16] Cờ bỏ qua thiếu cert/key khi import quá rộng (đường dẫn vốn rỗng vẫn qua) — chỉ bỏ qua khi `certFile`/`keyFile` vừa bị xoá trống.
- 2026-11-09 [sprint-16] Ghép AAD bằng nối chuỗi với `|` mơ hồ — dùng `json.Marshal([]string{...})`.
- 2026-11-09 [sprint-16] Đếm độ dài mật khẩu bằng UTF-16 làm FE lệch backend — FE dùng `[...value].length` (code point).
- 2026-11-09 [test] v8 coverage tính sai nhánh if không có else ở cuối khối async/try (HeaderButtonGroup chỉ 87,5%) — tách hàm đồng bộ riêng.
- 2026-11-09 [test] Test Go package `profile` cần `-tags portable` (KeyManager ghi file `key` cạnh exe test) và không dùng được `-race` (không có cgo); `application.New(application.Options{})` chạy được không cần cửa sổ.
- 2026-11-09 [test] Thỉnh thoảng `ENOENT` trong `node_modules` khi tiến trình khác ghi cùng lúc — chạy lại; `WarningIcon.test.tsx` đôi khi fail khi chạy cả bộ, pass khi chạy riêng.
- 2026-11-09 [git] Branch tách từ `origin/SP-NN/release` có upstream trỏ release — push phải `git push -u origin <branch>`; `frontend/bindings` bị gitignore nên đổi branch xong phải sinh lại bindings (branch R1+R2 không có `SetUpdateOptions` của R4 cho tới khi merge).
- 2026-11-09 [quy trình] `git-flow` chế độ `branch` từ chối khi working tree có thay đổi ngoài `??` dưới `sprints/sprint-NN/` (kể cả `requirement.md` đã track bị sửa) — cần người dùng cho ngoại lệ rõ ràng.
- 2026-11-09 [docs] Sửa câu trong user guide bằng cách thay dòng làm sót câu cũ (ru dòng 167 bị lặp) và vế "kể cả khi tồn tại" đặt sai vị trí ở ja/zh — sau khi sửa 7 bản phải đọc lại từng bản; build PDF `bun run build:pdf` luôn sinh lại cả 7.
- 2026-11-09 [docs] Ảnh chụp: image `quay.io/minio/minio` kéo về bị 401 — dùng image local `minio/minio:RELEASE.2025-04-22T22-12-26Z`; `shots.mjs` không chạy riêng từng ảnh, chạy lại cả 7 ngôn ngữ rồi khôi phục các ảnh không đổi để diff gọn.
- 2026-11-09 [wails] `ChooseImportFile` và hộp thoại lưu/mở file native không chụp được ở server mode — `shots.mjs` giả bằng `page.route` theo method id đọc từ bindings lúc chạy.
- 2026-11-10 [frontend] Sửa field của instance `Bucket` trong store zustand+immer không re-render — immer không draft instance class — gán `new Bucket({...old, field})`.
- 2026-11-10 [update] Huỷ ctx trong check update có thể khôi phục kết quả của kênh cũ — chỉ khôi phục khi `m.beta == beta`.
- 2026-11-10 [test] `WarningIcon` vẫn có thể timeout khi chạy cả bộ dù đã dùng MantineProvider `env="test"`; `ConnectModal.auth`, `ExportProfileModal`, `SettingModal` cũng vậy khi máy tải — chạy lại riêng file. Verifier và code-reviewer chạy vitest song song làm test timeout — chạy tuần tự.
- 2026-11-10 [frontend] FE từng chấp nhận `\` trong authority của issuer URL mà backend từ chối — `isSecureIssuerUrl` phải khớp `utils.IsSecureUrl`.
- 2026-11-10 [docs] Chụp lại ảnh bằng `shots.mjs` làm lệch ghi chú vài pixel và ngày tạo bucket ở ảnh không liên quan — chỉ giữ ảnh có thay đổi thật, khôi phục ảnh khác bằng `git show HEAD:<path>` qua scratchpad (không dùng `git checkout`).
- 2026-11-10 [quy trình] Rate limit API làm orchestrator dừng giữa sprint — SendMessage cho nó chạy tiếp sau giờ reset; nó kiểm lại git/PR trước khi làm tiếp.
- 2026-11-16 [sprint-18] Class CSS không đổi được kích thước `CloseButton` Mantine — Mantine ghi `--cb-size`/`--cb-icon-size` inline khi truyền `size`/`iconSize` — bỏ hai prop đó rồi đặt biến trong class `.x.x`.
- 2026-11-16 [sprint-18] Chữ badge lệch 1px ở small/large — rem ra px lẻ, Chromium làm tròn viền và baseline riêng — `will-change: transform` + làm tròn padding (`badge.module.css`); đo bằng Playwright ở root 14/16/18px.
- 2026-11-16 [git] Tên branch mới trùng branch đã merge (`SP-18/review_fixes`) làm `git-flow` dừng — kiểm `git ls-remote --heads origin 'SP-NN/*'` trước khi đặt tên.
- 2026-11-16 [test] `DbProfileModal.test.tsx`, `ConnectModal.auth.test.tsx` cũng timeout khi chạy cả bộ có coverage lúc máy tải — chạy lại riêng file.
- 2026-11-17 [sprint-19] `cargo` không có trong PATH của agent — thêm `export PATH="$HOME/.cargo/bin:$PATH";` đầu mọi lệnh Rust; task build DLL tên `common:build:dll`.
- 2026-11-17 [sprint-19] DLL Rust phụ thuộc VCRUNTIME140 trên máy không cài VC++ — `.cargo/config.toml` `+crt-static`, kiểm import table.
- 2026-11-17 [sprint-19] `s3b_cancel` huỷ nhầm request mới của cùng connection — registry giữ `running` (id đang chạy) dưới lock, chỉ interrupt khi `running == id`.
- 2026-11-17 [sprint-19] Đổi profile của tab sau `CloseDbTab` làm cuộn kết quả cũ gọi `FetchRows` báo DBE004 — `detach()` ở `useSqlRunner` trước khi `setTabProfile`.
- 2026-11-17 [sprint-19] sqlx 0.9 yêu cầu `AssertSqlSafe` cho SQL động — bọc khi chạy SQL người dùng.
- 2026-11-17 [sprint-19] Máy dev đã áp migration 000003 cũ sai schema sau khi sửa migration — xoá bảng `db_profiles` hoặc `goose down` một bậc.
- 2026-11-17 [sprint-19] `copy:dll` lỗi "file in use" khi app dev đang giữ DLL — tắt app trước khi build.

## 4. Tóm tắt cũ

<!-- Khi file vượt 250 dòng: gộp các mục cũ nhất của mục 2 và 3 thành dòng ngắn ở đây (giữ ngày, sprint). -->

- (chưa có)
