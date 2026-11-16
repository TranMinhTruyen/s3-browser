# Sprint 18: Chế độ SQL — UI giống S3 (chưa có backend)

## Mục tiêu
Thêm chế độ **SQL** vào app với giao diện và thao tác **giống chế độ S3** (navbar profile, dải tab, header tab), chỉ khác phần nghiệp vụ: soạn câu SQL có format, tìm/thay thế và phím tắt thực thi. Backend Go và Rust (`s3b_db.dll`) chưa có, nên sprint này chỉ làm **UX/UI**: dữ liệu profile nằm trong RAM (có sẵn vài profile mock), mọi lệnh cần backend (kết nối, thực thi, import/export) hiện toast để người dùng kiểm tra.

## Nguyên tắc chung
- **UI/UX giống S3**: bố cục, kích thước, khoảng cách, icon, tooltip, menu, modal, phím tắt, hành vi tab của chế độ SQL bám theo bản S3 tương ứng (bảng đối chiếu ở từng yêu cầu). Chỗ nào khác S3 phải ghi rõ trong plan.
- **Bản SQL riêng** (người dùng chốt): code SQL nằm trong thư mục riêng, chép cấu trúc của S3 sang, **không sửa code S3** (trừ `MainLayout` để thêm SegmentedControl và chuyển chế độ). Không tách component chung giữa S3 và SQL ở sprint này. Component nền dùng chung đã có (`components/buttons|inputs|display|modals` như `ActionIcon`, `Button`, `Combobox`, `TruncatedText`, `ConfirmModal`, `createMantineModal`...) thì dùng lại bình thường.
- Nghiệp vụ SQL (store profile DB, store tab SQL, format, find/replace, toast thực thi) tách khỏi store S3 (`profileStore`, `tabListStore`): thao tác bên này không ảnh hưởng bên kia.

## Yêu cầu

### R1: Chuyển chế độ S3 / SQL trên header
- **Mô tả:** `AppShell.Header` (trong `MainLayout`) có thêm một `SegmentedControl` (wrapper `components/inputs/SegmentedControl`) gồm `S3` và `SQL`. Chọn `S3`: thân app như hiện tại. Chọn `SQL`: **toàn bộ thân app** (navbar trái + vùng tab) đổi sang chế độ SQL, cùng bố cục `Splitter` như S3.
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** `MainLayout`, header
- **Tiêu chí chấp nhận:**
  - [ ] SegmentedControl nằm trong vùng `no-drag` của header, bấm được, double-click lên nó không maximize cửa sổ.
  - [ ] Chuyển qua lại giữa S3 và SQL **giữ nguyên state** của cả hai bên (S3: tab, kết nối, transfer đang chạy; SQL: profile, các tab, nội dung editor, profile của từng tab, độ rộng splitter) — không unmount/mount lại gây mất dữ liệu.
  - [ ] Cửa sổ Downloader/Uploader vẫn hoạt động ở cả hai chế độ.
  - [ ] Nhãn SegmentedControl đủ 7 ngôn ngữ.

### R2: Navbar profile DB (giống `LeftNavbar` S3)
- **Mô tả:** Navbar trái của chế độ SQL giống `LeftNavbar` S3: nhóm nút đầu (giống `HeaderButtonGroup`) và danh sách profile (giống `ConnectionProfiles` / `ConnectionProfileItem`).
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** navbar chế độ SQL (mới)
- **Tiêu chí chấp nhận:**
  - [ ] Khởi động có sẵn vài **profile mock** (PostgreSQL và SQLite) khai báo ở **một file duy nhất**, dễ xoá khi có backend. Danh sách profile giữ trong store RAM (`createAppStore`), mất khi tắt app.
  - [ ] Nhóm nút đầu giống S3: Connect, Tạo profile, Import, Refresh (cùng icon/tooltip). Tạo profile mở modal R3; Connect/Import/Refresh hiện toast "chưa có backend".
  - [ ] Mỗi dòng profile giống S3: màu, tên (ellipsis + tooltip qua `TruncatedText`), loại DB (icon hoặc badge PostgreSQL/SQLite), trạng thái kết nối.
  - [ ] Menu của dòng giống S3: Connect / Disconnect, Edit, Export, Delete.
    - Connect/Disconnect **giả**: chỉ đổi trạng thái `isConnected` trong store và hiện toast.
    - Edit mở modal R3 với dữ liệu của profile.
    - Export hiện toast "chưa có backend".
    - Delete hỏi xác nhận bằng `ConfirmModal` như S3 rồi xoá khỏi store; tab SQL đang dùng profile đó trở về trạng thái chưa chọn profile.
  - [ ] Danh sách dài vẫn virtualize như S3.

### R3: Modal tạo / sửa profile DB (giống `ConnectModal` S3)
- **Mô tả:** Modal tạo và sửa profile DB, bố cục giống `ConnectModal` (chế độ create / edit), lưu vào store RAM.
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** modal profile DB (mới)
- **Tiêu chí chấp nhận:**
  - [ ] Trường chung: tên, màu (như S3), loại DB (`SegmentedControl` hoặc `Select`: PostgreSQL, SQLite).
  - [ ] PostgreSQL: host, port (mặc định 5432), database, username, password (input ẩn/hiện như S3), SSL mode.
  - [ ] SQLite: đường dẫn file (nhập tay; nút chọn file hiện toast "chưa có backend" vì hộp thoại native cần Go).
  - [ ] Validate bằng zod như form S3 (bắt buộc, port là số 1–65535, tên không trùng); báo lỗi theo field, đủ 7 ngôn ngữ.
  - [ ] Lưu: create thêm profile mới, edit cập nhật profile và nhãn các tab đang dùng nó; hiện toast thành công.
  - [ ] Footer theo quy ước modal (Cancel `color="red"` trái, nút hành động phải, `Group p="8px" justify="space-between" wrap="nowrap"`), thân bọc `<Paper withBorder>`.
  - [ ] Password chỉ giữ trong RAM của store mock, không ghi ra log/console/toast.

### R4: Dải tab SQL (giống `TabPage` S3)
- **Mô tả:** Vùng phải của chế độ SQL là dải tab giống `TabPage`. Mỗi tab là một phiên soạn SQL riêng gắn với **một profile** (chọn ở header của tab), có editor và các phím tắt R7–R9 riêng.
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** vùng tab chế độ SQL (mới)
- **Tiêu chí chấp nhận:**
  - [ ] Thao tác tab giống S3: nút `+` thêm tab, đóng tab (chỉ khi có từ 2 tab), kéo thả đổi thứ tự (cùng ngưỡng kéo, overlay, modifier), Ctrl+Shift+Left/Right đổi thứ tự bằng bàn phím, tự cuộn tới tab đang chọn khi dải tab tràn, animation thêm/đóng tab.
  - [ ] Nhãn tab giống `TabLabel` S3: tên + màu profile đã chọn, chưa chọn thì nhãn mặc định.
  - [ ] Tab ẩn giữ nguyên state (nội dung editor, vùng chọn, vị trí cuộn, profile, dialog Find đang mở) như cơ chế `Activity` S3; tab chỉ mount khi được mở lần đầu.
  - [ ] Store tab SQL riêng (không dùng `tabListStore`).

### R5: Header của mỗi tab SQL (giống `TabActionBar` S3)
- **Mô tả:** Thanh công cụ trên editor giống `TabActionBar`: Combobox chọn profile, nút **Connect** (giả) và nút **Execute** chạy toàn bộ câu SQL của tab.
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** tab SQL
- **Tiêu chí chấp nhận:**
  - [ ] Combobox dùng `components/inputs/combobox/Combobox` như S3, lấy danh sách từ store profile DB (R2), cùng placeholder tìm kiếm / chữ "không có kết quả".
  - [ ] Mỗi tab chọn profile độc lập; đổi profile ở tab này không đổi tab khác.
  - [ ] Nút Connect giống S3: disable khi chưa chọn profile hoặc profile đã kết nối; bấm thì kết nối giả (như R2) và hiện toast.
  - [ ] Nút Execute (`ActionIcon` có `tooltip`) chỉ enable khi Combobox của tab đã chọn một profile.
  - [ ] Bấm Execute: hiện toast chứa tên profile và **toàn bộ** câu SQL sẽ chạy (bỏ qua phần tô đen nếu có).

### R6: Ô soạn SQL (CodeMirror 6, đồng bộ UI Mantine)
- **Mô tả:** Phần thân mỗi tab SQL là editor CodeMirror 6 có tô màu cú pháp SQL và số dòng, chiếm hết chiều cao còn lại dưới header của tab.
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** tab SQL
- **Tiêu chí chấp nhận:**
  - [ ] Người dùng **đã đồng ý cài** `codemirror` / `@codemirror/*` cần thiết (tối thiểu `lang-sql`) và `sql-formatter`. Không cài thêm lib khác khi chưa hỏi.
  - [ ] Giao diện editor **thống nhất với Mantine**: font, cỡ chữ, màu nền/chữ/viền, gutter số dòng, vùng chọn, con trỏ, màu viền khi focus đều lấy từ biến theme `var(--mantine-*)` và `light-dark(...)`; đổi light/dark theme hoặc đổi font trong Settings thì editor đổi theo. Màu tô cú pháp cũng lấy từ bảng màu Mantine. Không hard-code màu.
  - [ ] Editor bọc lại thành component trong `components/inputs/` (theo quy ước bọc component), viền và bo góc giống các input Mantine khác.
  - [ ] Tắt các keymap mặc định của CodeMirror xung đột với R7–R9 (ví dụ `searchKeymap` Ctrl+F), và chặn hành vi mặc định của WebView2 cho Ctrl+F/Ctrl+E/Ctrl+Q khi editor đang focus.
  - [ ] Console sạch, không lỗi khi chuyển chế độ, đổi tab hay đổi theme.
  - [ ] Hint khi gõ (autocomplete, thêm 2026-11-11): gợi ý từ khoá SQL theo dialect và tên bảng/cột từ schema mock của profile đang chọn; tự hiện khi gõ và mở bằng Ctrl+Space; ↑/↓ chọn, Enter/Tab nhận, Esc đóng; popup theo theme Mantine. Cài thêm `@codemirror/autocomplete` (đã đồng ý).

### R7: Ctrl+Q — format SQL
- **Mô tả:** Format bằng `sql-formatter`, dialect theo loại DB của profile của tab (PostgreSQL → `postgresql`, SQLite → `sqlite`); chưa chọn profile thì dùng SQL chuẩn (`sql`).
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** tab SQL
- **Tiêu chí chấp nhận:**
  - [ ] Không tô đen gì + Ctrl+Q: format toàn bộ nội dung editor.
  - [ ] Tô đen một phần + Ctrl+Q: chỉ format phần tô đen, phần còn lại giữ nguyên.
  - [ ] Format xong hiện toast thành công (toàn bộ / phần chọn).
  - [ ] SQL lỗi cú pháp (sql-formatter ném lỗi): toast lỗi, nội dung giữ nguyên.
  - [ ] Format là một bước undo (Ctrl+Z quay về trước khi format).

### R8: Ctrl+F — hộp thoại Find / Replace
- **Mô tả:** Ctrl+F (khi editor focus) mở dialog có ô **Find** và các nút **Find**, **Replace**, **Cancel**. Bấm **Replace** lần đầu thì hiện thêm ô nhập chuỗi thay thế; khi ô đó đã hiện thì có nút **Replace** (thay kết quả đang chọn rồi chọn kết quả kế tiếp) và **Replace all**.
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** tab SQL
- **Tiêu chí chấp nhận:**
  - [ ] Dialog không chặn editor (vẫn nhìn thấy kết quả được chọn), đặt ở góc trên editor, thuộc riêng tab đang mở.
  - [ ] Đang tô đen một đoạn khi nhấn Ctrl+F thì đoạn đó điền sẵn vào ô Find.
  - [ ] Find: chọn và cuộn tới kết quả kế tiếp sau con trỏ, hết thì quay lại đầu; hiện số kết quả (ví dụ `2/5`); không có kết quả thì báo "không tìm thấy".
  - [ ] Replace / Replace all thay đúng chuỗi, mỗi lần là một bước undo; Replace all báo số chỗ đã thay.
  - [ ] Cancel hoặc Esc đóng dialog và trả focus về editor.
  - [ ] Footer theo quy ước modal: Cancel (`color="red"`) bên trái, các nút hành động bên phải, `Group p="8px" justify="space-between" wrap="nowrap"`.

### R9: Ctrl+E — thực thi SQL
- **Mô tả:** Thực thi chưa có backend nên chỉ hiện toast.
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** tab SQL
- **Tiêu chí chấp nhận:**
  - [ ] Tô đen một phần + Ctrl+E: toast chứa tên profile và **phần tô đen**.
  - [ ] Không tô đen + Ctrl+E: toast chứa tên profile và **toàn bộ** câu SQL (giống nút Execute).
  - [ ] Chưa chọn profile: Ctrl+E hiện toast cảnh báo "chưa chọn profile", không làm gì khác.
  - [ ] Nội dung rỗng (hoặc chỉ khoảng trắng): toast cảnh báo, không "thực thi".

### R10: Cỡ giao diện trong Settings (thêm 2026-11-12)
- **Mô tả:** Settings có thêm mục **Cỡ giao diện** với 3 mức `small`, `medium`, `large` (mặc định `medium`), phóng to/thu nhỏ **mọi component** của app (cả S3 lẫn SQL). Hoạt động như theme/font: chọn là preview ngay, Apply/Save/Reset/Huỷ như các setting khác, lưu trong `settings.json`.
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** `SettingModal`, toàn app
- **Ngoại lệ so với nguyên tắc sprint:** R10 có sửa **backend Go** (`internal/modules/setting`, `models/setting`) và **code S3** (các chiều cao px cố định) — người dùng đồng ý khi thêm yêu cầu.
- **Tiêu chí chấp nhận:**
  - [ ] Cách scale (người dùng chốt): đặt `font-size` của `<html>` trong `applySettings`; Mantine tính kích thước theo rem nên mọi component co giãn theo. Tỉ lệ: small 87.5% (14px), medium 100% (16px, giữ y giao diện hiện tại), large 112.5% (18px). Chỉ ghi style khi giá trị đổi (như font), không re-render React.
  - [ ] Chỗ dùng px cố định cũng co giãn theo (người dùng chốt): `LIST_ROW_HEIGHT`, `ROW_HEIGHT` của `UploadFileList`, `estimateSize` của các danh sách virtualize (bucket, object, history, delete, upload...), cỡ chữ SQL editor (`FONT` trong `sqlEditorTheme.ts`), và các chỗ khác planner tìm được. Đổi cỡ thì virtualizer đo lại, không chồng/hở hàng.
  - [ ] Go: thêm field `size` (json `size`) vào model settings input/output, danh sách hợp lệ `small|medium|large`, `sanitize` giá trị lạ về `medium`, `validate` từ chối giá trị lạ; file `settings.json` cũ không có `size` mở ra là `medium`. Sinh lại bindings.
  - [ ] FE: thêm `size` vào `AppSettingValues`, `DEFAULT_SETTINGS`, `normalizeSettings`; control trong `SettingModal` là **`Slider` của Mantine** (người dùng chốt 2026-11-12), bọc lại thành wrapper trong `components/inputs/` theo quy ước bọc component Mantine. Slider có 3 nấc cố định (small / medium / large, `step` 1, `marks` hiện nhãn từng nấc, chỉ dừng ở nấc, không có giá trị lẻ); kéo hoặc dùng phím mũi tên đều đổi cỡ và preview ngay. Nhãn đủ 7 ngôn ngữ.
  - [ ] Ở cả 3 mức: không tràn/cắt chữ bất thường ở navbar, header, dải tab, hàng bucket/object, modal; cửa sổ Downloader/Uploader cũng theo cỡ đã chọn.
  - [ ] Test hồi quy Go (`sanitize`, `validate`, đọc/ghi settings) và FE (`settingUtils`, `settingStore`, `SettingModal`, các danh sách đã đổi), C1 ≥ 95%.

## Ngoài phạm vi
- Backend Go (`internal/modules/db`), Rust `s3b_db.dll`, kết nối DB thật, lưu profile DB vào SQLite, mã hoá password.
- Import/export profile DB ra file, hộp thoại chọn file SQLite (chỉ toast).
- Bảng kết quả truy vấn, lưu/mở file `.sql`, khôi phục tab SQL sau khi tắt app, lịch sử câu lệnh, autocomplete tên bảng/cột lấy từ DB thật (sprint này chỉ dùng schema mock, xem R6).
- MongoDB (không phải SQL).
- Tách component dùng chung giữa S3 và SQL (người dùng chọn bản SQL riêng).
- Tài liệu (README, user guide 7 ngôn ngữ): làm khi có backend.

## Ràng buộc / ghi chú
- Chuỗi UI (nhãn, tooltip, toast, lỗi validate) đủ **7 ngôn ngữ**, namespace mới đăng ký trong `resource.ts` cả 7 ngôn ngữ. Nhãn giống S3 thì dịch giống S3.
- Mọi hàm trong component bọc `useCallback`; selector zustand hẹp; state SQL nằm trong store (`createAppStore`) để giữ khi chuyển chế độ.
- Hiệu năng: toàn bộ chế độ SQL (cùng CodeMirror và `sql-formatter`) **lazy load**, chỉ tải khi chọn SQL lần đầu, để không tăng thời gian khởi động app; format vài nghìn dòng không làm treo UI rõ rệt.
- Toast dùng `sonner`; nội dung SQL trong toast dài thì cắt ngắn.
- Toast "chưa có backend" và mock profile là code tạm: đặt ở chỗ dễ tìm, ghi comment để sprint backend thay thế.
- Chép code từ S3 thì chép kèm các bài học đã có (memory mục 3: `key` khác nhau cho Button trong ternary, menu mount khi mở, kiểm `signal.aborted`...).
- Test FE C1 ≥ 95% từng file đã đổi/mới; jsdom không có layout thật nên CodeMirror cần mock hoặc test qua API `EditorView` — ghi rõ nhánh không test được. Chạy toàn bộ `vitest run` để chắc S3 không bị hồi quy (nhất là `MainLayout`).
- Chỉ build Windows: phím tắt dùng Ctrl (không cần Cmd).

## Câu hỏi đã biết
- Đã chốt 2026-11-10 (người dùng chọn qua poll):
  - SegmentedControl trên header đổi toàn bộ thân app.
  - Chế độ SQL giống S3 cả navbar + tab + header, có modal tạo/sửa profile lưu trong RAM.
  - Viết bản SQL riêng, không tách component chung với S3.
  - CodeMirror 6 + sql-formatter, UI khớp Mantine; có profile mock.
  - Ctrl+Q format thật, Execute/Ctrl+E chỉ hiện toast.
  - Find = Find next + Replace/Replace all.
  - Chưa chọn profile thì Ctrl+E cảnh báo; dialect format theo DB của profile.
- Execute/Ctrl+E chỉ cần **đã chọn profile** (theo yêu cầu gốc) hay cần **đã Connect** như các nút bên S3? Đề xuất: giữ yêu cầu gốc, chỉ cần chọn profile; planner hỏi lại nếu thấy lệch với "giống S3".
- Chế độ S3/SQL đang chọn có cần nhớ sau khi tắt app (lưu `settings.json`) không? Đề xuất: không, luôn mở ở S3.
- Hai tab SQL có được chọn cùng một profile không? Đề xuất: được (như S3), vì sau này mỗi tab dùng connection riêng (CLAUDE.md mục 8).
- Mở chế độ SQL lần đầu có sẵn 1 tab trống không? Đề xuất: có, như S3.
- Danh sách trường PostgreSQL/SQLite ở R3 là đề xuất; planner xác nhận với người dùng (ví dụ có cần schema mặc định, timeout, SSL cert).
- Find có phân biệt hoa/thường không? Đề xuất: không phân biệt, chưa có tuỳ chọn.
- Planner kiểm lại Ctrl+E/Ctrl+F có bị WebView2 hoặc Wails chặn trước khi tới JS không.
