# Sprint 07: Rà soát, tối ưu code và chuẩn bị phát hành 0.0.1-beta.1

## Mục tiêu

Làm sạch toàn bộ codebase (gọn, dễ đọc, đủ comment/doc, hiệu năng tốt hơn) để dev mới dễ nắm bắt và dễ maintain, đồng thời chuẩn bị README và hướng dẫn sử dụng PDF để ra mắt phiên bản `0.0.1-beta.1`.

## Yêu cầu

### R1: Rà soát và refactor code

- **Mô tả:**
  - Rà soát toàn bộ backend Go (`main.go`, `internal/**`, `models/**`) và frontend (`frontend/src/**`, trừ code sinh tự động).
  - Gom code trùng lặp thành hàm/hook/component dùng chung; xoá code chết, import thừa, biến/hằng/key i18n không dùng.
  - Rút gọn hàm dài, lồng nhiều tầng; đặt tên rõ nghĩa theo quy ước trong `CLAUDE.md`.
  - **Không thay đổi hành vi** người dùng thấy được (UI, message, luồng thao tác).
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** Toàn bộ app
- **Tiêu chí chấp nhận:**
  - [ ] Có danh sách các điểm đã refactor (file, lý do) trong `report.md`
  - [ ] Không còn code chết, import thừa, key i18n không dùng (có cách kiểm chứng, ví dụ grep/lint)
  - [ ] Mọi chức năng hiện có hoạt động như trước (S3 và MinIO)
  - [ ] `go build`, `go vet`, `golangci-lint`, `biome check`, `oxlint`, `tsc --noEmit` đều pass
  - [ ] Mọi file frontend đã đổi đạt C1 ≥ 95% và Lines ≥ 95%

### R2: Bổ sung comment và doc

- **Mô tả:**
  - Go: mọi hàm/type exported có doc comment; package có comment mô tả vai trò; logic khó (concurrency, lock, huỷ context, upload/xoá đệ quy) có comment giải thích "tại sao".
  - Frontend: store, hook, util dùng chung và component phức tạp có JSDoc ngắn gọn (mục đích, tham số, giá trị trả về).
  - Comment ngắn, súc tích; không comment lặp lại điều code đã nói rõ.
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** Không có (chỉ code)
- **Tiêu chí chấp nhận:**
  - [ ] Hàm/type exported trong Go đều có doc comment
  - [ ] Util, hook, store frontend đều có JSDoc
  - [ ] Có tài liệu kiến trúc ngắn cho dev mới (luồng handler → module → submodule, luồng `callIPC`, store, event)

### R3: Đánh giá và tối ưu hiệu năng

- **Mô tả:**
  - Backend: rà soát cấp phát bộ nhớ, goroutine/errgroup limit, giữ lock quá lâu, gọi S3 thừa, phân trang list object, rò rỉ context/goroutine.
  - Frontend: rà soát re-render thừa (selector zustand, `useCallback`/`useMemo`), danh sách lớn đã virtualize chưa, bundle size (lazy load page/modal, import lucide theo icon), lắng nghe event không gỡ.
  - Ghi lại số đo trước/sau cho những điểm tối ưu có thể đo được.
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** Trang bucket, trang object, upload/download, tìm kiếm
- **Tiêu chí chấp nhận:**
  - [ ] Có bảng đánh giá hiệu năng (vấn đề, mức độ, cách xử lý, kết quả) trong `report.md`
  - [ ] Các vấn đề mức cao được xử lý trong sprint; mức thấp có thể ghi lại để làm sau
  - [ ] Không làm chậm hơn chức năng nào so với trước

### R4: README và hướng dẫn sử dụng PDF

- **Mô tả:**
  - Viết lại `README.md`: giới thiệu, tính năng chính, ảnh chụp màn hình, yêu cầu hệ thống, cài đặt (bản cài đặt và bản portable), build từ source, cấu trúc thư mục, cách đóng góp, license.
  - Hướng dẫn sử dụng dạng PDF cho người dùng cuối: kết nối AWS S3/MinIO, duyệt bucket/object, upload (kéo thả và modal), download, xoá, tìm kiếm, xem chi tiết object, đổi ngôn ngữ, xử lý lỗi thường gặp.
  - Có CHANGELOG cho bản `0.0.1-beta.1`.
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** Không có (tài liệu)
- **Tiêu chí chấp nhận:**
  - [ ] README đầy đủ các mục trên bằng cả 3 ngôn ngữ (en, vi, ja), làm theo được từ máy trống
  - [ ] Mỗi ngôn ngữ có một file PDF hướng dẫn sử dụng, có mục lục và ảnh chụp giao diện đúng ngôn ngữ đó
  - [ ] Có CHANGELOG bằng 3 ngôn ngữ liệt kê tính năng của `0.0.1-beta.1`
  - [ ] PDF sinh lại được bằng một lệnh

### R5: Chốt version 0.0.1-beta.1

- **Mô tả:** Cập nhật version ở mọi nơi khai báo (`build/config.yml` đang là `0.0.1`, `frontend/package.json` đang là `0.0.0`, metadata build Windows/macOS...) thành `0.0.1-beta.1` và kiểm tra build bản cài đặt lẫn bản portable.
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** Màn hình hiển thị version (nếu có)
- **Tiêu chí chấp nhận:**
  - [ ] Version thống nhất ở mọi nơi
  - [ ] Build production (cài đặt và portable) chạy được

## Ngoài phạm vi

- Thêm tính năng mới.
- Viết unit test Go.
- Thay đổi UI/UX (chỉ refactor, không đổi giao diện).
- Commit, tag git hay đẩy release lên GitHub (người dùng tự làm).

## Ràng buộc / ghi chú

- Sprint 06 (modal upload) chưa có `report.md` và còn thay đổi chưa commit; sprint 07 nên bắt đầu sau khi sprint 06 hoàn tất và đã commit, để diff refactor tách bạch.
- Phạm vi lớn: planner nên chia theo module (connection, bucket, object, upload/download, search, layout/tab...) thành nhiều đợt nhỏ, mỗi đợt tự build/test pass, để dễ review và tránh vượt 3 vòng B4.
- Luật 8 áp dụng cho mọi file frontend bị đổi, kể cả chỉ thêm comment: cân nhắc ưu tiên thêm comment cùng lúc với refactor để không phải test lại nhiều lần.
- Không sửa code sinh tự động (`internal/pkg/db/sqlc/**`, `frontend/bindings/**`); nếu đổi handler/model thì sinh lại bindings qua skill `wails3-bindings`.
- Nếu refactor làm lệch quy ước trong `CLAUDE.md`, báo người dùng để cập nhật.

## Quyết định của người dùng

- **Ngôn ngữ tài liệu:** cả 3 thứ tiếng như app (en, vi, ja) cho README, hướng dẫn PDF, CHANGELOG và tài liệu kiến trúc. Ví dụ `README.md` (en) kèm `README.vi.md`, `README.ja.md` có link chuyển qua lại; mỗi ngôn ngữ một file PDF.
- **Công cụ tạo PDF:** agent được phép tự chọn và thêm công cụ cần thiết (ngoại lệ của quy định "không tự ý cài lib" trong `CLAUDE.md`, chỉ áp dụng cho công cụ tạo tài liệu). Ưu tiên công cụ chạy được qua `bun`/`go tool`, khai báo trong project (không cài global), hỗ trợ font tiếng Nhật và tiếng Việt, có script sinh lại PDF bằng một lệnh. Ghi tên công cụ và cách dùng vào `report.md`.
- **Ảnh chụp màn hình:** agent chạy app để chụp, cho cả 3 ngôn ngữ giao diện.
- **Version:** `0.0.1-beta.1` (chuẩn SemVer).
- **License:** app miễn phí.

## Câu hỏi đã biết

- License: app miễn phí, nhưng cần chốt license cụ thể để ghi vào README và file `LICENSE` (ví dụ MIT, Apache-2.0, hay freeware không mở mã nguồn)? Planner đề xuất, người dùng chọn.
- Chụp ảnh màn hình cần kết nối tới S3/MinIO có dữ liệu mẫu: dùng MinIO local (ví dụ Docker) với dữ liệu giả, hay người dùng cung cấp endpoint thử nghiệm? Không ghi secret vào thư mục sprint.
- Metadata Windows chỉ nhận version dạng `x.y.z.w`: planner đề xuất cách map `0.0.1-beta.1` (ví dụ `0.0.1.1`).
- Nguồn Markdown của hướng dẫn sử dụng và PDF xuất ra đặt ở đâu (ví dụ `docs/<lang>/user-guide.md` → `docs/<lang>/user-guide.pdf`)? PDF có commit vào git không?
- Tài liệu kiến trúc cho dev mới đặt trong `README.md` hay file riêng (ví dụ `docs/ARCHITECTURE.md`)?
- Có ngưỡng hiệu năng cụ thể nào cần đạt (thời gian mở bucket N object, bộ nhớ, kích thước bundle) không, hay chỉ cần cải thiện so với hiện tại?
