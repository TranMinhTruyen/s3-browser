# Sprint 09: Kéo thả tab và ghi nhớ tab

> Chuyển từ sprint-08 (R2, R3 cũ). Phần phân tích, đề xuất và task đã soạn sẵn nằm ở `sprints/sprint-08/plan.md` mục 8.

## Mục tiêu

Cho phép kéo thả tab để thay đổi vị trí, và ghi nhớ các tab đang mở cùng profile của tab để user tiện connect lại khi mở app.

## Yêu cầu

### R1: Thêm khả năng drag cho tab để điều chỉnh vị trí (R2 của sprint-08)

- **Mô tả:**
  - Cho phép kéo thả tab để điều chỉnh vị trí.
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** TabLayout
- **Tiêu chí chấp nhận:**
  - [ ] Có thể kéo thả tab thoải mái, không giới hạn
  - [ ] Có animation để UI nhìn mượt hơn, chú ý vấn đề hiệu năng (có thể thêm lib animation bên ngoài)

### R2: Ghi nhớ số lượng, vị trí, profile của tab khi đóng app (R3 của sprint-08)

- **Mô tả:**
  - Ghi nhớ số lượng, vị trí, profile của tab khi đóng app.
  - Khi đóng app thì ghi nhớ lại, khi mở app thì load lại các tab đã nhớ.
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** TabLayout
- **Tiêu chí chấp nhận:**
  - [ ] Mở app lại thì load lại hết các tab đã nhớ kèm profile của tab đó
  - [ ] Không tự connect; user sẽ tự connect thủ công

### R3: Tối ưu danh sách profile và đồng bộ select (bổ sung trong sprint)

- **Mô tả:**
  - Danh sách profile ở navbar phải virtualize, chịu được 200 profile.
  - Select profile ở thanh action của tab có ô search trong dropdown giống select bucket.
  - Màu nền, viền và đổ bóng dropdown của mọi combobox/select đồng bộ, dễ nhìn ở cả light/dark.
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** LeftNavbar (ConnectionProfiles), TabActionBar, mọi Select/Combobox
- **Tiêu chí chấp nhận:**
  - [ ] 200 profile cuộn mượt, chỉ render các dòng đang hiện; một profile đổi trạng thái thì chỉ dòng đó render lại
  - [ ] Giữ nguyên double click connect, context menu, spinner, màu profile, auto-connect, xoá có xác nhận
  - [ ] Select profile có ô search tự focus khi mở, lọc không phân biệt hoa thường, từ khoá reset khi đóng
  - [ ] Dropdown của mọi combobox/select có cùng nền, viền, đổ bóng (đặt một lần trong theme Mantine)

## Ngoài phạm vi

- Tự động connect lại các tab đã nhớ.
- R3: virtualize dropdown select profile (vẫn render đủ option, có `mah` + search lọc); giới hạn số kết nối đồng thời khi auto-connect.

## Ràng buộc / ghi chú

- Người dùng **đã đồng ý cài** `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`, `@dnd-kit/modifiers` (sprint-08). Lib khác vẫn phải hỏi trước.
- Text mới trong UI phải có i18n đủ 3 ngôn ngữ (en, vi, ja).

## Câu hỏi đã biết

Đề xuất của planner ở sprint-08 (chưa được trả lời chính thức):
- R1: Dùng `@dnd-kit` (`restrictToHorizontalAxis`), hỗ trợ kéo bằng bàn phím; animation bằng CSS transform của dnd-kit, không thêm `motion`?
- R2: Lưu liên tục mỗi khi tab thay đổi (debounce ~500ms) thay vì chỉ lưu khi đóng app (để không mất khi crash)?
- R2: Nhớ tab active + thứ tự + profile; không nhớ bucket/đường dẫn đang mở?
- R2: Profile của tab đã nhớ bị xoá thì giữ tab nhưng bỏ profile?
- R2: Lưu riêng `<DataDir>/tabs.json` (cùng cơ chế ghi atomic với `settings.json`)?
