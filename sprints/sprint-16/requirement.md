# Sprint 16: Export và import profile kết nối

## Mục tiêu
Người dùng xuất profile kết nối ra một file JSON và nhập lại vào app trên máy khác, khỏi phải tạo lại profile bằng tay.

## Yêu cầu

### R1: Export một profile ra file JSON
- **Mô tả:** Trong menu item của từng profile (`ConnectionProfiles.tsx`) có mục **Export**. Bấm vào thì mở modal export: có checkbox "Kèm secret"; tick thì phải nhập mật khẩu (và nhập lại để xác nhận). Bấm Export thì app mở hộp thoại lưu file (native) và ghi profile ra file `.json`.
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** Menu item của profile trong navbar (`components/layouts/navbar/components/ConnectionProfiles.tsx`), modal export mới
- **Tiêu chí chấp nhận:**
  - [ ] Menu item của mỗi profile có mục Export, xuất đúng profile đó
  - [ ] File gồm mọi trường cấu hình cần để kết nối lại: tên, màu, provider, endpoint, region, access key, path style, auto connect, authType, `authConfig`
  - [ ] File có trường định dạng/phiên bản (ví dụ `format`, `version`) để import kiểm tra và tương thích về sau
  - [ ] Không chứa trường nội bộ của DB: `id`, `created_at`, `updated_at`, `version` (optimistic lock)
  - [ ] Không tick "Kèm secret": file không chứa secret nào
  - [ ] Tick "Kèm secret": secret key, session token, LDAP password, key password đang lưu được mã hoá bằng mật khẩu người dùng nhập (ví dụ AES-GCM + key dẫn xuất từ mật khẩu bằng KDF có salt), không có secret dạng plaintext trong file
  - [ ] Profile không lưu secret (không tick Save password) thì checkbox "Kèm secret" bị tắt hoặc ẩn
  - [ ] Huỷ hộp thoại lưu file không hiện toast lỗi (`utils.IsDialogCancelled`)
  - [ ] Export xong hiện toast thành công

### R2: Import profile từ file JSON
- **Mô tả:** Nút **Import** (ActionIcon) đặt ngay cạnh nút tạo profile (`createProfile`) trong `HeaderButtonGroup.tsx`. Bấm vào thì mở hộp thoại chọn file `.json`. App kiểm tra file; nếu file có secret đã mã hoá thì hỏi mật khẩu. Sau đó lưu profile vào DB như profile mới.
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** `components/layouts/navbar/components/HeaderButtonGroup.tsx`, modal nhập mật khẩu khi import
- **Tiêu chí chấp nhận:**
  - [ ] Nút Import nằm cạnh nút tạo profile, có tooltip đã dịch
  - [ ] File sai định dạng, sai phiên bản hoặc JSON hỏng thì báo lỗi rõ ràng, không ghi gì vào DB
  - [ ] AuthType không hợp lệ với provider hoặc `authConfig` không hợp lệ thì báo lỗi như khi tạo profile (`PFE008`/`PFE009`), không ghi gì
  - [ ] File là **một object profile** (không phải mảng), có trường `version` của định dạng
  - [ ] File có secret: bắt buộc nhập đúng mật khẩu mới import được; sai thì báo lỗi, cho nhập lại hoặc huỷ; không có lựa chọn nhập bỏ qua secret; không ghi gì vào DB tới khi giải mã được
  - [ ] Giữ nguyên cờ `autoConnect` như trong file (profile export với `autoConnect = true` thì sau import vẫn là `true`)
  - [ ] Profile nhập vào được tạo `id` mới, secret được mã hoá lại bằng `utils.KeyManager` của máy đích
  - [ ] Trùng tên với profile đã có thì tự đổi tên bằng cách thêm hậu tố ` (2)` (đã có ` (2)` thì ` (3)`...), tên mới vẫn trong giới hạn 100 ký tự
  - [ ] Trường đường dẫn file (`certFile`, `keyFile`, `caFile`, `configFile`, `credentialsFile`) không tồn tại trên máy đích thì xoá trống trường đó, vẫn nhập profile và hiện cảnh báo liệt kê các trường đã xoá (`Result=true` + message Warn)
  - [ ] Import xong danh sách profile tự làm mới, toast báo thành công (hoặc cảnh báo)
  - [ ] Huỷ hộp thoại chọn file không hiện toast lỗi
  - [ ] Mã message mới có key ở đủ 7 ngôn ngữ trong `ipcMessage.json`; chuỗi UI mới có đủ 7 ngôn ngữ

### R3: User guide cho export/import profile
- **Mô tả:** Thêm mục hướng dẫn export và import profile vào user guide (`docs/user-guide/<lang>/user-guide.md`, đủ các ngôn ngữ tài liệu mà sprint-15 đã chốt): cách export (kèm/không kèm secret, mật khẩu), cách import, xử lý trùng tên, cảnh báo khi đường dẫn file bị xoá trống, lưu ý bảo mật (giữ file và mật khẩu cẩn thận, quên mật khẩu thì không import được).
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** Không (tài liệu)
- **Tiêu chí chấp nhận:**
  - [ ] Mục export/import có ở mọi bản ngôn ngữ của user guide, cùng nội dung
  - [ ] Có ảnh minh hoạ: mục Export trong menu profile, modal export, nút Import, modal nhập mật khẩu (chụp bằng `docs/scripts/shots.mjs`; màn hình chỉ có hộp thoại native thì ghi rõ không chụp được)
  - [ ] PDF sinh lại bằng `bun run --cwd docs build:pdf`

## Ngoài phạm vi
- Không export nhiều profile một lần (export chỉ từ menu của từng profile).
- Không đồng bộ profile qua cloud hay giữa các máy tự động.
- Không export lịch sử download, cài đặt app (`settings.json`) hay dữ liệu khác ngoài profile.
- Không nhúng nội dung file cert/key/CA vào file export, chỉ đường dẫn.
- Không export phiên OIDC (token, `oidcSessionId`) hay `MfaCode`.

## Ràng buộc / ghi chú
- Secret trong DB được mã hoá bằng `utils.KeyManager` theo máy, nên không chép nguyên chuỗi mã hoá sang máy khác: export giải mã rồi mã hoá lại bằng mật khẩu của người dùng.
- Frontend không bao giờ nhận secret (CLAUDE.md mục 7): đọc, giải mã, mã hoá, ghi và đọc file đều làm ở backend. Mật khẩu export/import chỉ đi từ frontend xuống backend, không lưu ở đâu.
- Hộp thoại lưu/mở file dùng API dialog của Wails v3 (tra https://v3.wails.io/ trước khi dùng).
- Chỉ dùng thư viện chuẩn Go hoặc `golang.org/x/crypto` nếu đã có trong `go.mod` cho KDF; cần thêm dependency mới thì hỏi người dùng.
- Giới hạn kích thước file import hợp lý (ví dụ 1 MB) để tránh đọc file rác quá lớn.
- Nút và modal theo quy ước CLAUDE.md mục 8 (wrapper `ActionIcon`/`Button`, footer modal Huỷ trái, hành động phải, bọc `<Paper withBorder>`).

## Câu hỏi đã biết
Đã chốt (2026-11-06):
- Q1 secret là tuỳ chọn, mã hoá bằng mật khẩu người dùng nhập.
- Q2 nút Import cạnh nút tạo profile; Export nằm trong menu item của từng profile.
- Q3 trùng tên thì tự thêm ` (2)`.
- Q4 đường dẫn file không tồn tại thì xoá trống trường đó, vẫn nhập và cảnh báo.
- Q5 giữ nguyên cờ `autoConnect` như lúc export.
- Q6 quên mật khẩu thì không cho import (không có lựa chọn bỏ qua secret).
- Q7 file là một object profile.
- Q8 sprint-16 chờ sprint-15 DONE (merge `SP-15/release` → `staging`) rồi mới bắt đầu; user guide viết trong sprint-16 (R3).

Còn mở: không.
