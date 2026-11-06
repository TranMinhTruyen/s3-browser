# Plan sprint-15

> **Trạng thái: ĐÃ DUYỆT** (2026-11-06). Người dùng đã chốt mọi câu hỏi Q1–Q24 (mục 2.1) và đồng ý triển khai.
>
> Sprint chỉ sửa tài liệu và script trong `docs/` cùng `README*`, `CHANGELOG*` ở gốc repo; **không sửa code app** (requirement mục "Ngoài phạm vi"). Vì vậy không có task backend/frontend theo nghĩa code app, các task được ghi ở mục 4 dưới dạng task tài liệu/script (D).
>
> Cập nhật 2026-11-06: người dùng chốt Q1 = **B** (thêm zh-CN, zh-TW, ru, de cho mọi tài liệu của sprint), Q2–Q17 theo đề xuất. Sau đó chốt Q18 = **A**, Q19 = **A** (kèm fallback C), Q20–Q24 theo đề xuất.

## 1. Tóm tắt yêu cầu
Tài liệu viết cho **7 ngôn ngữ** `en`, `vi`, `ja`, `zh-CN`, `zh-TW`, `ru`, `de` (Q1-B), cùng thứ tự với `LANGUAGES` trong `frontend/src/common/cnst/settingConst.ts`.

- R1: Viết lại `README.md`, `README.vi.md`, `README.ja.md` và tạo 4 bản mới (tên file theo Q21): giới thiệu, tính năng sprint-01 → sprint-14, ảnh minh hoạ, tải bản cài từ GitHub Releases (stable/beta), yêu cầu hệ thống, build từ source, link user guide. Bảy bản cùng nội dung (Q24).
- R2: Cập nhật `docs/user-guide/{en,vi,ja}/user-guide.md` và tạo `docs/user-guide/{zh-CN,zh-TW,ru,de}/user-guide.md`: kết nối AWS/MinIO (access key, STS/LDAP, OIDC, file CA), tạo/xoá bucket, bucket policy, drawer chi tiết bucket, badge policy type, upload/download, cài đặt (ngôn ngữ, theme, cập nhật). Mỗi tính năng có ảnh, sinh lại PDF cho 7 ngôn ngữ bằng `bun run --cwd docs build:pdf`.
- R3: Cập nhật `docs/ARCHITECTURE{,.vi,.ja}.md` theo code hiện tại (module, luồng xác thực, auto-update) và tạo 4 bản mới.
- R4: Thêm mục `0.1.0` vào `CHANGELOG{,.vi,.ja}.md` và tạo 4 bản CHANGELOG mới (dịch toàn bộ file, Q23).
- R5: Mở rộng `docs/scripts/shots.mjs` (Playwright, app chạy server mode) cho màn hình từ sprint-08 trở đi; cập nhật `docs/seed/seed.mjs` nếu cần; agent tự chạy để chụp lại toàn bộ ảnh cho **cả 7 ngôn ngữ** (Q19-A; ngôn ngữ lỗi tạm dùng ảnh `en` và ghi report). Profile demo tạo rồi xoá trong script; credential chỉ qua env; màn hình không chụp được thì ghi vào report.

### Hiện trạng đã kiểm trong code (ảnh hưởng trực tiếp tới plan)
- **`shots.mjs` hiện không chạy được với UI hiện tại**, vì đọc nhãn từ file locale theo đường dẫn namespace cũ (trước khi sắp xếp lại ở sprint-12):
  | Trong `shots.mjs` | Đường dẫn hiện tại trong `frontend/src/locales/en/` |
  |---|---|
  | `components/tabLayout` | `pages/tab/tabLayout` |
  | `components/navbar/connectionProfiles` | `components/layouts/navbar/connectionProfiles` |
  | `components/inputs` | `components/inputs/inputs` |
  | `components/objectDetailDrawer` | `pages/tab/objectDetailDrawer` |
  | `pages/object/page` | `pages/tab/object/page` |
  | `components/uploaderWindow` | `components/layouts/transfer/uploaderWindow` |
- Chọn ngôn ngữ: script click `label` EN/VI/JA trên header (dòng 124) và chụp `02-language-switch` từ header, nhưng CHANGELOG `[Unreleased]` ghi công tắc ngôn ngữ đã chuyển vào modal Settings (`settingModal.json` có `label.language`). Bước này phải viết lại.
- `shots.mjs` mặc định `SHOTS_LANGS = 'en,vi,ja'` (dòng 25) và đọc nhãn qua `label(lang, namespace, key)` từ `frontend/src/locales/<lang>/`. Cả 7 thư mục locale đều có `resource.ts` (đã kiểm), tên thư mục trùng mã ngôn ngữ (`zh-CN`, `zh-TW`), nên mở rộng sang 7 ngôn ngữ chỉ là đổi giá trị mặc định, miễn các namespace có đủ key như bản `en` (CLAUDE.md mục 8 bắt buộc; chưa kiểm từng key script dùng).
- Ảnh `20-download-history` không có trong `docs/user-guide/*/images/` (sprint-07 report: bỏ vì modal trống), nhưng script vẫn chụp bước 20. Hiện mỗi ngôn ngữ có 21 ảnh (`01`–`19`, `21`, `22`).
- Wails `v3.1.0` (module cache) có `pkg/application/application_server.go` với `//go:build server` và đọc `WAILS_SERVER_PORT`, `WAILS_SERVER_HOST`. Việc build và chạy được app với `-tags server,production,portable` **chưa xác minh** (planner không chạy lệnh).
- Build `portable` tắt tính năng cập nhật (`update/module.go`: "the feature is off for portable and non-NSIS builds"); `UpdateStateOutput` có trường `supported`, `state`, `version`, `written`, `total`. Event `update:state-changed` (`update/events.go`) dùng được để tiêm trạng thái. FE có hiện mục Update khi nhận event `supported=true` hay không: **chưa xác minh**.
- `test-env/scripts/minio-init.sh` tạo sẵn bucket `anon-public-read`, `anon-public-rw`, `demo-photos`, và chép `hello.txt`, `docs/readme.txt` vào cả ba (lý do chọn MinIO tạm, Q7-B).
- `seed.mjs` ký SigV4 với canonical query string rỗng, nên chưa gọi được API có query như `PUT /<bucket>?policy`.
- Workflow `release.yml`/`pre-release.yml` chỉ đưa lên asset `S3Browser-<v>-windows-amd64-installer.exe` + `checksums.txt` (không có bản portable). Pre-release tạo từ `staging`, release từ `master` (version có `-` thì gắn `--prerelease`).
- Version hiện tại: `build/config.yml` `0.0.1-beta.1.1`; README badge ghi `0.0.1-beta.1`. CHANGELOG mới có `[Unreleased]` (chỉ tới khoảng sprint-08/10) và `[0.0.1-beta.1]`.
- **PDF (ảnh hưởng của Q1-B)**: `docs/scripts/build-pdf.mjs` chỉ có `LANGS = { en, vi, ja }` (tiêu đề mục lục), `FONT_CSS` chỉ gồm `@fontsource/noto-sans` và `@fontsource/noto-sans-jp`, `FOOTER_FONT` cố định `'Noto Sans','Noto Sans JP'`; `docs/theme.css` dòng 21 đặt `font-family: 'Noto Sans', 'Noto Sans JP', sans-serif` cho mọi ngôn ngữ. Với zh-CN/zh-TW, chữ Hán sẽ rơi vào Noto Sans JP nếu không thêm font SC/TC (Q18-A: cài thêm). `docs/package.json` chưa có `@fontsource/noto-sans-sc`/`-tc`. `ru` (Cyrillic) và `de` dùng được Noto Sans nếu gói `@fontsource/noto-sans` có subset cyrillic — **chưa xác minh** (`docs/node_modules` chưa cài trên máy này). `slugify` trong `build-pdf.mjs` dùng `encodeURIComponent` nên heading Cyrillic/Hán vẫn có anchor.
- Không thấy lockfile trong `docs/` (`bun.lock`, `package-lock.json`); `bun add` có thể sinh `docs/bun.lock` (có commit hay bị gitignore: **chưa xác minh**, D11 kiểm và báo).
- Thanh chuyển ngôn ngữ ở dòng 3 của mọi `README*`, `CHANGELOG*`, `docs/ARCHITECTURE*` hiện chỉ có 3 ngôn ngữ; user guide dòng 184 (en/vi/ja) và `README.ja.md` dòng 23, `CHANGELOG.ja.md` dòng 39, `docs/user-guide/ja/user-guide.md` dòng 16 ghi UI chỉ có 3 ngôn ngữ — sai so với app hiện có 7 ngôn ngữ, phải sửa trong mọi bản.
- Ảnh chụp tiếng Trung: app chọn font `"Microsoft YaHei UI"` (zh-CN) và `"Microsoft JhengHei UI"` (zh-TW) theo `getFontFamily`; trên Windows 11 hai font này có sẵn, nên Playwright (Chromium) hiển thị được (chưa chạy thử).
- Kích thước bản `en` hiện tại để ước lượng khối lượng dịch: `README.md` 119 dòng, `CHANGELOG.md` 48 dòng, `docs/ARCHITECTURE.md` 171 dòng, `docs/user-guide/en/user-guide.md` 221 dòng (trước khi mở rộng theo R2/R3).
- Không có agent chuyên viết tài liệu trong `.claude/agents/`.

### Tác động của Q1-B (tổng hợp)
| Hạng mục | en/vi/ja (trước) | Thêm do Q1-B |
|---|---|---|
| README | sửa 3 file | tạo 4 file `README.<lang>.md` + sửa thanh ngôn ngữ ở 3 file cũ |
| User guide | sửa 3 `user-guide.md` | tạo 4 thư mục `docs/user-guide/<lang>/` với `user-guide.md` |
| PDF | sinh lại 3 | sinh mới 4 `S3Browser-user-guide.<lang>.pdf`; sửa `build-pdf.mjs`, `theme.css`, `docs/package.json` (thêm 2 font, Q18-A) |
| Ảnh | ~35 ảnh × 3 (ước lượng: 21 hiện có − `02` cũ + khoảng 14 ảnh mới của D4, D5) | ~35 ảnh × 4 = **~140 PNG mới** (Q19-A) |
| ARCHITECTURE | sửa 3 | tạo 4 `docs/ARCHITECTURE.<lang>.md` |
| CHANGELOG | sửa 3 | tạo 4 `CHANGELOG.<lang>.md` (dịch toàn bộ, Q23-A) |
| Tổng file markdown | 12 sửa | **16 tạo mới** + 12 sửa (thanh ngôn ngữ, câu "3 ngôn ngữ UI") |
| Task | D1–D10 | **D11–D15** (mục 4) — tổng 15 task |

Khối lượng chữ cần viết tăng khoảng 7/3 ≈ 2,3 lần; thời gian chạy `shots` tăng tương ứng vì chụp riêng từng ngôn ngữ.

## 2. Câu hỏi

### 2.1 Đã chốt
| # | Câu hỏi | Đã chốt |
|---|---|---|
| Q1 | Mở rộng tài liệu sang zh-CN, zh-TW, ru, de? | **B**: thêm 4 ngôn ngữ cho **mọi** tài liệu của sprint (README, user guide + PDF + ảnh, ARCHITECTURE, CHANGELOG). |
| Q2 | Server mode với Wails v3.1.0 | **A**: D1 là spike (build `-tags server,production,portable` ra thư mục tạm, chạy `WAILS_SERVER_PORT=8090`, mở bằng Playwright); lỗi thì dừng và báo, không sửa code app; nếu do code app thì mở sprint/sửa nhỏ riêng (C). |
| Q3 | OIDC/LDAP | **A**: chỉ chụp form cấu hình với giá trị giả, không kết nối; bước đăng nhập trên trình duyệt ngoài mô tả bằng chữ. |
| Q4 | Region khi tạo bucket (AWS thật) | **A**: chỉ chụp với MinIO; user guide mô tả trường region bằng chữ. |
| Q5 | "User doc" và "user guide" | **A**: user guide = `docs/user-guide/`, user doc = `docs/ARCHITECTURE*`. |
| Q6 | Sprint-14 đã xong? | **A**: đã DONE 2026-11-06, bắt đầu ngay. Câu hỏi này nên được xoá khỏi requirement (người dùng tự sửa). |
| Q7 | Chụp trên MinIO nào? | **B**: container MinIO tạm, sạch, cổng khác (`docker run` một lần, xoá sau khi chụp; lệnh ghi ở header `shots.mjs`, không thêm file vào `test-env/`). |
| Q8 | Chia branch | **A**: gộp R5 + R2 + R1 một branch; R3, R4 mỗi cái một branch. |
| Q9 | Mục CHANGELOG `0.1.0` | **A**: `## [0.1.0] - Unreleased`, gom `[Unreleased]` hiện tại + sprint-08 → sprint-14; ngày và version bump do người dùng làm khi release. |
| Q10 | Badge version README | **A**: badge động `img.shields.io/github/v/release/TranMinhTruyen/s3-browser?include_prereleases`. |
| Q11 | Agent viết tài liệu/script | **A**: `react-frontend` làm cả script JS lẫn markdown; `code-reviewer` review. |
| Q12 | Kiểm thử | **A**: bỏ `react-tester`, `go-tester`; `verifier` kiểm diff chỉ trong `docs/`, `README*`, `CHANGELOG*`; `node --check` các `.mjs`; mọi link tương đối trỏ tới file có thật; `build:pdf` thành công. |
| Q13 | Đánh số ảnh | **A**: giữ `01`–`22`, `02` đổi thành modal Settings (`02-settings`), bỏ bước 20, ảnh mới đánh số tiếp từ `23`. |
| Q14 | Kiểu xác thực cần chụp | **A**: ảnh danh sách kiểu xác thực + form Access key (`03`), Assume role, MinIO STS, LDAP, OIDC, Client certificate (kèm trường file CA, trạng thái trống); kiểu còn lại mô tả bằng chữ. |
| Q15 | Màn hình cập nhật | **A**: tiêm event `update:state-changed` (`supported: true`, `state` available/downloading/ready), không bấm "Update now"; nếu FE bỏ qua event (chưa xác minh) thì mô tả bằng chữ và ghi vào report. |
| Q16 | Ảnh trong README | **A**: ảnh chính `01` + bảng 4 ảnh (danh sách object, upload, tạo bucket kèm quyền, drawer chi tiết bucket). |
| Q17 | Phần Installation | **A**: tải installer từ GitHub Releases (Latest = stable từ `master`, Pre-release = beta từ `staging`); bản portable chỉ build từ source. |
| Q18 | Cài font Noto Sans SC/TC cho `build:pdf`? | **A**: được phép chạy `bun add -d --cwd docs @fontsource/noto-sans-sc @fontsource/noto-sans-tc` (sửa `docs/package.json`). `ru`/`de` dùng Noto Sans nếu có subset cyrillic (D11 kiểm sau `bun install`; thiếu thì dừng và hỏi). |
| Q19 | Chụp ảnh riêng cho từng ngôn ngữ? | **A**: chụp riêng cả 7 ngôn ngữ (`SHOTS_LANGS` mặc định 7). Ngôn ngữ nào lỗi (gãy selector, thiếu key) thì tạm dùng ảnh `en` cho ngôn ngữ đó và ghi vào report; không sửa locale app. |
| Q20 | Ai dịch, kiểm thuật ngữ thế nào? | **A**: `react-frontend` viết bản `en` trước rồi dịch sang 6 ngôn ngữ; tên nút/menu/trường lấy **nguyên văn** từ `frontend/src/locales/<lang>/`; thuật ngữ theo CLAUDE.md mục 8 (AWS console bản địa hoá; zh-TW 憑證, từ vựng Đài Loan; ru «конечная точка»; "Path style" giữ tiếng Anh trừ `ja`); report ghi rõ "bản dịch do agent, chưa có người bản ngữ duyệt". |
| Q21 | Tên file và nhãn cho 4 ngôn ngữ mới | **A**: theo mã locale của app: `README.<mã>.md`, `CHANGELOG.<mã>.md`, `docs/ARCHITECTURE.<mã>.md`, `docs/user-guide/<mã>/user-guide.md`, `S3Browser-user-guide.<mã>.pdf` (mã `zh-CN`, `zh-TW`, `ru`, `de`); nhãn thanh ngôn ngữ theo `LANGUAGE_LABELS` (English \| Tiếng Việt \| 日本語 \| 简体中文 \| 繁體中文 \| Русский \| Deutsch), cùng thứ tự `LANGUAGES`. |
| Q22 | Đưa 4 ngôn ngữ mới vào branch thế nào? | **A**: giữ 3 branch theo Q8-A, mỗi branch tự làm đủ 7 ngôn ngữ cho tài liệu của mình. |
| Q23 | CHANGELOG bản mới dịch đến đâu? | **A**: dịch toàn bộ file (`[0.1.0]` + `[0.0.1-beta.1]`). |
| Q24 | Nội dung riêng theo vùng cho bản zh/ru? | **A**: không; 7 bản cùng nội dung, chỉ dịch. |

### 2.2 Câu hỏi chưa rõ
| # | Câu hỏi | Đề xuất | Trả lời |
|---|---|---|---|
| - | (không còn) | - | - |

## 3. Task backend (go-backend)
Không có. Sprint không sửa code Go.

Message code mới: không  |  Migration / sqlc: không  |  Cần sinh lại bindings: không

## 4. Task tài liệu và script (docs/) — thay cho task frontend
Agent thực hiện: `react-frontend` (Q11). Không có file nào trong `frontend/src` thay đổi. Ký hiệu `<7>` = `en, vi, ja, zh-CN, zh-TW, ru, de`; `<new4>` = `zh-CN, zh-TW, ru, de`.

| # | Task | Yêu cầu | File sửa / tạo | Phụ thuộc |
|---|---|---|---|---|
| D1 | Spike server mode (Q2): build exe server mode + portable ra thư mục tạm, chạy cổng 8090, Playwright mở được trang. Hỏng thì dừng và báo. Không ghi file vào repo. | R5 | (không sửa file) | - |
| D2 | Sửa nền `shots.mjs` cho UI hiện tại: đổi 6 namespace locale (bảng mục 1), chọn ngôn ngữ qua modal Settings (thay label trên header), `02` → `02-settings` (Q13), bỏ bước 20, cập nhật selector đã đổi (`CloseButton`, ActionIcon `tooltip`/`aria-label`), header hướng dẫn chạy (MinIO tạm theo Q7). Mặc định `SHOTS_LANGS` = `<7>` (Q19-A); kiểm mọi key script đọc đều có trong locale của 7 ngôn ngữ, thiếu thì báo (không sửa locale app). | R5 | `docs/scripts/shots.mjs` (sửa) | D1 |
| D3 | `seed.mjs`: hỗ trợ query string khi ký SigV4 để `PUT /<bucket>?policy`; đặt policy cho bucket demo để badge có đủ loại (ví dụ `demo-photos` public chỉ đọc, `demo-reports` custom, `demo-backups` private). Giữ idempotent, không đụng bucket khác. | R5 | `docs/seed/seed.mjs` (sửa) | - |
| D4 | `shots.mjs` thêm bước bucket: danh sách bucket có badge policy type, drawer chi tiết bucket, modal tạo bucket kèm quyền (tạo thật bucket demo tạm), modal sửa bucket policy (custom JSON), modal xoá bucket (xoá thật bucket vừa tạo, gõ đúng tên). Không để lại bucket. | R5 | `docs/scripts/shots.mjs` (sửa) | D2, D3 |
| D5 | `shots.mjs` thêm bước kết nối và cài đặt: danh sách kiểu xác thực + form theo Q14 (giá trị giả, không kết nối), Settings (theme, ngôn ngữ, cập nhật, kênh beta), trạng thái cập nhật/toast qua tiêm `update:state-changed` (Q15). | R5 | `docs/scripts/shots.mjs` (sửa) | D2 |
| D6 | Chạy `node docs/seed/seed.mjs` + `bun run --cwd docs shots` một lần cho `<7>`, kiểm từng ảnh (không lộ credential, không còn tooltip/toast thừa, không còn dữ liệu ngoài demo, chữ Hán/Cyrillic không bị ô vuông), lập danh sách màn hình/ngôn ngữ không chụp được để đưa vào report. Ngôn ngữ chụp lỗi thì tạm trỏ ảnh `en` và ghi report (Q19). | R5 | `docs/user-guide/<7>/images/*.png` (sinh lại / mới; thư mục `<new4>/images/` tạo mới) | D4, D5 |
| D7 | Cập nhật 3 user guide en/vi/ja: thêm mục kết nối theo kiểu xác thực (STS/LDAP, OIDC, client certificate, file CA), tạo/xoá bucket, bucket policy, drawer chi tiết bucket, badge policy type, Settings (theme, font, ngôn ngữ, tự cập nhật, kênh beta), cập nhật đường dẫn ảnh; sửa câu "UI có 3 ngôn ngữ" (dòng 184, `ja` dòng 16) thành 7 ngôn ngữ. | R2 | `docs/user-guide/{en,vi,ja}/user-guide.md` (sửa) | D6 |
| D8 | Viết lại 3 README en/vi/ja: giới thiệu, tính năng sprint-01 → sprint-14, ảnh (Q16), tải bản cài stable/beta (Q17), yêu cầu hệ thống, build từ source, cấu trúc thư mục (module `update`, `pages/tab`), link user guide/CHANGELOG, badge (Q10); thanh ngôn ngữ 7 mục (Q21); sửa câu "UI 3 ngôn ngữ". | R1 | `README.md`, `README.vi.md`, `README.ja.md` (sửa) | D6 |
| D9 | Cập nhật 3 ARCHITECTURE en/vi/ja theo code: module `update` (GitHub Releases, kênh beta, checksum, tắt cho portable/non-NSIS, event `update:state-changed`), luồng xác thực sprint-11 (các authType, OIDC PKCE + phiên RAM, STS/LDAP tự gia hạn, CA/mTLS, `IsSecureUrl`), bucket policy/access cache, `pages/tab`, ghi nhớ tab, i18n 7 ngôn ngữ; thanh ngôn ngữ 7 mục. | R3 | `docs/ARCHITECTURE.md`, `docs/ARCHITECTURE.vi.md`, `docs/ARCHITECTURE.ja.md` (sửa) | - |
| D10 | Thêm mục `0.1.0` (Q9) cho 3 CHANGELOG en/vi/ja, gom `[Unreleased]` hiện có + sprint-08 → sprint-14 (settings, kéo thả/ghi nhớ tab, xác thực nhiều kiểu, hiệu năng, tạo/xoá/sửa quyền bucket, drawer chi tiết bucket, badge policy, auto-update, 7 ngôn ngữ UI); thanh ngôn ngữ 7 mục. | R4 | `CHANGELOG.md`, `CHANGELOG.vi.md`, `CHANGELOG.ja.md` (sửa) | - |
| D11 | PDF 7 ngôn ngữ: chạy `bun add -d --cwd docs @fontsource/noto-sans-sc @fontsource/noto-sans-tc` (Q18-A); thêm 4 mục vào `LANGS` (tiêu đề mục lục: zh-CN `目录`, zh-TW `目錄`, ru `Содержание`, de `Inhalt`), thêm CSS font SC/TC 400/700 vào `FONT_CSS`, `FOOTER_FONT` theo ngôn ngữ; `theme.css` chọn font theo `:lang(...)` để chữ Hán zh-CN/zh-TW ưu tiên SC/TC, `ja` ưu tiên JP. Kiểm subset cyrillic của Noto Sans sau `bun install` (thiếu thì dừng và hỏi); báo nếu `bun add` sinh lockfile mới. | R2 | `docs/scripts/build-pdf.mjs` (sửa), `docs/theme.css` (sửa), `docs/package.json` (sửa, qua `bun add`) | - |
| D12 | Tạo 4 user guide `<new4>` dịch từ bản `en` của D7 (cùng tập mục, ảnh trong `images/` của từng ngôn ngữ theo Q19), nhãn UI lấy nguyên văn từ locale app (Q20); sinh PDF cho `<7>`. | R2 | `docs/user-guide/<new4>/user-guide.md` (tạo), `docs/user-guide/<7>/S3Browser-user-guide.<lang>.pdf` (sinh) | D6, D7, D11 |
| D13 | Tạo 4 README `<new4>` dịch từ `README.md` của D8, link tới user guide/PDF/CHANGELOG cùng ngôn ngữ. | R1 | `README.zh-CN.md`, `README.zh-TW.md`, `README.ru.md`, `README.de.md` (tạo) | D8, D12 |
| D14 | Tạo 4 ARCHITECTURE `<new4>` dịch từ bản `en` của D9. | R3 | `docs/ARCHITECTURE.<new4>.md` (tạo 4 file) | D9 |
| D15 | Tạo 4 CHANGELOG `<new4>` dịch toàn bộ từ bản `en` của D10 (Q23-A). | R4 | `CHANGELOG.<new4>.md` (tạo 4 file) | D10 |

i18n key mới: không (không sửa locale của app).

Test (theo Q12, không có unit test):
| Task | File cần kiểm | Cách kiểm / case |
|---|---|---|
| D2–D5 | `docs/scripts/shots.mjs` | `node --check`; chạy đủ một lượt cho `<7>` không lỗi selector; profile demo và bucket tạm bị xoá sau khi chạy (kể cả chạy lại lần 2); thiếu env thì thoát với thông báo cũ; `SHOTS_LANGS=en` vẫn chạy được một ngôn ngữ (hành vi cũ) |
| D3 | `docs/seed/seed.mjs` | `node --check`; chạy 2 lần liên tiếp không lỗi (idempotent); badge hiện đúng loại cho từng bucket demo |
| D6 | ảnh `images/*.png` | Mỗi ảnh được user guide/README tham chiếu đều tồn tại ở mọi ngôn ngữ (hoặc trỏ ảnh `en` với ngôn ngữ đã ghi report); không ảnh nào chứa endpoint/key thật; ảnh zh/ru không có ký tự ô vuông |
| D7, D8, D12, D13 | user guide, README | Mọi link tương đối (ảnh, PDF, file khác) trỏ tới file có thật; 7 bản cùng tập mục (so heading `##`/`###`); nhãn UI trùng chữ trong locale cùng ngôn ngữ (lấy mẫu); `bun run --cwd docs build:pdf` ra đủ 7 PDF |
| D11 | `build-pdf.mjs`, `theme.css` | `node --check`; PDF `en`/`vi`/`ja` không đổi bố cục so với trước (hồi quy, xem bằng mắt vài trang); PDF zh-CN/zh-TW dùng font SC/TC, ru/de không thiếu glyph; ngôn ngữ thiếu `user-guide.md` vẫn `[skip]` như cũ |
| D9, D10, D14, D15 | ARCHITECTURE, CHANGELOG | Đối chiếu tên module/event/message với code (grep); 7 bản cùng cấu trúc; thanh ngôn ngữ 7 mục, link đúng |

Hồi quy: không có function app nào bị sửa, nên không cần `go-tester`/`react-tester`. Nơi gọi `shots.mjs`/`build-pdf.mjs`/`seed.mjs`: `docs/package.json` (`shots`, `build:pdf`), `Taskfile.yml` (task `docs:pdf` gọi `build:pdf`; có gọi `shots` hay không: chưa xác minh). Kiểm hồi quy của `build-pdf.mjs` là 3 PDF cũ vẫn sinh đúng.

## 5. Branch
Theo Q8-A và Q22-A (đã chốt):

| Branch | Yêu cầu | Task | Ghi chú |
|---|---|---|---|
| SP-15/user_guide_screenshots | R5, R2, R1 | D1–D8, D11, D12, D13 | Gộp vì R2, R1 dùng ảnh do R5 sinh ra (Q8); làm đủ 7 ngôn ngữ; branch lớn nhất (11 task) |
| SP-15/architecture_docs | R3 | D9, D14 | Độc lập; 7 ngôn ngữ |
| SP-15/changelog_v0_1_0 | R4 | D10, D15 | Độc lập; 7 ngôn ngữ |

## 6. Thứ tự thực hiện (luôn tuần tự, xong branch này mới sang branch sau)
Với từng branch trong bảng trên:
1. Tách branch từ `origin/SP-15/release` (git-flow; release branch tạo một lần đầu sprint từ `origin/staging`)
2. Backend: không có
3. Không sinh bindings/sqlc
4. Task D của branch, luôn viết bản `en` trước rồi mới dịch (Q20). Branch đầu cần chạy Docker, build exe, mở port local (requirement) và cài 2 font (Q18-A, đã được phép) ở D11
5. Verify (theo Q12) → review → commit, push, PR vào `SP-15/release` (git-flow)

## 7. Rủi ro
| # | Rủi ro | Mức độ | Cách giảm thiểu |
|---|---|---|---|
| 1 | Server mode không build/chạy với Wails v3.1.0 hoặc code app hiện tại mà sprint không được sửa code app | high | D1 làm spike trước tiên; hỏng thì dừng, báo người dùng (Q2-C) |
| 2 | `shots.mjs` đã hỏng sẵn (6 namespace cũ, công tắc ngôn ngữ trên header đã bỏ); selector Playwright dễ gãy khi UI đổi | high | D2 sửa nền trước khi thêm bước; luôn lấy nhãn từ file locale; chạy thử từng nhóm bước với `SHOTS_LANGS=en` trước khi chạy `<7>` |
| 3 | **Sprint 15 task (> 10)**, branch đầu 11 task, khối lượng chữ ~2,3 lần (Q1-B): vòng review dài, dễ vượt 3 vòng, 7 bản lệch nội dung | high | Người dùng đã chọn giữ 3 branch (Q22-A); viết `en` trước, chốt `en` rồi mới dịch, reviewer so tập heading giữa 7 bản |
| 4 | Ảnh lộ credential/endpoint thật hoặc dữ liệu ngoài demo — số ảnh tăng lên ~245, kiểm bằng mắt dễ sót | high | Giá trị giả trong form trước khi chụp, MinIO tạm sạch (Q7), kiểm đủ ảnh `en`, các ngôn ngữ khác kiểm lấy mẫu + cùng dữ liệu nhập nên cùng nội dung |
| 5 | Bản dịch zh/ru/de do agent viết, không có người bản ngữ duyệt: sai thuật ngữ, lệch nhãn UI | medium | Nhãn UI lấy nguyên văn từ locale app; thuật ngữ theo CLAUDE.md mục 8; report ghi rõ chưa có người bản ngữ duyệt (Q20-A) |
| 6 | Locale app của 4 ngôn ngữ mới thiếu key mà script đọc, hoặc chữ dài làm vỡ layout ảnh (ru/de) | medium | D2 kiểm key cho `<7>` trước khi chạy; thiếu thì báo (không sửa locale trong sprint này), ngôn ngữ đó tạm dùng ảnh `en` và ghi report (Q19) |
| 7 | `theme.css` đổi font theo `:lang()` có thể làm lệch PDF en/vi/ja | medium | Kiểm hồi quy 3 PDF cũ bằng mắt |
| 8 | Script dừng giữa chừng để lại profile/bucket demo; thời gian chạy `<7>` dài làm tăng khả năng lỗi giữa chừng | medium | Dọn ở đầu mỗi lượt (như `deleteProfile(false)` hiện có) và trong `finally`; chạy lại được từng ngôn ngữ qua `SHOTS_LANGS`; MinIO tạm xoá sau khi chụp |
| 9 | Thao tác tạo/xoá bucket thật trong script trúng bucket khác | medium | Tên bucket tạm cố định có tiền tố demo; xoá qua modal gõ đúng tên; chỉ chạy trên MinIO tạm |
| 10 | Màn hình update không hiện khi tiêm event trên build portable (chưa xác minh) | medium | Q15: fallback mô tả bằng chữ, ghi vào report |
| 11 | Dung lượng repo tăng do ~140 PNG + 4 PDF mới (PDF CJK kèm font nhúng có thể nặng; chưa đo) | low | Chấp nhận (Q19-A); nếu PDF quá lớn thì báo người dùng trước khi commit |
| 12 | Sprint-16 R3 cũng sửa user guide (export/import profile), giờ phải sửa 7 bản | low | Sprint-16 bắt đầu sau khi sprint-15 DONE; ghi vào memory để planner sprint-16 tính 7 ngôn ngữ |
| 13 | Playwright treo khi chạy dưới runtime bun trên Windows (sprint-07 report) | low | Script vẫn gọi qua `node` (`docs/package.json`), máy cần Node |
| 14 | PDF/ảnh nhị phân làm diff PR lớn | low | Chấp nhận; reviewer chỉ kiểm danh sách file ảnh và link |

## 8. Tiêu chí hoàn thành
- [ ] Không có thay đổi nào ngoài `docs/`, `README*`, `CHANGELOG*` (không sửa code app, locale app, version, workflow)
- [ ] Unit test: không áp dụng (Q12)
- [ ] Một lần `bun run --cwd docs shots` chụp đủ ảnh cho R1, R2 ở cả 7 ngôn ngữ (ngôn ngữ lỗi tạm dùng ảnh `en`, ghi report); không để lại profile/bucket demo
- [ ] Credential chỉ qua env, không có trong file hay ảnh
- [ ] Danh sách màn hình/ngôn ngữ không chụp được ở server mode (hộp thoại native chọn file/CA/nơi lưu, kéo thả, đăng nhập OIDC trên trình duyệt ngoài, region AWS, ...) được đưa vào `report.md`
- [ ] 7 user guide có cùng tập mục, kèm ảnh cho mỗi tính năng của R2; 7 PDF sinh bằng `bun run --cwd docs build:pdf`, chữ Hán/Cyrillic hiển thị đúng font
- [ ] 7 README cùng nội dung, tính năng khớp sprint-01 → sprint-14, lệnh cài/build đúng
- [ ] 7 ARCHITECTURE mô tả đúng module, luồng xác thực, auto-update so với code
- [ ] 7 CHANGELOG có mục `0.1.0`, bản mới dịch toàn bộ file
- [ ] Mọi tài liệu có thanh chuyển ngôn ngữ 7 mục; không còn câu "UI 3 ngôn ngữ"
- [ ] Mọi link tương đối trong tài liệu trỏ tới file có thật
- [ ] `report.md` ghi rõ bản dịch zh-CN/zh-TW/ru/de chưa có người bản ngữ duyệt (Q20-A)
