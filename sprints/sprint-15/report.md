## Kết quả sprint-15
- Trạng thái: **DONE** (2026-11-09, người dùng báo). R1–R6 đã nằm trên `SP-15/release`; PR `SP-15/release` → `staging` tạo khi đóng sprint.
- Tổng thay đổi so với `origin/staging` (5 commit): 319 file, +5748 / -1425 dòng (text); trong đó 248 PNG (185 ảnh mới, 3 ảnh xoá) và 7 PDF. Dung lượng sau sprint: ảnh docs ~17 MB, PDF ~16 MB.

### Branch / commit
| Commit | Branch / PR | Yêu cầu | Số file | Dòng |
|---|---|---|---|---|
| f53b870 | commit thẳng lên `SP-15/release` (người dùng tự làm, không qua PR) | R5, R2, R1 | 275 | +2997 / -157 |
| ae5ab12 | `SP-15/annotated_screenshots` (#13) | R6 | 255 | +962 / -61 |
| 52ea579 | `SP-15/changelog_v0_1_0` (#12) | R4 (+ bump dependency) | 11 | +421 / -61 |
| bd9743d | `SP-15/architecture_docs` (#11) | R3 | 7 | +1179 / -131 |
| cedf08a | commit thẳng lên `SP-15/release` (người dùng tự làm) | ngoài phạm vi | 33 | +230 / -1056 |

Branch `SP-15/user_guide_screenshots` trong plan không được dùng; nội dung của nó nằm ở `f53b870`.

### File sửa đổi
| File | +/- |
|---|---|
| `docs/scripts/shots.mjs` | +642 / -66 |
| `docs/user-guide/{en,vi,ja}/user-guide.md` | +160/-21, +160/-21, +159/-20 |
| `docs/ARCHITECTURE{,.vi,.ja}.md` | +76/-24, +105/-53, +106/-54 |
| `README{,.vi,.ja}.md` | +28 / -17 mỗi file |
| `CHANGELOG{,.vi,.ja}.md` | +25 / -1 mỗi file |
| `docs/scripts/build-pdf.mjs` (font SC/TC, slug kiểu GitHub) | +30 / -8 |
| `docs/seed/seed.mjs` (ký SigV4 có query, policy cho bucket demo) | +20 / -5 |
| `docs/theme.css` (font Hán theo `:lang`) | +13 / -0 |
| `docs/package.json` (`@fontsource/noto-sans-sc`, `-tc`) | +2 / -0 |
| `docs/user-guide/{7}/images/*.png`, `S3Browser-user-guide.<lang>.pdf` | nhị phân, chụp/sinh lại |
| Ngoài phạm vi: `go.mod`, `go.sum`, `frontend/package.json`, `build/windows/icon.ico` (PR #12) | +58 / -58 |
| Ngoài phạm vi: `build/Taskfile.yml`, `build/README.md`, `build/config.yml`, `Taskfile.yml`, `CLAUDE.md`, `.claude/**` (`cedf08a`) | xem commit |

### File thêm mới
| File | Số dòng |
|---|---|
| `README.{zh-CN,zh-TW,ru,de}.md` | 132 mỗi file |
| `CHANGELOG.{zh-CN,zh-TW,ru,de}.md` | 72 mỗi file |
| `docs/ARCHITECTURE.{zh-CN,zh-TW,ru,de}.md` | 223 mỗi file |
| `docs/user-guide/{zh-CN,zh-TW,ru,de}/user-guide.md` | 362 mỗi file |
| `docs/scripts/annotations.json` (chuỗi ghi chú 35 ảnh × 7 ngôn ngữ) | 405 |
| `docs/user-guide/<7>/images/23-…36-*.png`, thư mục ảnh 4 ngôn ngữ mới | 185 PNG |
| `docs/user-guide/{zh-CN,zh-TW,ru,de}/S3Browser-user-guide.<lang>.pdf` | 4 PDF |

File xoá: `docs/user-guide/{en,vi,ja}/images/02-language-switch.png` (thay bằng `02-settings`, Q13); `build/darwin/**`, `build/ios/**`, `build/linux/**` (`cedf08a`).

### Đối chiếu yêu cầu
| Yêu cầu | Trạng thái | Ghi chú |
|---|---|---|
| R1 README | Đã làm | 7 bản (Q1-B), thanh ngôn ngữ 7 mục, badge version động (Q10), cài từ GitHub Releases stable/beta (Q17), yêu cầu hệ thống chỉ còn Windows 10/11 + WebView2 (sau `cedf08a`), ảnh `01` + 4 ảnh (Q16) |
| R2 User guide | Đã làm | 7 bản cùng 25 heading, mỗi bản 35 ảnh; 7 PDF sinh lại sau khi có ảnh ghi chú (cùng commit `ae5ab12`) |
| R3 ARCHITECTURE | Đã làm | Module `update`, luồng xác thực OIDC/STS/LDAP, bucket policy, `pages/tab`; 7 bản cùng heading |
| R4 CHANGELOG 0.1.0 | Đã làm | `## [0.1.0] - Unreleased` ở 7 bản, bản mới dịch toàn bộ file (Q23); ngày và version do người dùng chốt khi release (Q9) |
| R5 Script chụp ảnh | Đã làm | `shots.mjs` chạy được với UI hiện tại, mặc định 7 ngôn ngữ, ảnh `23`–`36` mới; `seed.mjs` đặt policy để badge đủ loại; profile demo và bucket `demo-new-bucket` tạo rồi xoá trong script; credential chỉ qua env |
| R6 Ảnh có ghi chú | Đã làm | Lớp phủ Playwright (khung đỏ theo `boundingBox()`, mũi tên, chữ đỏ viền trắng); 245 PNG chụp lại; script kiểm `annotations.json` đủ khoá trước khi chạy |

### Màn hình không chụp được ở server mode (R5)
- Hộp thoại native: chọn file upload, chọn file CA/certificate, chọn nơi lưu khi download. Modal chọn file và cửa sổ download được điền bằng event Wails tiêm qua `window._wails.dispatchWailsEvent` (UI thật, dữ liệu giả); upload vẫn chạy thật.
- Kéo thả file từ trình quản lý file.
- Bước đăng nhập OIDC trên trình duyệt ngoài: chỉ chụp form cấu hình với giá trị giả (Q3).
- Chọn region khi tạo bucket trên AWS thật: chỉ chụp với MinIO, user guide mô tả bằng chữ (Q4).
- Cài bản cập nhật: build portable không có updater, ảnh `34`–`36` dùng event `update:state-changed` tiêm vào, không tải hay cài thật (Q15).
- Lịch sử download (ảnh `20` cũ) bỏ vì modal trống khi chạy demo.

### Kết quả kiểm tra (khi đóng sprint, 2026-11-09)
- `node --check` `shots.mjs`, `build-pdf.mjs`, `seed.mjs`: sạch.
- `annotations.json`: 35 ảnh, đủ 7 ngôn ngữ, không thiếu chuỗi.
- Link tương đối trong 28 file markdown (README, CHANGELOG, ARCHITECTURE, user guide): không có link hỏng.
- Mỗi ngôn ngữ đủ 35 ảnh; 7 user guide cùng tập heading.
- Không chạy unit test (Q12: sprint chỉ sửa tài liệu). Phần bump dependency của PR #12 không có lần verify riêng được ghi lại (go build/vet, tsc, vitest) trong sprint này.
- Chưa chạy lại lệnh build từ source trong README khi đóng sprint (chỉ đối chiếu nội dung).

### Vấn đề còn lại
- Bản dịch zh-CN, zh-TW, ru, de (README, CHANGELOG, ARCHITECTURE, user guide, chuỗi ghi chú ảnh) do agent viết, **chưa có người bản ngữ duyệt** (Q20-A).
- Thay đổi ngoài phạm vi sprint (requirement: "không sửa code app; không đổi version") do người dùng tự đưa vào `SP-15/release`:
  - PR #12 tiêu đề `chore(deps): ...` nhưng gồm cả CHANGELOG 0.1.0 (R4) lẫn bump aws-sdk-go-v2, modernc sqlite, i18next 27, react-i18next 18, zustand 5.1, biome, knip, oxlint và `icon.ico`.
  - `cedf08a`: bỏ target macOS/Linux/iOS, đổi version `build/config.yml` `0.0.1-beta.1.1` → `0.0.1-beta.15`, sửa `CLAUDE.md` và `.claude/agents` (thêm `rust-native`, `rust-tester`).
- CHANGELOG `0.1.0` thiếu dòng ngừng hỗ trợ macOS/Linux (`cedf08a` có sau PR #12): đã bổ sung mục `Removed` ở 7 bản qua PR #16.
- Sprint-16 R3 (export/import profile) sửa user guide: phải sửa đủ 7 bản và thêm ghi chú ảnh vào `annotations.json` nếu chụp ảnh mới.
