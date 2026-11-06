# Sprint 14: Kiểm tra và cài đặt bản cập nhật từ GitHub Releases

## Mục tiêu
Người dùng biết khi có phiên bản mới và cập nhật app ngay trong app, không phải tự vào GitHub tải về cài lại. App chỉ thoát để cài khi người dùng xác nhận.

## Yêu cầu

### R2: Kiểm tra, tải và cài đặt bản cập nhật
- **Mô tả:** App lấy danh sách release trên GitHub Releases của repo `TranMinhTruyen/s3-browser`, so với phiên bản đang chạy. Có bản mới thì tuỳ setting "Tự động cập nhật":
  - **Bật:** app tự kiểm tra, tự tải bản mới ở nền (có thanh tiến trình). Tải xong hiện toast "Đã tải bản cập nhật vX.Y.Z" kèm nút **Cập nhật**. Người dùng nhấn nút thì app thoát và chạy bộ cài; không nhấn thì app chạy bình thường.
  - **Tắt:** app không tự tải. Có bản mới thì hiện nút **Tải bản cập nhật**; người dùng nhấn mới tải (có thanh tiến trình). Tải xong hiện nút **Cập nhật**; người dùng nhấn mới thoát app và cài.
- **Nền tảng:** Không phụ thuộc S3/MinIO (tính năng của app)
- **Màn hình liên quan:** modal Settings (`components/modals/setting`), toast (sonner), `App.tsx`
- **Tiêu chí chấp nhận:**
  - [ ] Settings có switch "Tự động kiểm tra và tải bản cập nhật", lưu trong `settings.json` cùng các setting khác, nhãn i18n đủ 7 ngôn ngữ.
  - [ ] Nguồn cập nhật là GitHub Releases của `TranMinhTruyen/s3-browser`; so phiên bản theo semver (kể cả pre-release như `0.0.1-beta.1`) với version của app (`build/config.yml` → `info.version`).
  - [ ] Chọn đúng file của release theo hệ điều hành/kiến trúc và kiểu bản cài (installer hoặc portable).
  - [ ] Tải ở backend, không chặn UI; frontend hiện thanh tiến trình (phần trăm, dung lượng đã tải/tổng) qua event Wails.
  - [ ] File tải xong được kiểm toàn vẹn (checksum SHA-256 đi kèm release) trước khi cho cài; sai thì xoá file và báo lỗi.
  - [ ] Chỉ tải từ URL `https` của GitHub (`api.github.com`, `github.com`, `objects.githubusercontent.com`...).
  - [ ] Nhấn **Cập nhật**: app chạy bộ cài rồi thoát; chỉ thoát sau khi người dùng xác nhận (cảnh báo nếu đang có upload/download S3 chạy dở).
  - [ ] Đã mới nhất hoặc lỗi mạng/GitHub giới hạn request khi tự kiểm tra: không hiện toast lỗi (chỉ ghi log); khi người dùng tự bấm kiểm tra thì báo kết quả.
  - [ ] Chế độ dev (`devmode_dev.go`) không kiểm tra cập nhật.
  - [ ] Mọi chuỗi UI và message code mới có key đủ 7 ngôn ngữ.

## Ngoài phạm vi
- Tự build và phát hành release (CI/GitHub Actions) — người dùng tự đưa bản cài lên GitHub Releases.
- Cập nhật delta/bản vá một phần; tự quay lại bản cũ (rollback).
- Ký số (code signing) bộ cài.

## Ràng buộc / ghi chú
- API: `GET https://api.github.com/repos/TranMinhTruyen/s3-browser/releases` (hoặc `/releases/latest`, nhưng endpoint này bỏ qua pre-release). Không token thì giới hạn 60 request/giờ mỗi IP, nên kiểm tra thưa (ví dụ lúc mở app + mỗi vài giờ).
- Windows có hai kiểu bản: installer NSIS (`build/windows/nsis`) và portable (build tag `portable`, thư mục `exe + data/ + webview2/`). Bản portable không chạy được installer: cần cách cập nhật riêng (giải nén đè, giữ `data/`) hoặc chỉ mở trang release.
- Wails v3: tra https://v3.wails.io/ xem có updater/API thoát app chuẩn chưa trước khi tự viết (memory: docs có thể trả 403 cho agent → ghi "chưa xác minh").
- File tải tạm lưu ở thư mục tạm của OS (hoặc cạnh `data.db`), xoá sau khi cài hoặc khi có bản mới hơn.
- Release cần quy ước tên file và file checksum để app nhận diện, ví dụ `S3Browser-<version>-windows-amd64-installer.exe`, `S3Browser-<version>-windows-amd64-portable.zip`, `checksums.txt`.

## Câu hỏi đã biết
- Khi **tắt** tự động cập nhật: app vẫn tự **kiểm tra** (chỉ không tự tải) rồi hiện nút "Tải bản cập nhật", hay hoàn toàn không tự kiểm tra và chỉ kiểm tra khi người dùng bấm nút "Kiểm tra cập nhật" trong Settings?
- Nút "Tải bản cập nhật", thanh tiến trình và nút "Cập nhật" đặt ở đâu: trong toast, trong modal Settings, hay một mục/icon riêng trên header?
- Tần suất tự kiểm tra: chỉ lúc mở app, hay định kỳ (bao lâu)?
- Có nhận pre-release (beta) không? Hay có thêm lựa chọn kênh "stable/beta"?
- Hỗ trợ những nền tảng nào trong sprint này: chỉ Windows (installer + portable), hay cả macOS/Linux?
- Bản portable: tự giải nén đè (giữ `data/`) hay chỉ mở trang release cho người dùng tự tải?
- Chạy bộ cài NSIS ở chế độ im lặng (`/S`) rồi tự mở lại app, hay hiện giao diện bộ cài bình thường?
- Có hiện changelog (release notes) của bản mới cho người dùng xem trước khi tải/cài không?
- Người dùng bỏ qua một phiên bản ("Bỏ qua bản này") có cần không?
- Release đã có file checksum chưa, tên file asset theo quy ước nào?
