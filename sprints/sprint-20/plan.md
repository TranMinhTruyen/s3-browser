# Plan sprint-20

> Sprint chia **3 giai đoạn**:
> 1. **Đo nền (R1)**: viết script đo, build bản release, đo kịch bản a–f và i1–i4, đo A5:SQL Mk-2 và Navicat cùng cách.
> 2. **Dừng để người dùng duyệt**: orchestrator đưa bảng số đo, planner cập nhật plan này (chốt % giảm từng kịch bản, danh sách tối ưu cụ thể của R2/R3, bỏ hoặc thêm task) rồi hỏi người dùng duyệt.
> 3. **Tối ưu (R3 trước, rồi R2)**: chỉ làm các task đã được duyệt ở giai đoạn 2.
>
> Task của giai đoạn 3 (N1, N2, B3–B6, F1, F2) dưới đây là **phác thảo theo các hướng đã biết**. Chúng chưa được chốt và sẽ được viết lại sau khi có số đo. Không bắt đầu task nào của giai đoạn 3 trước khi người dùng duyệt số đo.

## 1. Tóm tắt yêu cầu
- R1: Script đo RAM chạy lại được. Đo Private Working Set của **cả cây process** (process Go có nạp `s3b_db.dll`, cùng mọi process `msedgewebview2.exe` con cháu của app), ghi riêng Go heap/runtime, DLL Rust, WebView2 (browser, renderer, GPU, utility) và JS heap. Đo 6 kịch bản a–f trên bản release, mỗi kịch bản 3 lần lấy trung vị. Đo A5:SQL Mk-2 và Navicat cùng cách. Số đo ghi vào báo cáo sprint kèm cách chạy lại.
- R2: Tối ưu những chỗ tốn RAM nhất theo số đo. Mỗi thay đổi có số đo trước/sau, không làm chậm (`elapsedMs` trang 10.000 dòng vẫn đạt mục 8 của `CLAUDE.md`, list 10.000 object không chậm hơn số đo nền) và không đổi hành vi.
- R3 (ưu tiên): Giảm RAM ở 4 trạng thái idle: i1 vừa mở, i2 đã xem dữ liệu rồi để yên, i3 sau khi đóng hết tab hoặc ngắt kết nối (phải về gần i1), i4 cửa sổ thu nhỏ hoặc chạy nền. Quay lại từ idle hoặc từ thu nhỏ không được chậm thấy rõ.

### Hiện trạng đã kiểm trong code
- **DLL Rust đã được nạp lười.** `internal/modules/db/module.go:88-91` (`NewModule`) chỉ tạo `newSubmoduleNativeMng(logger, loadNative)`. `submodule_native_mng.go:73-86` (`get`) chỉ gọi `loadNative` ở lần gọi native đầu tiên. Lần gọi đó là `open`, khi Connect profile SQLite (`submodule_conn_mng.go:98`). `s3b_init` tạo runtime tokio ở `rust/src/runtime.rs:16-28`, được gọi trong `loadNative` (`native_windows.go:47`). Như vậy ở i1, và kể cả khi đã sang chế độ SQL mà chưa Connect, DLL và tokio chưa được nạp. Điều này cần R1 xác nhận bằng số đo. Khi đã nạp thì DLL và runtime ở lại tới lúc thoát app: không có `FreeLibrary` và không có shutdown runtime.
- **Runtime tokio** là `new_multi_thread()` với số worker mặc định bằng số core (`runtime.rs:20-24`). Rust dùng allocator hệ thống, không có `#[global_allocator]` (`rust/Cargo.toml`, `rust/src`).
- **Workspace FE đã tách chunk.** S3 và SQL nạp bằng `lazy(import())` (`components/layouts/MainLayout.tsx:29-56`). Workspace đã vào thì giữ mount bằng `display: none` (dòng 151-161), nên vào SQL một lần là JS heap của SQL ở lại.
- **List object có phân trang** (200 rồi 1.000 mỗi trang, `pages/s3/hooks/useObjectPaging.ts:9-10`), nhưng các trang được nối dần vào state `objectDatas` (dòng 101-107). Tab S3 bị ẩn vẫn giữ danh sách.
- **Đường kết quả SQL**: Rust cấp buffer, rồi Go copy một lần (`native_windows.go:70` `append(...)`), chuyển nguyên JSON ra FE (`submodule_query_mng.go:106-108`, `150`, `178`), sau đó Wails ghi response và JS parse. `FetchRows` với `All` bỏ giới hạn trang (`unlimited`, dòng 166-168), nên một lần Fetch all có thể tạo đỉnh RAM rất lớn.
- **Chưa có code nào về bộ nhớ hay idle**: grep không thấy `FreeOSMemory`, `SetMemoryLimit`, `visibilitychange`, `WindowMinimise`, `useIdle` trong `internal/`, `main.go`, `frontend/src`.
- **Wails v3.1.0 với WebView2.** https://v3.wails.io/ trả 403. Thông tin dưới đây đọc từ source tag `v3.1.0` trên GitHub, nên ghi là "đã xem source, chưa xác minh qua docs":
  - `application.WindowsOptions` có `EnabledFeatures`, `DisabledFeatures`, `AdditionalBrowserArgs` (`[]string`, áp cho mọi cửa sổ).
  - **Không có** option `MemoryUsageTargetLevel`, và không có accessor public tới `ICoreWebView2` (field `chromium` unexported). Thư mục `go-webview2/pkg/edge` không thấy `ICoreWebView2_19`. Listing có thể bị cắt nên điểm này **chưa xác minh** hoàn toàn.
  - Khi thu nhỏ cửa sổ, Wails đã gọi `chromium.Hide()` và phát `events.Windows.WindowMinimise`. Khi mở lại thì phát `WindowUnMinimise`/`WindowRestore`.
  - `main.go:106-111` gán đè cả `options.Windows` ở bản portable. Thêm browser args phải gộp vào nhánh này.

## 2. Câu hỏi chưa rõ
| # | Câu hỏi | Phương án | Đề xuất | Trả lời |
|---|---|---|---|---|
| Q1 | Sprint-20 có chia 3 giai đoạn (đo → dừng cho người dùng duyệt số đo và % giảm → tối ưu) không? | A (Recommended): Chia 3 giai đoạn. Chỉ R1 làm ngay; task R2/R3 được viết lại sau số đo<br>B: Làm luôn các tối ưu đã biết song song với đo; có thể tốn công vào chỗ không đáng | A | (chờ người dùng) |
| Q2 | Script đo RAM dùng công cụ gì, và có chạy trong CI không? | A (Recommended): PowerShell + WMI `Win32_PerfFormattedData_PerfProc_Process` (cột `WorkingSetPrivate`, đúng số Task Manager, không phụ thuộc ngôn ngữ Windows) + `Win32_Process` để dựng cây process; chỉ chạy tay trên máy local, không CI<br>B: Như A và thêm job CI Windows chỉ đo kịch bản (a); số đo CI dao động theo runner nên chỉ để tham khảo<br>C: Sysinternals VMMap/`procdump`; chi tiết tới từng vùng nhớ nhưng phải cài thêm, khó tự động | A | (chờ người dùng) |
| Q3 | Tách phần Go heap/runtime ra khỏi số đo của process Go bằng cách nào? | A (Recommended): Thêm probe nhỏ, chỉ bật khi có biến môi trường `S3B_MEMPROBE=<file>`: Go ghi `runtime/metrics` (tổng bộ nhớ runtime, heap, stack, phần đã trả OS) ra file mỗi 2 giây. Bản thường không có chi phí<br>B: Không đổi code, chạy app với `GODEBUG=gctrace=1,scavtrace=1` và redirect stderr. Chỉ có số heap lúc GC, không có tổng runtime; redirect stderr của app GUI chưa xác minh | A | (chờ người dùng) |
| Q4 | Tách phần DLL Rust ra khỏi process Go bằng cách nào? | A (Recommended): Lấy hiệu số: (Private WS process Go) − (tổng bộ nhớ runtime Go từ probe Q3), so trước và sau khi DLL được nạp. Không đổi code Rust; phần native của Wails/COM lẫn vào nhưng giữ cố định giữa các lần đo<br>B: Thêm allocator đếm byte trong Rust sau cargo feature `mem-probe` (giống `bench-timing`) và method `memStats`; số chính xác hơn nhưng phải build DLL riêng để đo | A | (chờ người dùng) |
| Q5 | Các kịch bản b–f chạy như thế nào? | A (Recommended): Bán tự động. Script mở app (bản release), chờ ổn định, nhắc người dùng làm từng bước rồi nhấn Enter, tự lấy mẫu và tính trung vị 3 lần. Người dùng chạy, vì cần thao tác UI, hộp thoại chọn file native, và A5:SQL Mk-2/Navicat cài trên máy<br>B: Tự động hoàn toàn bằng Playwright `connectOverCDP` vào WebView2. Nhiều code hơn; upload/download phải giả vì hộp thoại native không điều khiển được | A | (chờ người dùng) |
| Q6 | Nạp DLL lười: code hiện tại đã chỉ nạp `s3b_db.dll` + tokio ở lần Connect SQL đầu tiên. Có cần nạp sớm hơn không? | A (Recommended): Giữ nguyên (nạp ở lần Connect đầu). R1 đo thêm thời gian lần Connect đầu; nếu chậm hơn khoảng 300 ms thì mới xem lại<br>B: Nạp khi người dùng chuyển sang chế độ SQL lần đầu (FE gọi một binding warm-up); Connect đầu nhanh hơn nhưng vào SQL mà không Connect vẫn tốn RAM<br>C: Nạp nền ngay sau khi app khởi động xong; mất lợi ích RAM ở i1 | A | (chờ người dùng) |
| Q7 | Giới hạn bộ nhớ Go (`debug.SetMemoryLimit`) đặt thế nào? | A (Recommended): Không đặt mặc định, giữ `GOGC` 100. Giảm RAM idle bằng trả bộ nhớ khi idle (B4). Chỉ thêm limit nếu số đo b/c/d cho thấy đỉnh heap Go cao, và khi đó dùng giá trị cố định<br>B: Cố định (ví dụ 64–128 MiB, chốt sau đo); dễ dự đoán, GC chạy dày hơn khi gần limit<br>C: Theo RAM máy (ví dụ 1/16 RAM vật lý); máy nhiều RAM gần như không có tác dụng | A | (chờ người dùng) |
| Q8 | R3: không có thao tác bao lâu thì coi là idle để trả bộ nhớ cho OS? | A (Recommended): 60 giây không có thao tác chuột/phím. Cửa sổ thu nhỏ hoặc trang bị ẩn thì trả ngay. Mỗi đợt idle chỉ trả một lần<br>B: 30 giây; trả sớm hơn nhưng dễ trùng lúc người dùng chỉ đang đọc<br>C: 5 phút; ít ảnh hưởng nhưng i2 giảm chậm | A | (chờ người dùng) |
| Q9 | Ngưỡng i3 (sau khi đóng hết tab hoặc ngắt kết nối) so với i1 là bao nhiêu? | A (Recommended): i3 ≤ i1 + 10% (cả cây process, sau khi trả bộ nhớ idle). Không tính phần DLL + tokio nếu đã vào SQL, vì DLL không gỡ<br>B: i3 ≤ i1 + 5%; có thể phải gỡ DLL/runtime khi ngắt kết nối hết (rủi ro crash, xem Rủi ro 4)<br>C: i3 ≤ i1 + 20%; dễ đạt | A | (chờ người dùng) |
| Q10 | Ngưỡng "quay lại từ idle hoặc thu nhỏ không chậm thấy rõ" là bao nhiêu? | A (Recommended): Từ lúc restore cửa sổ tới khi UI vẽ xong ≤ 300 ms. Thao tác đầu tiên sau idle (cuộn list 10.000 object, mở tab) chậm hơn số đo nền không quá 100 ms<br>B: ≤ 500 ms và không quá 200 ms; dễ đạt hơn<br>C: ≤ 150 ms và không quá 50 ms; chặt, có thể phải bỏ trả bộ nhớ khi thu nhỏ | A | (chờ người dùng) |
| Q11 | Có dùng `EmptyWorkingSet`/`SetProcessWorkingSetSize(-1,-1)` khi thu nhỏ không? Cách này làm số Task Manager giảm mạnh nhưng chỉ đẩy trang ra standby/pagefile, bộ nhớ commit không đổi. | A (Recommended): Không dùng; chỉ dùng cách thật sự giải phóng (Go `FreeOSMemory`, Rust giải phóng buffer, WebView2 browser args)<br>B: Dùng khi cửa sổ thu nhỏ (i4); số i4 đẹp nhưng khi mở lại có page fault, có thể vượt ngưỡng Q10 | A | (chờ người dùng) |
| Q12 | Wails v3.1.0 không có API public cho WebView2 `MemoryUsageTargetLevel` (theo source v3.1.0, docs 403 nên chưa xác minh hết). Xử lý thế nào? | A (Recommended): Bỏ hướng này. Dựa vào `chromium.Hide()` mà Wails đã gọi khi thu nhỏ, cộng với `DisabledFeatures`/`AdditionalBrowserArgs` chốt theo số đo; ghi lại để xem khi Wails thêm API<br>B: Tự gọi COM qua vtable: cần con trỏ `ICoreWebView2` mà Wails không expose, phải fork hoặc dùng reflect/unsafe vào field unexported; dễ vỡ khi nâng Wails | A | (chờ người dùng) |
| Q13 | Chia branch và thứ tự làm R2, R3 thế nào? | A (Recommended): 3 branch, làm theo thứ tự R1 → R3 → R2 (R3 ưu tiên). Task GC/trim chỉ nằm ở R3, R2 không đụng lại<br>B: 3 branch theo đúng thứ tự R1 → R2 → R3<br>C: R1 một branch, gộp R2 + R3 một branch (cùng sửa `main.go`, `app.go`, ít conflict hơn nhưng PR lớn) | A | (chờ người dùng) |
| Q14 | Mức giảm % cho từng kịch bản a–f và i1–i4 | Chốt ở giai đoạn 2 sau số đo R1. Planner sẽ đề xuất % theo phần RAM có thể tác động được (Go, Rust, JS heap, cờ WebView2) và hỏi người dùng bằng poll | (sau R1) | (chờ số đo) |

## 3a. Task native (rust-native)
Toàn bộ task native thuộc giai đoạn 3 và là **phác thảo**, chỉ làm khi số đo cho thấy phần native (hiệu số ở Q4) đáng kể ở kịch bản d hoặc i2/i3.

| # | Task | Yêu cầu | File sửa / tạo | Phụ thuộc |
|---|---|---|---|---|
| N1 | (phác thảo) Giới hạn số worker tokio (ví dụ `min(số core, 4)`). Đo RAM d/i2 và `elapsedMs` trang 10.000 dòng trước/sau; nếu không giảm RAM thật thì bỏ | R2 | rust/src/runtime.rs (sửa) | Số đo R1 |
| N2 | (phác thảo) Method `trim`: giải phóng bộ nhớ Rust đang giữ mà không dùng. Gồm co buffer/cursor của connection đã đóng (nếu đo thấy còn giữ) và `HeapCompact(GetProcessHeap())` khi chưa xác định được nguồn cụ thể. Go gọi khi idle nếu DLL đã nạp | R3 | rust/src/dispatch.rs (sửa), rust/src/protocol/mod.rs (sửa nếu cần kiểu mới), rust/src/registry.rs (sửa nếu đo thấy registry giữ buffer) | Số đo R1 |

Hợp đồng JSON mới/đổi: (N2, dự kiến) method `trim`, params `{}`, response `{"ok":true,"result":{}}`, không có mã lỗi mới (lỗi bất ngờ dùng `internal`). Method này không cần `connId` và phải chạy được khi không có connection nào. | Crate mới: không (gọi `HeapCompact` qua `windows-sys` chỉ khi cần; chưa xác minh crate đó đã có sẵn qua dependency gián tiếp, nếu phải thêm vào `Cargo.toml` thì hỏi người dùng).

Dùng lại: `registry::global()` (đóng/huỷ connection), `runtime::get()`. | Hiệu năng: N1 không được làm tăng `elapsedMs` trang 10.000 dòng (mục 8: < 40 ms, nhắm < 20 ms, bản release). N2 chỉ chạy khi idle, mỗi đợt idle một lần, không chạy khi đang có request (`registry` còn request thì bỏ qua).

Test Rust (rust-tester):
| Task | Hàm / file cần test | Case cần phủ |
|---|---|---|
| N1 | rust/src/runtime.rs `init` | gọi 2 lần vô hại; runtime chạy được tác vụ async; số worker đúng giới hạn khi máy có nhiều/ít core (nếu tách hàm tính số worker) |
| N2 | rust/src/dispatch.rs (method `trim`), test qua hàm export ở rust/tests/*.rs | trim khi chưa có connection; trim sau khi open/close SQLite (file DB tạm); trim khi đang có request chạy thì bỏ qua và không huỷ request; params thừa hoặc thiếu vẫn ok; hồi quy: `open`/`execute`/`fetch`/`close` sau `trim` vẫn cho kết quả cũ (golden) |

## 3. Task backend (go-backend)
| # | Task | Yêu cầu | File sửa / tạo | Phụ thuộc |
|---|---|---|---|---|
| B1 | Script đo `test-env/mem-bench.ps1`. Tham số: đường dẫn exe hoặc tên process (để đo cả A5:SQL Mk-2, Navicat), kịch bản (`a`..`f`, `i1`..`i4`), số lần (mặc định 3). Script mở app với các biến môi trường đo; dựng cây process từ PID gốc qua `Win32_Process.ParentProcessId`; phân loại WebView2 theo `--type=` trong CommandLine (browser/renderer/gpu-process/utility); lấy `WorkingSetPrivate` từ `Win32_PerfFormattedData_PerfProc_Process`. Mỗi kịch bản lấy mẫu sau khi ổn định (mặc định 30 s, f = 30 phút) rồi tính trung vị 3 lần. Ghi CSV thô và bảng Markdown. JS heap đo ở **lần chạy riêng** có `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>` (loopback), đọc `Runtime.getHeapUsage` qua CDP bằng `System.Net.WebSockets.ClientWebSocket`, để cờ debug không làm sai số Private WS. Có phần hướng dẫn chuẩn bị dữ liệu: bucket 10.000 object (bằng `mc` trong container MinIO của test-env, chưa xác minh image có `mc`) và file SQLite 10.000 dòng (dùng lại cách tạo fixture của example `db_bench`, chưa xác minh) | R1 | test-env/mem-bench.ps1 (tạo) | - |
| B2 | Probe bộ nhớ Go (theo Q3=A). Khi có `S3B_MEMPROBE=<file>`, một goroutine ghi mỗi 2 giây một dòng JSON gồm `runtime/metrics`: `/memory/classes/total:bytes`, `/memory/classes/heap/objects:bytes`, `/memory/classes/heap/released:bytes`, `/memory/classes/heap/stacks:bytes`, `/gc/heap/goal:bytes`, và cờ DLL đã nạp. Không có biến thì không chạy gì. Dừng theo `app.Context()` | R1 | internal/pkg/memprobe/memprobe.go (tạo), main.go (sửa: gọi `memprobe.Start`), internal/modules/db/module.go + submodule_native_mng.go (sửa: hàm `Loaded() bool` để probe ghi cờ DLL) | - |
| B3 | (phác thảo) Thông số GC/bộ nhớ Go theo Q7, và cờ WebView2 (`DisabledFeatures`/`AdditionalBrowserArgs`, ví dụ tắt tính năng Edge không dùng, giới hạn renderer) chốt theo số đo. Gộp vào cả nhánh portable của `options.Windows` | R2 | main.go (sửa) | Số đo R1 |
| B4 | (phác thảo) Binding `TrimMemory`: `debug.FreeOSMemory()`, rồi gọi native `trim` (N2) **chỉ khi DLL đã nạp**. Không làm gì khi đang có truy vấn SQL chạy. Go tự gọi trim khi nhận `events.Windows.WindowMinimise`. Đặt trong module mới `internal/modules/system` + `handlers/system_handler.go`, vì không module hiện có nào hợp (setting/master là dữ liệu cấu hình); chốt lại ở giai đoạn 2 | R3 | internal/modules/system/module.go (tạo), internal/handlers/system_handler.go (tạo), internal/app.go (sửa), main.go (sửa: register service + `OnWindowEvent(WindowMinimise)`), internal/modules/db/module.go (sửa: `Trim(ctx)`), submodule_native_mng.go (sửa: gọi native mà không nạp DLL) | N2 (nếu có), Số đo R1 |
| B5 | (phác thảo, chỉ khi kịch bản d cho thấy đỉnh do copy) Bớt bản sao JSON trang kết quả Rust → Go → JS, ví dụ bỏ bước `append` copy ở `nativeLib.call` bằng cách giữ buffer Rust tới khi encode xong. Phải giữ đúng hợp đồng `s3b_free` | R2 | internal/modules/db/native_windows.go, submodule_native_mng.go, submodule_query_mng.go (sửa) | Số đo R1 |
| B6 | (phác thảo) Giới hạn đỉnh RAM của Fetch all (`FetchRowsInput.All`, `unlimited`), ví dụ trả theo nhiều trang lớn thay vì một trang. Chỉ làm khi người dùng đồng ý đổi hành vi, vì đây là đổi hành vi so với 21d683a | R2 | internal/modules/db/submodule_query_mng.go (sửa) | Số đo R1, câu hỏi bổ sung ở giai đoạn 2 |

Chọn Go hay Rust (mục 7 `CLAUDE.md`):
- B1: PowerShell, không thuộc app.
- B2: Go, vì chỉ đọc `runtime/metrics` của chính Go, việc nhẹ.
- B3, B4 phần Go: Go, vì là tham số runtime Go và Go phải tự trả heap của mình.
- Phần giải phóng bộ nhớ của DLL: Rust (N2), vì Go không thấy heap của Rust.
- B5, B6: giữ nguyên nguyên tắc "Go chỉ chuyển nguyên JSON", không xử lý dòng ở Go; nếu cần chia trang thì Rust làm.
- Chưa có ứng viên chuyển code Go sang Rust. Chỉ đề xuất ở giai đoạn 2 nếu số đo kịch bản b/c cho thấy heap Go chiếm phần lớn **và** phần đó chuyển được, vì runtime Go vẫn chạy nên RAM nền không giảm theo.

Message code mới: không (B4 lỗi thì chỉ log, không hiện cho người dùng). | Migration / sqlc: không | Cần sinh lại bindings: R1 không; R3 có (B4 thêm `SystemHandler.TrimMemory`).

Dùng lại: `submoduleNativeMng.get/mu/caller` (kiểm DLL đã nạp mà không nạp), `withCallContext`, `logger.With`, `app.Context()`; `events.Windows.WindowMinimise` theo cách `main.go:146` đã dùng `OnWindowEvent`. | Hiệu năng: probe B2 chỉ chạy khi có biến môi trường, đọc `metrics.Read` với slice cấp sẵn, 2 giây một lần. `FreeOSMemory` gây một lần GC STW, chỉ gọi một lần mỗi đợt idle, không gọi trên đường nóng. B5 phải giữ `elapsedMs` và thời gian FE nhận trang như số đo nền.

Test hồi quy Go (go-tester, test tạm):
| Task | Function sửa | Nơi gọi | Kịch bản hồi quy (hành vi cũ phải giữ) |
|---|---|---|---|
| B2 | internal/pkg/memprobe/memprobe.go: `Start` | main.go | không có `S3B_MEMPROBE` thì không tạo file, không goroutine; có biến thì ghi dòng JSON hợp lệ với đủ key; dừng khi ctx huỷ; đường dẫn không ghi được thì log, app vẫn chạy |
| B2 | internal/modules/db/submodule_native_mng.go: `Loaded` (mới), `get` | module.go, submodule_conn_mng.go, submodule_query_mng.go | `Loaded()` false trước lần gọi đầu, true sau `get` thành công, false khi nạp lỗi; `get` vẫn nạp lại sau lần lỗi (hành vi cũ), vẫn trả `loadError` (DBE009) |
| B3 | main.go: dựng `options.Windows` | main | bản portable vẫn giữ `WebviewBrowserPath`/`WebviewUserDataPath`; browser args có ở cả hai nhánh (kiểm qua hàm thuần tách ra, ví dụ `windowsOptions(portable bool)`) |
| B4 | internal/modules/system/module.go: `TrimMemory`; db/module.go: `Trim`; submodule_native_mng.go | system_handler.go, main.go (WindowMinimise) | DLL chưa nạp thì **không nạp DLL** và không gọi native; DLL đã nạp thì gọi `trim` đúng 1 lần (fake `nativeCaller`); đang có truy vấn thì bỏ qua; ctx huỷ thì im lặng; `callNativeRaw` và `failCall` cũ vẫn map lỗi như trước (DBE004/005/008/009/015) |
| B5 | native_windows.go: `call`; submodule_native_mng.go: `callNativeRaw`; submodule_query_mng.go: `execute`, `openTableRows`, `fetchRows` | db/module.go, db_handler.go | JSON trả ra FE giống byte-by-byte trước khi sửa (golden); `okPrefix` và nhánh lỗi giữ nguyên; buffer luôn được `s3b_free` đúng 1 lần ở mọi nhánh, kể cả lỗi |
| B6 | submodule_query_mng.go: `fetchRows` | db/module.go, db_handler.go | Fetch thường (không `All`) giữ `pageSize`/`maxPageBytes`/`queryTimeout`; tab đã đóng vẫn trả `closedMessage()` |

## 4. Task frontend (react-frontend)
| # | Task | Yêu cầu | File sửa / tạo | Phụ thuộc |
|---|---|---|---|---|
| F1 | (phác thảo) Phát hiện idle (Q8) và gọi `TrimMemory` một lần mỗi đợt idle: dùng `useIdle` của `@mantine/hooks` (chuột/phím/cuộn) và `useDocumentVisibility` (trang bị ẩn thì gọi ngay). Gắn một lần ở `MainLayout` | R3 | frontend/src/common/hooks/useIdleTrim.ts (tạo), frontend/src/components/layouts/MainLayout.tsx (sửa) | B4 |
| F2 | (phác thảo) Giảm JS heap theo số đo (heap snapshot qua CDP ở kịch bản b, d, e). Ứng viên: dữ liệu tab đã đóng còn bị giữ, state lớn của tab ẩn, cache store. Danh sách file chốt sau số đo | R2 | chưa xác định (chốt ở giai đoạn 2) | Số đo R1 |

i18n key mới (đủ 7 ngôn ngữ): không (F1 không có UI).

Dùng lại: `useIdle`, `useDocumentVisibility` (`@mantine/hooks`), `callIPC` với `showMessage` tắt. Không tạo hook idle tự viết. | Hiệu năng: `useIdle` lắng nghe event chuột/phím có sẵn của Mantine, không tự gắn listener `mousemove` mỗi component. Chỉ gọi IPC khi chuyển trạng thái (đang hoạt động → idle, hiện → ẩn), không gọi lặp theo timer.

Test frontend (react-tester):
| Task | File cần test | Case cần phủ |
|---|---|---|
| F1 | frontend/src/common/hooks/useIdleTrim.ts | chưa idle thì không gọi; idle đủ thời gian thì gọi đúng 1 lần; còn idle thì không gọi lại; có thao tác rồi idle lần nữa thì gọi lại; trang ẩn thì gọi ngay; trang ẩn rồi hiện rồi ẩn thì không gọi trùng trong cùng một đợt idle; unmount thì không gọi nữa; `callIPC` trả null vẫn không lỗi; fake timer chỉ giả `setTimeout`/`clearTimeout`/`Date` (memory mục 3) |
| F1 | frontend/src/components/layouts/MainLayout.tsx | hồi quy: chuyển S3/SQL, giữ workspace đã vào, retry khi chunk lỗi, nút Settings/History vẫn như cũ; hook idle được gắn đúng một lần |
| F2 | (theo file thực sửa) | hồi quy hành vi hiển thị và phân trang cũ; dữ liệu được giải phóng khi đóng tab hoặc ngắt kết nối |

## 5. Branch
Tên branch dưới đây chưa kiểm với remote, vì planner không có Bash. `git-flow` phải chạy `git ls-remote --heads origin 'SP-20/*'` trước khi tạo; memory không ghi branch `SP-20/*` nào từng có.

| Branch | Yêu cầu | Task | Ghi chú |
|---|---|---|---|
| SP-20/mem_baseline | R1 | B1, B2 | Giai đoạn 1. Không sinh lại bindings. Kết quả đo ghi vào `sprints/sprint-20/measurements.md` (+ CSV thô ở `sprints/sprint-20/mem/`), chỉ commit ở `SP-20/sprint_docs` |
| SP-20/idle_memory_trim | R3 | N2, B4, F1 | Giai đoạn 3, làm trước R2 nếu Q13=A. Task chốt lại sau số đo |
| SP-20/memory_tuning | R2 | N1, B3, B5, B6, F2 | Giai đoạn 3. Task chốt lại sau số đo; B3 và B4 cùng sửa `main.go` ở đoạn khác nhau, conflict nhỏ |

## 6. Thứ tự thực hiện (luôn tuần tự, xong branch này mới sang branch sau)
**Giai đoạn 1: đo nền**
1. Tách `SP-20/mem_baseline` từ `origin/SP-20/release` (release tạo một lần từ `origin/staging`; memory khuyên merge PR `SP-19/release` → `staging` (21d683a) trước).
2. Backend: B1, B2 → Go test hồi quy B2 (go-tester, test tạm, xoá sau khi chạy) → verify (chạy thử script ở kịch bản a trên bản release) → review → commit, push, PR vào `SP-20/release`.
3. Người dùng build bản release từ branch có B2, chuẩn bị dữ liệu, chạy `mem-bench.ps1` cho a–f, i1–i4 (3 lần mỗi kịch bản), cho A5:SQL Mk-2 và Navicat, và đo thời gian lần Connect SQL đầu (Q6). Số đo ghi vào `sprints/sprint-20/measurements.md`.

**Giai đoạn 2: dừng để người dùng duyệt**
4. Orchestrator gọi lại planner kèm số đo. Planner cập nhật plan: chốt % giảm từng kịch bản (Q14), chọn/bỏ N1, N2, B3–B6, F1, F2, viết hợp đồng native cuối cùng, câu hỏi mới (ví dụ B6 đổi hành vi Fetch all). Orchestrator hỏi người dùng duyệt (B3 của quy trình).

**Giai đoạn 3: tối ưu** (mỗi branch: tách từ `origin/SP-20/release` → native + rust-tester → backend → `go tool wails3 generate bindings -f "-tags=wailsgen" -clean=true -ts` → go-tester → frontend → react-tester → verify → review → commit, push, PR)
5. `SP-20/idle_memory_trim` (R3), mỗi thay đổi kèm số đo trước/sau ở i1–i4 bằng `mem-bench.ps1`.
6. `SP-20/memory_tuning` (R2), mỗi thay đổi kèm số đo trước/sau ở đúng kịch bản bị ảnh hưởng, cùng `elapsedMs` trang 10.000 dòng (`test-env/db-bench.ps1`) và thời gian list 10.000 object.

## 7. Rủi ro
| # | Rủi ro | Mức độ | Cách giảm thiểu |
|---|---|---|---|
| 1 | Số đo dao động mạnh (WebView2 tự điều chỉnh bộ nhớ, Windows trim working set, app khác chạy nền), nên mức giảm % không phân biệt được với nhiễu | high | Trung vị 3 lần, thời gian ổn định cố định trong script, ghi cả min/max; Private WS và JS heap đo ở các lần chạy riêng; cùng máy, cùng bản build cho trước và sau |
| 2 | Phần lớn RAM nằm ở WebView2 (browser/GPU/renderer) mà Wails v3.1.0 chỉ cho chỉnh qua browser args; Go/Rust/JS heap có thể chỉ chiếm phần nhỏ, % giảm đạt được thấp | high | Đo trước rồi mới chốt % (Q14); thử `DisabledFeatures`/args từng cái một kèm số đo; ghi rõ phần không tác động được |
| 3 | Cờ WebView2 (tắt GPU, giới hạn renderer...) làm chậm vẽ, cuộn list, hoặc hỏng tính năng (kéo thả, hộp thoại, OIDC mở trình duyệt) | medium | Mỗi cờ đo cả tốc độ cuộn list 10.000 object; test tay kéo thả, upload/download, SQL editor; không dùng cờ thay đổi bảo mật |
| 4 | Gỡ DLL/runtime tokio khi không còn connection (nếu muốn i3 ≈ i1) có thể crash: thread tokio còn sống, static rustls provider | high | Không đưa vào plan (Q9=A loại phần DLL khỏi ngưỡng i3); chỉ xét lại nếu người dùng chọn Q9=B |
| 5 | `FreeOSMemory` hay native `trim` chạy trong lúc upload/download hoặc truy vấn làm giật | medium | Chỉ gọi một lần mỗi đợt idle; Rust bỏ qua khi còn request; đo thời gian quay lại theo Q10 |
| 6 | `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` có thể bị bỏ qua hoặc ghi đè khi app tự đặt `AdditionalBrowserArgs` (B3), làm hỏng cách đo JS heap về sau (chưa xác minh) | medium | Kiểm trong B1 rằng cổng CDP mở được. Sau B3, script cho phép truyền thêm args qua probe env của app nếu cần |
| 7 | Remote debugging port mở trên bản release khi đo | medium | Chỉ bật qua biến môi trường do script đặt, chỉ loopback, chỉ ở lần chạy đo JS heap; không có code app bật cổng này |
| 8 | Phần "DLL Rust" chỉ là hiệu số (Q4=A), lẫn bộ nhớ native của Wails/COM | low | So trước/sau khi DLL nạp cùng một phiên; nếu cần chính xác thì chuyển Q4 sang B ở giai đoạn 2 |
| 9 | Agent không đo được (cần thao tác GUI, A5:SQL Mk-2/Navicat trên máy người dùng), nên giai đoạn 1 phụ thuộc người dùng chạy script | medium | Script bán tự động, có hướng dẫn từng bước; verifier chỉ chạy thử kịch bản a |
| 10 | Sprint có 11 task nếu giữ hết phác thảo (vượt khoảng 10), vòng review tốn chi phí | medium | Giai đoạn 2 cắt task không có số đo ủng hộ; nếu sau đo vẫn > 10 task, đề xuất chuyển R2 sang sprint-21 |
| 11 | B6 (Fetch all) đổi hành vi vừa thêm ở 21d683a | medium | Chỉ làm khi người dùng đồng ý ở giai đoạn 2 |
| 12 | Kịch bản f (30 phút × 3 lần × nhiều trạng thái) tốn thời gian người dùng | low | Script cho chạy f một lần sau a–e trong cùng phiên, lấy mẫu mỗi phút; trung vị tính trên 3 phiên |

## 8. Tiêu chí hoàn thành
- [ ] Unit test frontend đạt Branches (C1) và Lines ≥ 95% cho từng file đã đổi; toàn bộ `vitest run` qua, console sạch; test hồi quy Go (tạm) và `cargo test` (với `S3B_REQUIRE_DB=1` khi Docker chạy) đều qua.
- [ ] R1: Chạy `test-env/mem-bench.ps1 -Scenario a` trên bản release thì có bảng Private WS theo từng process (Go, WebView2 browser/renderer/gpu/utility) và tổng cây, kèm Go runtime/heap từ probe và JS heap từ lần chạy CDP.
- [ ] R1: `sprints/sprint-20/measurements.md` có trung vị 3 lần của a–f và i1–i4 cho S3Browser, có số A5:SQL Mk-2 và Navicat đo cùng script, có thời gian Connect SQL đầu, và có lệnh chạy lại.
- [ ] R1: Không có `S3B_MEMPROBE` thì app không tạo file probe và hành vi không đổi.
- [ ] Giai đoạn 2: người dùng đã duyệt % giảm từng kịch bản và danh sách task tối ưu (plan cập nhật).
- [ ] R3: Đo i1–i4 sau tối ưu, mỗi trạng thái giảm đúng % đã duyệt; i3 ≤ i1 + ngưỡng Q9; restore từ thu nhỏ và thao tác đầu sau idle trong ngưỡng Q10.
- [ ] R3: Để app idle quá ngưỡng Q8 thì `TrimMemory` được gọi đúng 1 lần (thấy trong probe: `heap/released` tăng). Chưa vào SQL thì DLL vẫn chưa nạp sau trim.
- [ ] R2: Mỗi thay đổi có số đo trước/sau ở kịch bản bị ảnh hưởng; `elapsedMs` trang 10.000 dòng SQLite (bản release) < 40 ms; list 10.000 object không chậm hơn số đo nền.
