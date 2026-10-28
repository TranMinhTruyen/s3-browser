# Sprint 08: Setting của app, kéo thả tab và ghi nhớ tab

> **Trạng thái: HOÀN TẤT (2026-10-28).** Chỉ làm R1 (xem `report.md`). R2 và R3 đã chuyển sang `sprints/sprint-09/requirement.md`.

## Mục tiêu

Thêm modal để điều chỉnh setting của app, cho phép kéo thả tab để thay đổi vị trí, và ghi nhớ các tab đang mở cùng profile của tab để user tiện connect lại khi mở app.

## Yêu cầu

### R1: Modal để điều chỉnh các setting cho app

- **Mô tả:**
  - Tạo 1 modal để user điều chỉnh setting của app.
  - Tạm thời cho điều chỉnh các setting sau: theme của app, font chữ của app, ngôn ngữ của app, khởi động app khi Windows login.
  - Setting được lưu trong 1 file json.
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** App header (modal mới)
- **Tiêu chí chấp nhận:**
  - [x] Thêm 1 button bên trái của button Download history trên app header để mở modal
  - [x] Khi khởi động, luôn load file json setting đầu tiên, nạp các setting rồi mới hiện UI lên
  - [x] User khi bấm lưu sẽ lưu trực tiếp vào file json
  - [x] Trong modal có button để reset tất cả setting về mặc định

### R2 (chuyển sang sprint-09): Thêm khả năng drag cho tab để điều chỉnh vị trí

- **Mô tả:**
  - Cho phép kéo thả tab để điều chỉnh vị trí.
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** TabLayout
- **Tiêu chí chấp nhận:**
  - [ ] Có thể kéo thả tab thoải mái, không giới hạn
  - [ ] Có animation để UI nhìn mượt hơn, chú ý vấn đề hiệu năng (có thể thêm lib animation bên ngoài)

### R3 (chuyển sang sprint-09): Ghi nhớ số lượng, vị trí, profile của tab khi đóng app

- **Mô tả:**
  - Ghi nhớ số lượng, vị trí, profile của tab khi đóng app.
  - Khi đóng app thì ghi nhớ lại, khi mở app thì load lại các tab đã nhớ.
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** TabLayout
- **Tiêu chí chấp nhận:**
  - [ ] Mở app lại thì load lại hết các tab đã nhớ kèm profile của tab đó
  - [ ] Không tự connect; user sẽ tự connect thủ công

## Ngoài phạm vi

- Các setting khác ngoài 4 setting ở R1.
- Tự động connect lại các tab đã nhớ.

## Ràng buộc / ghi chú

- Thêm lib ngoài (drag & drop, animation) phải được người dùng đồng ý trước khi cài.
- Load setting trước khi hiện UI không được làm chậm khởi động app đáng kể.
- Text mới trong UI phải có i18n đủ 3 ngôn ngữ (en, vi, ja).

## Câu hỏi đã biết

- R1: File json setting đặt ở đâu (thư mục config của user, cạnh file SQLite hiện tại, ...)?
- R1: Theme gồm những lựa chọn nào (light / dark / theo hệ thống)? Font chữ cho chọn từ danh sách cố định hay nhập tự do, có chỉnh cỡ chữ không?
- R1: Setting áp dụng ngay khi thay đổi (preview) hay chỉ sau khi bấm lưu? Đóng modal không lưu thì có hoàn tác không?
- R1: "Khởi động app khi Windows login" có cần hỗ trợ macOS/Linux không, hay chỉ hiện option này trên Windows? Với bản portable thì xử lý thế nào?
- R1: Ngôn ngữ hiện đang lưu ở đâu (nếu có), có cần migrate sang file json mới không?
- R2: Dùng lib nào cho kéo thả/animation (ví dụ `@dnd-kit`, `motion`)? Có cần hỗ trợ kéo bằng bàn phím không?
- R3: Lưu trạng thái tab khi đóng app, hay lưu liên tục mỗi khi tab thay đổi (để không mất khi app crash)?
- R3: Ngoài profile, có ghi nhớ bucket/đường dẫn đang mở và tab đang active không?
- R3: Nếu profile của tab đã nhớ bị xoá thì xử lý thế nào (bỏ tab, hay mở tab trống)?
- R3: Trạng thái tab lưu chung file json setting của R1 hay lưu riêng (file khác / SQLite)?
