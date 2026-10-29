# Sprint 10: Refactor code, cải thiện hiệu năng và UX/UI

## Mục tiêu

Làm sạch codebase (gọn, dễ đọc, đủ comment/doc, hiệu năng tốt hơn) để dev mới dễ nắm bắt và dễ maintain, đồng thời cải thiện UX/UI. Đây là bước chuẩn bị cho bản `0.0.1-beta.2`; phần phát hành (version, CHANGELOG, tài liệu) làm ở sprint-11.

## Yêu cầu

### R1: Rà soát và refactor code

- **Mô tả:**
  - Rà soát backend Go (`main.go`, `internal/**`, `models/**`) và frontend (`frontend/src/**`, trừ code sinh tự động). Phạm vi: code thêm/sửa từ sau `0.0.1-beta.1` (sprint 08, 09: modal Setting, kéo thả tab, ghi nhớ tab, danh sách profile) và các điểm tồn đọng ghi trong `sprints/sprint-07/report.md`, `sprints/sprint-09/report.md`.
  - Gom code trùng lặp thành hàm/hook/component dùng chung; xoá code chết, import thừa, biến/hằng/key i18n/message code không dùng.
  - Rút gọn hàm dài, lồng nhiều tầng; đặt tên rõ nghĩa theo quy ước trong `CLAUDE.md`.
  - Bổ sung doc comment (Go) và JSDoc (frontend) còn thiếu. Điểm cần cập nhật trong `docs/ARCHITECTURE*.md` chỉ ghi vào `report.md`, cập nhật tài liệu làm ở sprint-11.
  - **Không thay đổi hành vi** người dùng thấy được (ngoài các điểm UX/UI ở R3).
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** Toàn bộ app
- **Tiêu chí chấp nhận:**
  - [ ] Có danh sách các điểm đã refactor (file, lý do) trong `report.md`
  - [ ] Không còn code chết, import thừa, key i18n không dùng (có cách kiểm chứng, ví dụ grep/lint)
  - [ ] Hàm/type exported trong Go có doc comment; util, hook, store frontend có JSDoc
  - [ ] Mọi chức năng hiện có hoạt động như trước (S3 và MinIO)
  - [ ] `go build`, `go vet`, `golangci-lint`, `biome check`, `oxlint`, `tsc --noEmit` đều pass
  - [ ] Mọi file frontend đã đổi đạt C1 ≥ 95% và Lines ≥ 95%

### R2: Đánh giá và tối ưu hiệu năng

- **Mô tả:**
  - Backend: rà soát cấp phát bộ nhớ, giới hạn goroutine/errgroup, giữ lock quá lâu, gọi S3 thừa, rò rỉ context/goroutine, đọc/ghi `settings.json` và SQLite.
  - Frontend: rà soát re-render thừa (selector zustand, `useCallback`/`useMemo`), danh sách lớn đã virtualize chưa, bundle size (lazy load page/modal), lắng nghe event không gỡ, thời gian khởi động app (nạp setting, khôi phục tab).
  - Ghi lại số đo trước/sau cho những điểm tối ưu đo được.
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** Khởi động app, thanh tab, trang bucket, trang object, upload/download, tìm kiếm
- **Tiêu chí chấp nhận:**
  - [ ] Có bảng đánh giá hiệu năng (vấn đề, mức độ, cách xử lý, kết quả) trong `report.md`
  - [ ] Các vấn đề mức cao được xử lý trong sprint; mức thấp có thể ghi lại để làm sau
  - [ ] Không làm chậm hơn chức năng nào so với trước

### R3: Cải thiện UX/UI

- **Mô tả:**
  - Làm các mục UX/UI người dùng đã duyệt trong Phụ lục C của `plan.md`: U1–U4 và U7–U14 (12 mục). Gồm trạng thái rỗng cho danh sách profile và bucket/thư mục, kéo thả tab chỉ khi có từ 2 tab, animation khi đóng tab, khoá nút modal Setting khi lưu, theme `auto` trên OS dark, màu modal theo biến theme, rà layout ở 3 ngôn ngữ x các font, toast lỗi lúc khởi động, virtualize cửa sổ download, loading khi tải modal lazy, tương phản trạng thái kết nối.
  - Tuân thủ quy ước UI trong `CLAUDE.md` (màu theo theme, footer modal, i18n đủ 3 ngôn ngữ, console sạch).
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** Toàn bộ app
- **Tiêu chí chấp nhận:**
  - [ ] Có danh sách điểm UX/UI đã sửa (màn hình, trước/sau) trong `report.md`
  - [ ] Giao diện hiển thị đúng ở cả light/dark theme và 3 ngôn ngữ
  - [ ] Không có warning/error trong console React

## Ngoài phạm vi

- Phát hành `0.0.1-beta.2` (đổi version, CHANGELOG, README, hướng dẫn sử dụng, ảnh chụp, PDF, build installer): chuyển sang **sprint-11**, làm sau khi các PR của sprint-10 đã merge.
- Thêm tính năng mới, gồm U5 (phím tắt) và U6 (logo/tên app ở header), hiển thị version trong app.
- Viết unit test Go.
- Commit, tag git hay đẩy release lên GitHub (người dùng tự làm, trừ PR theo quy trình B6).

## Ràng buộc / ghi chú

- Các branch phải **độc lập**: mỗi branch tách từ `origin/master`, không dùng code của branch khác, không có hai branch cùng sửa một file (vì push/PR chỉ ở cuối sprint và `git-flow` không rebase/merge).
- Luật 8 áp dụng cho mọi file frontend bị đổi, kể cả chỉ thêm comment: nên gộp refactor, comment và sửa UX/UI cùng một lần cho mỗi file.
- Không sửa code sinh tự động (`internal/pkg/db/sqlc/**`, `frontend/bindings/**`); nếu đổi handler/model thì sinh lại bindings qua skill `wails3-bindings`.
- Nếu refactor làm lệch quy ước trong `CLAUDE.md`, báo người dùng để cập nhật.
- Tham khảo cách làm và kết quả của sprint 07 (`sprints/sprint-07/plan.md`, `report.md`) để tránh làm lại phần đã rà soát.

## Quyết định của người dùng

- **Phạm vi refactor:** chỉ code sau beta.1 và tồn đọng ở report sprint-07/09 (Q5 = b).
- **UX/UI:** dùng Phụ lục C của plan, bỏ U5 và U6 (Q1).
- **Chia branch:** theo module, các branch độc lập; phần release chuyển sang sprint-11 (Q6, K1).
- **Connect:** gom logic kết nối của navbar và tab vào hook chung nhưng giữ state connecting cục bộ mỗi nơi, hành vi như cũ (K3).
- **Hiệu năng:** không đặt ngưỡng tuyệt đối; không chậm hơn baseline, bundle không tăng, đo trước/sau (Q2).
- Các câu hỏi còn lại theo đề xuất trong `plan.md` mục 2.

- **U8, U9 (Q19 = a):** cho sửa `main.go` nếu U8 tái hiện được (không đổi model/handler); U9 chấp nhận màu header modal lệch nhẹ ở light theme, người dùng xem lại khi smoke test.
- **ARCHITECTURE:** cập nhật `docs/ARCHITECTURE*.md` làm ở sprint-11; sprint-10 chỉ ghi điểm cần cập nhật vào `report.md`.

## Câu hỏi đã biết

- Không còn.
