# Sprint 20: Tối ưu RAM

## Mục tiêu
Giảm RAM app dùng khi chạy. Hiện app tốn ít RAM hơn Navicat nhưng nhiều hơn A5:SQL Mk-2 (Task Manager: 28.6 MB so với 20.4 MB). Sprint này đo trước để biết RAM nằm ở đâu, rồi tối ưu theo số đo. Code nào chuyển sang Rust mà đo thấy giảm RAM thật thì chuyển.

Việc cũ của sprint-20 (nối 6 DB mạng, Commit dữ liệu bảng, known issues, tài liệu SQL) chuyển sang `sprints/sprint-21/requirement.md`.

## Yêu cầu

### R1: Đo RAM nền
- **Mô tả:** Viết script đo RAM chạy lại được và ghi số đo nền đầu sprint. Số này dùng làm mốc cho R2.
- **Nền tảng:** app desktop Windows (bản release, không chạy dưới debugger)
- **Màn hình liên quan:** toàn app
- **Tiêu chí chấp nhận:**
  - [ ] Đo **Private Working Set của cả cây process**: process Go và mọi process WebView2 (`msedgewebview2.exe`) con của app, không chỉ dòng nhóm trên Task Manager. Ghi riêng từng phần: Go heap/runtime, DLL Rust, WebView2 (browser, renderer, GPU), JS heap.
  - [ ] Các kịch bản đo: (a) mở app idle ở chế độ S3, chưa kết nối; (b) kết nối S3/MinIO, list bucket có 10.000 object; (c) đang upload/download nhiều file; (d) chế độ SQL SQLite chạy truy vấn 10.000 dòng; (e) mở 5 tab rồi đóng hết, xem RAM có trả lại không; (f) để app chạy 30 phút sau các kịch bản trên.
  - [ ] Ghi số đo vào báo cáo sprint, kèm cách chạy lại script.
  - [ ] Có số đo A5:SQL Mk-2 và Navicat đo cùng cách (cả cây process) để so sánh.

### R2: Tối ưu theo số đo
- **Mô tả:** Từ số đo của R1, chọn các chỗ tốn RAM nhất để tối ưu. Planner đề xuất danh sách cụ thể sau khi có số đo. Các hướng đã biết:
  - Chỉ nạp `s3b_db.dll` và runtime tokio khi vào chế độ SQL lần đầu, không nạp lúc khởi động.
  - Đặt giới hạn bộ nhớ và GC cho Go (`debug.SetMemoryLimit`, `GOGC`).
  - Bớt các bản sao dữ liệu lớn qua lại Rust ↔ Go ↔ JS (JSON kết quả, danh sách object).
  - Giảm heap JS: cache store zustand, danh sách không virtualize, dữ liệu tab đã đóng chưa giải phóng.
  - Giải phóng kết quả, cursor, connection khi đóng tab hoặc ngắt kết nối.
  - Tham số WebView2 (ví dụ tắt tính năng không dùng) nếu Wails v3 cho phép (tra https://v3.wails.io/).
  - Chuyển phần Go sang Rust **chỉ khi** đo thấy giảm RAM thật. Runtime Go vẫn chạy, nên chuyển code không tự làm giảm RAM nền.
- **Nền tảng:** cả S3 (AWS S3, MinIO) và chế độ SQL
- **Màn hình liên quan:** tuỳ kết quả đo
- **Tiêu chí chấp nhận:**
  - [ ] Mỗi kịch bản của R1 giảm RAM theo % so với số đo nền. Planner chốt % sau khi có số đo R1 và hỏi người dùng duyệt.
  - [ ] Mỗi thay đổi kèm số đo trước/sau ở đúng kịch bản bị ảnh hưởng.
  - [ ] Không làm chậm thao tác: `elapsedMs` trang 10.000 dòng vẫn đạt mục tiêu ở `CLAUDE.md` mục 8; list 10.000 object không chậm hơn số đo nền.
  - [ ] Hành vi cũ không đổi: test hồi quy theo `CLAUDE.md` mục 10.

### R3: Giảm RAM khi app idle (ưu tiên)
- **Mô tả:** Khi app idle (không có thao tác hay tác vụ nào đang chạy), RAM hiện đang quá cao. Đây là trạng thái người dùng để app chạy lâu nhất, nên được ưu tiên khi chọn việc tối ưu ở R2. Các trạng thái idle cần đo và giảm:
  - (i1) vừa mở app, chưa kết nối (kịch bản (a) của R1);
  - (i2) đã kết nối S3/MinIO hoặc DB, đã xem dữ liệu rồi để yên;
  - (i3) sau khi đóng hết tab hoặc ngắt kết nối (RAM phải trả lại gần mức i1);
  - (i4) cửa sổ thu nhỏ hoặc chạy nền.
- **Các hướng đã biết** (planner kiểm và chọn theo số đo):
  - Go trả bộ nhớ thừa cho OS khi rảnh (ví dụ `debug.FreeOSMemory` sau một khoảng không có thao tác, `SetMemoryLimit`).
  - Rust giải phóng buffer, cursor, connection không dùng; không giữ runtime tokio khi chưa vào chế độ SQL.
  - WebView2 giảm mức dùng bộ nhớ khi cửa sổ thu nhỏ hoặc chạy nền (`MemoryUsageTargetLevel = Low` nếu Wails v3 cho dùng, tra https://v3.wails.io/).
  - FE xoá dữ liệu của tab đã đóng và cache store không còn dùng.
- **Nền tảng:** cả S3 (AWS S3, MinIO) và chế độ SQL
- **Màn hình liên quan:** toàn app
- **Tiêu chí chấp nhận:**
  - [ ] Có số đo nền và sau tối ưu cho cả 4 trạng thái i1–i4 (cả cây process, cách đo theo R1).
  - [ ] RAM ở i1–i4 giảm theo % so với số đo nền. Planner chốt % sau R1 và hỏi người dùng duyệt; mức giảm ở idle là mục tiêu chính của sprint.
  - [ ] i3: RAM sau khi đóng hết tab hoặc ngắt kết nối không cao hơn i1 quá mức planner đề xuất.
  - [ ] Quay lại từ idle hoặc từ trạng thái thu nhỏ không chậm thấy rõ (planner đề xuất ngưỡng thời gian).

## Ngoài phạm vi
- Viết lại toàn bộ backend bằng Rust hoặc chuyển sang framework khác (bỏ Go, bỏ Wails).
- Thay WebView2 bằng UI native.
- Các việc chuyển sang sprint-21.

## Ràng buộc / ghi chú
- App gồm process Go (có `s3b_db.dll` nạp trong cùng process) và các process WebView2. Dòng nhóm trên Task Manager chưa chắc đã gồm hết các process WebView2, nên số 28.6 MB cần đo lại theo R1.
- A5:SQL Mk-2 là app native, không có trình duyệt nhúng. Mục tiêu sprint là giảm theo %, không đặt mục tiêu thấp hơn A5:SQL Mk-2.
- Đo bằng bản release, đóng các app khác nếu có thể, đo mỗi kịch bản ít nhất 3 lần rồi lấy trung vị.
- Theo `CLAUDE.md` mục 4 luật 9 và mục 8: ưu tiên hiệu năng, mọi việc với DB người dùng vẫn do Rust làm.

## Câu hỏi đã biết
- Script đo dùng công cụ gì (PowerShell `Get-Process`/`Get-CimInstance`, Performance Counter, hay VMMap/`procdump`) và có chạy được trong CI không.
- Mức giảm % cho từng kịch bản (chốt sau R1).
- Nạp DLL lười có làm lần đầu vào chế độ SQL chậm thấy rõ không, có cần nạp nền sau khi app khởi động xong không.
- Có giới hạn bộ nhớ Go (`SetMemoryLimit`) cố định hay theo RAM máy.
- R3: sau bao lâu không thao tác thì coi là idle để trả bộ nhớ cho OS.
