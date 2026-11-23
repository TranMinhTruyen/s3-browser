# Plan sprint-20

> Sprint chia **3 giai đoạn** (Q1=A):
> 1. **Đo nền (R1)**: viết công cụ đo (script PowerShell + Playwright tự động, job CI Windows chỉ đo kịch bản a trên mọi PR vào `SP-*/release` và `staging`), build bản release và bản đo (`devtools`), đo kịch bản a–f và i1–i4 kèm số nền thời gian restore/thao tác đầu sau idle (Q21=B), đo A5:SQL Mk-2 và Navicat.
> 2. **Dừng để người dùng duyệt**: orchestrator đưa bảng số đo, planner cập nhật plan này (chốt % giảm từng kịch bản (Q14), danh sách tối ưu cụ thể của R3/R2, bỏ hoặc thêm task) rồi hỏi người dùng duyệt.
> 3. **Tối ưu (R3 trước, rồi R2, Q13=A)**: chỉ làm các task đã được duyệt ở giai đoạn 2.
>
> Người dùng đã duyệt triển khai **giai đoạn 1** (chỉ R1, dừng sau số đo). Task của giai đoạn 3 (N1, N2, B3–B6, F1, F2) dưới đây là **phác thảo**, sẽ viết lại sau khi có số đo. Không bắt đầu task nào của giai đoạn 3 trước khi người dùng duyệt số đo.

## 1. Tóm tắt yêu cầu
- R1: Công cụ đo RAM chạy lại được. Đo Private Working Set của **cả cây process** (process Go có nạp `s3b_db.dll`, cùng mọi process `msedgewebview2.exe` con cháu của app), ghi riêng Go heap/runtime, DLL Rust, WebView2 (browser, renderer, GPU, utility) và JS heap. Đo 6 kịch bản a–f trên bản release, mỗi kịch bản 3 lần lấy trung vị. Đo A5:SQL Mk-2 và Navicat cùng cách. Số đo ghi vào báo cáo sprint kèm cách chạy lại. Theo Q21=B, R1 đo luôn số nền cho ngưỡng Q10: thời gian restore từ thu nhỏ tới khi UI vẽ xong, và thao tác đầu sau idle (cuộn list 10.000 object, mở tab).
- R2: Tối ưu những chỗ tốn RAM nhất theo số đo. Mỗi thay đổi có số đo trước/sau, không làm chậm (`elapsedMs` trang 10.000 dòng vẫn đạt mục 8 của `CLAUDE.md`, list 10.000 object không chậm hơn số đo nền) và không đổi hành vi.
- R3 (ưu tiên): Giảm RAM ở 4 trạng thái idle: i1 vừa mở, i2 đã xem dữ liệu rồi để yên, i3 sau khi đóng hết tab hoặc ngắt kết nối (≤ i1 + 10%, không tính DLL + tokio, Q9=A), i4 cửa sổ thu nhỏ hoặc chạy nền. Quay lại từ idle hoặc thu nhỏ: restore ≤ 300 ms, thao tác đầu sau idle chậm hơn nền ≤ 100 ms (Q10=A; "nền" là số R1 đo theo Q21=B).

### Hiện trạng đã kiểm trong code
- **DLL Rust đã được nạp lười.** `internal/modules/db/module.go:88-91` (`NewModule`) chỉ tạo `newSubmoduleNativeMng(logger, loadNative)`. `submodule_native_mng.go:73-86` (`get`) chỉ gọi `loadNative` ở lần gọi native đầu tiên. Lần gọi đó là `open`, khi Connect profile SQLite (`submodule_conn_mng.go:98`). `s3b_init` tạo runtime tokio ở `rust/src/runtime.rs:16-28`, được gọi trong `loadNative` (`native_windows.go:47`). Như vậy ở i1, và kể cả khi đã sang chế độ SQL mà chưa Connect, DLL và tokio chưa được nạp. R1 xác nhận bằng số đo (cờ `dllLoaded` của probe B2). Khi đã nạp thì DLL và runtime ở lại tới lúc thoát app: không có `FreeLibrary` và không có shutdown runtime. Giữ nguyên cách nạp này (Q6=A); R1 đo thời gian Connect đầu.
- **Runtime tokio** là `new_multi_thread()` với số worker mặc định bằng số core (`runtime.rs:20-24`). Rust dùng allocator hệ thống, không có `#[global_allocator]`.
- **Workspace FE đã tách chunk.** S3 và SQL nạp bằng `lazy(import())` (`components/layouts/MainLayout.tsx:29-56`). Workspace đã vào thì giữ mount bằng `display: none` (dòng 151-161), nên vào SQL một lần là JS heap của SQL ở lại.
- **List object có phân trang** (200 rồi 1.000 mỗi trang, `pages/s3/hooks/useObjectPaging.ts:9-10`), nhưng các trang được nối dần vào state `objectDatas` (dòng 101-107). Tab S3 bị ẩn vẫn giữ danh sách.
- **Đường kết quả SQL**: Rust cấp buffer, rồi Go copy một lần (`native_windows.go:70` `append(...)`), chuyển nguyên JSON ra FE (`submodule_query_mng.go:106-108`, `150`, `178`), sau đó Wails ghi response và JS parse. `FetchRows` với `All` bỏ giới hạn trang (`unlimited`, dòng 166-168).
- **Chưa có code nào về bộ nhớ hay idle**: grep không thấy `FreeOSMemory`, `SetMemoryLimit`, `visibilitychange`, `WindowMinimise`, `useIdle` trong `internal/`, `main.go`, `frontend/src`.
- **Wails v3.1.0 với WebView2** (https://v3.wails.io/ trả 403; đã đọc source `github.com/wailsapp/wails/v3@v3.1.0` trong module cache Go):
  - `application.WindowsOptions` có `EnabledFeatures`, `DisabledFeatures`, `AdditionalBrowserArgs`; `setupChromium` (`pkg/application/webview_window_windows.go:2564-2605`) luôn thêm `--disable-features=msSmartScreenProtection` (gộp với `DisabledFeatures`), rồi `--enable-features=...` và `AdditionalBrowserArgs`, nối thành chuỗi truyền vào `CreateCoreWebView2EnvironmentWithOptions` (`internal/webview2/pkg/edge/chromium.go:263-264`). Nghĩa là chuỗi browser args của app **không bao giờ rỗng**.
  - **Tag `devtools` có thật (đã xác minh trong source).** `webview_window_windows_devtools.go` có build tag `windows && !server && (!production || devtools)`: `enableDevTools` gọi `settings.PutAreDevToolsEnabled(true)`, `openDevTools` mở cửa sổ DevTools. `webview_window_windows_production.go` (`production && !devtools`) gọi `PutAreDevToolsEnabled(false)`. Ngoài ra tag này chỉ đổi `menuitem_dev.go`/`roles_dev.go` (vai trò menu OpenDevTools). `isDebugMode` vẫn là `false` vì do `application_production.go` (`production`) quyết định, không phụ thuộc `devtools`. Vậy bản `-tags production,devtools` chỉ khác bản release ở cờ `AreDevToolsEnabled` và menu role.
  - **Chưa xác minh**: cổng `--remote-debugging-port` có mở được khi `AreDevToolsEnabled=false` (bản release thuần) hay không; và `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` **ghi đè** hay **nối thêm** vào chuỗi browser args app truyền (nếu ghi đè thì bản đo mất `--disable-features=msSmartScreenProtection`, xem Q23). Cách kiểm khi implement: B1a đọc `CommandLine` của process browser WebView2 ở cả hai chế độ (có/không env) và so danh sách switch; thử `http://127.0.0.1:<cổng>/json/version` trên bản release thuần và bản `devtools`.
  - **Không có** option `MemoryUsageTargetLevel` và không có accessor public tới `ICoreWebView2`. Bỏ hướng này (Q12=A).
  - Khi thu nhỏ, Wails gọi `chromium.Hide()` và phát `events.Windows.WindowMinimise`; mở lại phát `WindowUnMinimise`/`WindowRestore`.
  - `main.go:106-111` gán đè cả `options.Windows` ở bản portable. Thêm browser args phải gộp vào nhánh này.

### Hiện trạng cho công cụ đo (giai đoạn 1)
- **Playwright đã có** ở `docs/package.json` (`"playwright": "^1.64.1"`, devDependency), dùng cho `docs/scripts/shots.mjs` (`chromium.launch()` trên app server mode) và `evidence-xlsx.mjs`. Không cần cài lib mới: `connectOverCDP` không cần tải trình duyệt Playwright. `docs/node_modules` có thể chưa có (memory mục 3) thì chạy `bun install --cwd docs` theo lockfile. Script Playwright mới phải nằm dưới `docs/` để resolve được `playwright`.
- **Hộp thoại native**: upload chọn file qua `submodule_uploader_mng.go:58-65` (`pickPaths`). Download (`submodule_downloader_mng.go:103-112`): **nhiều object** mở hộp thoại chọn thư mục (`Dialog.OpenFile().CanChooseDirectories(true).CanChooseFiles(false)`), **một object** mở hộp thoại lưu (`Dialog.SaveFile().SetFilename(...)`). Playwright không điều khiển được cả hai. Upload giả được bằng đường thả file: Go phát event `EventFilesDropped` với `FilesDroppedOutput` (`submodule_uploader_drop.go:50-73`), FE nhận rồi gọi binding `UploadObject` thật; script tiêm cùng event qua `window._wails.dispatchWailsEvent` như `shots.mjs:334` đã làm, nên upload là **truyền dữ liệu thật**, chỉ bước thả file là giả. Download: điền hộp thoại bằng UI Automation (Q15=A), không sửa app.
- **Nút thu nhỏ**: `components/layouts/window/WindowControls.tsx:35` gọi `Window.Minimise()`; Playwright bấm nút này là đúng đường người dùng.
- **Cách ly dữ liệu**: bản không portable lưu DB/log/setting ở `os.UserConfigDir()` (`internal/pkg/portable/portable_off.go:17`), trên Windows là `%APPDATA%`. Thư mục user data của WebView2 **cũng theo `APPDATA`** (đã xác minh trong source): bản không portable để trống `WebviewUserDataPath` (`main.go:58` chỉ đặt ở bản portable), và `chromium.go:241-250` khi `DataPath` rỗng dùng `filepath.Join(os.Getenv("AppData"), "<tên exe>")`, tức `%APPDATA%\S3Browser.exe`. Script đặt `APPDATA=<thư mục tạm>` cho riêng process app là cách ly được cả DB app lẫn profile WebView2; vẫn kiểm `--user-data-dir=` trong CommandLine của process browser để chắc.
- **MinIO test-env có `mc`**: healthcheck của `minio/minio:RELEASE.2025-04-22T22-12-26Z` gọi `mc ready local` (`test-env/docker-compose-minio.yml:21`), nên tạo bucket 10.000 object bằng `docker exec s3b-test-minio ... mc` được, không cần cài thêm.
- **SQLite 10.000 dòng**: ô `filePath` của `DbProfileModal.tsx:216-231` nhập tay được. Script tạo file rỗng, tạo profile, rồi tạo bảng bằng SQL `WITH RECURSIVE` ngay trong app. File 0 byte mở được bằng SQLite là hành vi chuẩn; với driver của app thì **chưa xác minh**. File này dùng lại cho A5:SQL Mk-2/Navicat (Q17).
- **Build**: task `windows:build` (`build/windows/Taskfile.yml:18-32`) nhận `EXTRA_TAGS` và `OUT_DIR`; `build:native` dựng `-tags production,<EXTRA_TAGS>` (dòng 89), ghi exe ra `OUT_DIR` (mặc định `BIN_DIR`, dòng 83) và `common:copy:dll` copy DLL vào cùng `OUT_DIR` (dòng 72-75). Lệnh bản đo dự kiến: `go tool wails3 task windows:build EXTRA_TAGS=devtools OUT_DIR=build/bin/bench` (cách truyền biến dạng `KEY=value` qua `wails3 task` **chưa xác minh**; không được thì dùng `task` trực tiếp hoặc biến môi trường). CI hiện chỉ có `release.yml`, `pre-release.yml` (runner `windows-latest`, setup Go/bun/Rust + `Swatinem/rust-cache`, build bằng `go tool wails3 task windows:package`).

## 2. Câu hỏi chưa rõ
| # | Câu hỏi | Phương án | Đề xuất | Trả lời |
|---|---|---|---|---|
| Q1 | Sprint-20 có chia 3 giai đoạn (đo → dừng cho người dùng duyệt số đo và % giảm → tối ưu) không? | A: Chia 3 giai đoạn. Chỉ R1 làm ngay; task R2/R3 được viết lại sau số đo<br>B: Làm luôn các tối ưu đã biết song song với đo | A | A |
| Q2 | Script đo RAM dùng công cụ gì, và có chạy trong CI không? | A: PowerShell + WMI, chỉ chạy tay local<br>B: Như A và thêm job CI Windows chỉ đo kịch bản (a); số CI chỉ tham khảo<br>C: Sysinternals VMMap/`procdump` | A | **B** (khác đề xuất): PowerShell + WMI (`WorkingSetPrivate`, cây process qua `Win32_Process`), chạy tay local và thêm job CI Windows chỉ đo (a) |
| Q3 | Tách phần Go heap/runtime bằng cách nào? | A: Probe qua env `S3B_MEMPROBE=<file>`, `runtime/metrics` mỗi 2 giây<br>B: `GODEBUG=gctrace=1,scavtrace=1` | A | A |
| Q4 | Tách phần DLL Rust bằng cách nào? | A: Hiệu số (Private WS process Go − tổng runtime Go), không đổi code Rust<br>B: Allocator đếm byte trong Rust | A | A |
| Q5 | Các kịch bản b–f chạy như thế nào? | A: Bán tự động, người dùng thao tác rồi nhấn Enter<br>B: Tự động hoàn toàn bằng Playwright `connectOverCDP` vào WebView2; upload/download phải giả | A | **B** (khác đề xuất): tự động hoàn toàn; xử lý ảnh hưởng của cổng CDP lên Private WS (xem B1a mục "Sai số CDP") |
| Q6 | Nạp DLL lười: có cần nạp sớm hơn không? | A: Giữ nguyên (nạp ở lần Connect đầu), R1 đo thời gian Connect đầu<br>B: Nạp khi vào chế độ SQL<br>C: Nạp nền sau khởi động | A | A |
| Q7 | Giới hạn bộ nhớ Go (`debug.SetMemoryLimit`)? | A: Không đặt mặc định, giữ `GOGC` 100<br>B: Cố định<br>C: Theo RAM máy | A | A |
| Q8 | R3: không thao tác bao lâu thì coi là idle? | A: 60 giây<br>B: 30 giây<br>C: 5 phút | A | **C** (khác đề xuất): idle = 5 phút không thao tác; thu nhỏ/trang ẩn thì trả ngay; mỗi đợt idle trả một lần |
| Q9 | Ngưỡng i3 so với i1? | A: i3 ≤ i1 + 10%, không tính DLL + tokio<br>B: + 5%<br>C: + 20% | A | A |
| Q10 | Ngưỡng quay lại từ idle/thu nhỏ? | A: restore ≤ 300 ms, thao tác đầu sau idle chậm hơn nền ≤ 100 ms<br>B: 500/200 ms<br>C: 150/50 ms | A | A |
| Q11 | Có dùng `EmptyWorkingSet` khi thu nhỏ không? | A: Không dùng<br>B: Dùng khi thu nhỏ | A | A |
| Q12 | WebView2 `MemoryUsageTargetLevel` không có API public trong Wails v3.1.0 | A: Bỏ hướng này<br>B: Tự gọi COM qua vtable | A | A |
| Q13 | Chia branch và thứ tự làm R2, R3? | A: 3 branch, thứ tự R1 → R3 → R2<br>B: R1 → R2 → R3<br>C: R1 một branch, gộp R2 + R3 | A | A |
| Q14 | Mức giảm % cho từng kịch bản a–f và i1–i4 | Chốt ở giai đoạn 2 sau số đo R1, hỏi bằng poll | (sau R1) | (chờ số đo) |
| Q15 | Kịch bản c: giả bước hộp thoại native của download thế nào? | A: UI Automation trong `mem-bench.ps1`, không sửa app; lỗi thì c chỉ đo upload<br>B: Env chỉ dùng khi đo để bỏ qua hộp thoại<br>C: Bỏ download khỏi R1 | A | A: PowerShell UI Automation điền hộp thoại của download, không sửa app; lỗi thì kịch bản c chỉ đo upload |
| Q16 | Job CI Windows đo kịch bản (a) chạy khi nào? | A: Chỉ `workflow_dispatch`<br>B: Mọi PR vào `SP-*/release` và `staging`<br>C: Theo lịch hằng tuần | A | **B** (khác đề xuất): mọi PR vào `SP-*/release` và `staging`; ghi rõ thời gian/chi phí, `concurrency` huỷ lượt cũ (xem B1c) |
| Q17 | A5:SQL Mk-2 và Navicat đo kịch bản nào? | A: a, d, e-sql, f bán tự động; b, c N/A<br>B: Chỉ a và d<br>C: Như A và thêm i4 | A | A |
| Q18 | Kịch bản e "mở 5 tab rồi đóng hết" là tab gì? | A: 5 tab S3<br>B: 5 tab SQL<br>C: Cả hai, ghi riêng e-s3 và e-sql | C | C |
| Q19 | Một lần đo (run) gồm các kịch bản thế nào? | A: Một phiên nối tiếp a → … → f, lặp 3 phiên<br>B: Mỗi kịch bản một lần mở app | A | A |
| Q20 | Bản release không mở được cổng CDP thì làm thế nào? | A: Build bản đo với tag `devtools`, a đo cả hai bản, hiệu số làm sai số<br>B: Bán tự động cho b–f<br>C: Env trong app bật DevTools | A | A. Tag `devtools` đã xác minh trong source Wails v3.1.0 (xem "Hiện trạng"); việc cổng CDP có mở ở bản release thuần hay không vẫn chưa xác minh, không ảnh hưởng thiết kế vì b–f luôn chạy trên bản `devtools` |
| Q21 | Số nền cho ngưỡng Q10 đo ở đâu? | A: Đo ở giai đoạn 3<br>B: R1 đo luôn | A | **B** (khác đề xuất): R1 đo luôn thời gian restore từ thu nhỏ tới UI vẽ xong, và thao tác đầu sau idle (cuộn list 10.000 object, mở tab) |
| Q22 | Job CI `mem-bench` (Q16=B) mất khoảng 35–45 phút runner Windows mỗi lượt (xem B1c). Có bỏ qua PR **chỉ đổi tài liệu** (ví dụ PR `SP-NN/sprint_docs` chỉ có `sprints/**`, `memory/**`, `*.md`, `docs/user-guide/**`) không? | A (Recommended): Có, dùng `paths-ignore` cho các đường dẫn tài liệu; PR có code (Go, Rust, frontend, `build/`, `test-env/mem-bench.ps1`, `docs/scripts/mem-ui.mjs`, workflow) vẫn chạy; tiết kiệm một lượt ~40 phút mỗi sprint<br>B: Không lọc, chạy đúng nguyên văn "mọi PR"; PR docs cũng tốn ~40 phút | A | A: job CI mem-bench dùng `paths-ignore` bỏ qua PR chỉ đổi tài liệu (`sprints/**`, `memory/**`, `*.md`, `docs/user-guide/**`); PR có code, `build/`, script đo, workflow vẫn chạy (người dùng chọn) |
| Q23 | Nếu `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` **ghi đè** chuỗi browser args của app (chưa xác minh), bản đo có CDP sẽ mất `--disable-features=msSmartScreenProtection` (và sau này cờ của B3), làm số b–f lệch so với app thật. Xử lý thế nào? | A (Recommended): Script đọc switch trong `CommandLine` của process browser ở lượt không CDP, rồi ở lượt có CDP đặt env = các switch đó + `--remote-debugging-port`; nếu env chỉ nối thêm thì switch trùng giống hệt, vô hại; ghi danh sách switch vào `summary.md`<br>B: Không bù, chỉ ghi chênh lệch switch và coi là một phần "Sai số CDP" (a-cdp − a-nocdp); đơn giản hơn nhưng sai số lẫn hiệu ứng SmartScreen | A | A: bù switch (đọc switch từ CommandLine process browser ở lượt không CDP; lượt CDP đặt env = các switch đó + --remote-debugging-port; ghi danh sách vào summary.md) (người dùng chọn) |

## 3a. Task native (rust-native)
Toàn bộ task native thuộc giai đoạn 3 và là **phác thảo**, chỉ làm khi số đo cho thấy phần native (hiệu số Q4) đáng kể ở kịch bản d hoặc i2/i3.

| # | Task | Yêu cầu | File sửa / tạo | Phụ thuộc |
|---|---|---|---|---|
| N1 | (phác thảo) Giới hạn số worker tokio (ví dụ `min(số core, 4)`). Đo RAM d/i2 và `elapsedMs` trang 10.000 dòng trước/sau; nếu không giảm RAM thật thì bỏ | R2 | rust/src/runtime.rs (sửa) | Số đo R1 |
| N2 | (phác thảo) Method `trim`: giải phóng bộ nhớ Rust đang giữ mà không dùng (co buffer/cursor của connection đã đóng nếu đo thấy còn giữ, `HeapCompact(GetProcessHeap())` khi chưa xác định được nguồn). Go gọi khi idle nếu DLL đã nạp | R3 | rust/src/dispatch.rs (sửa), rust/src/protocol/mod.rs (sửa nếu cần), rust/src/registry.rs (sửa nếu đo thấy registry giữ buffer) | Số đo R1 |

Hợp đồng JSON mới/đổi: (N2, dự kiến) method `trim`, params `{}`, response `{"ok":true,"result":{}}`, không có mã lỗi mới (lỗi bất ngờ dùng `internal`); không cần `connId`, chạy được khi không có connection nào. | Crate mới: không (`HeapCompact` qua `windows-sys` chỉ khi cần; chưa xác minh crate đó đã có qua dependency gián tiếp, nếu phải thêm vào `Cargo.toml` thì hỏi người dùng).

Dùng lại: `registry::global()`, `runtime::get()`. | Hiệu năng: N1 không được làm tăng `elapsedMs` trang 10.000 dòng (< 40 ms, nhắm < 20 ms, bản release). N2 chỉ chạy một lần mỗi đợt idle, bỏ qua khi `registry` còn request.

Test Rust (rust-tester):
| Task | Hàm / file cần test | Case cần phủ |
|---|---|---|
| N1 | rust/src/runtime.rs `init` | gọi 2 lần vô hại; runtime chạy được tác vụ async; số worker đúng giới hạn khi máy nhiều/ít core (nếu tách hàm tính số worker) |
| N2 | rust/src/dispatch.rs (method `trim`), test qua hàm export ở rust/tests/*.rs | trim khi chưa có connection; trim sau open/close SQLite (file DB tạm); trim khi đang có request thì bỏ qua và không huỷ request; params thừa/thiếu vẫn ok; hồi quy: `open`/`execute`/`fetch`/`close` sau `trim` vẫn cho kết quả cũ (golden) |

## 3. Task backend (go-backend)
| # | Task | Yêu cầu | File sửa / tạo | Phụ thuộc |
|---|---|---|---|---|
| B1a | Script điều phối đo `test-env/mem-bench.ps1` (PowerShell + WMI, Q2=B), gồm điền hộp thoại download bằng UI Automation (Q15=A), đo restore (Q21=B). Chi tiết ở mục "Thiết kế B1" dưới bảng | R1 | test-env/mem-bench.ps1 (tạo), test-env/.gitignore (sửa: thêm `mem/report/`), test-env/README.txt (sửa: thêm mục 11 "Đo RAM" gồm chuẩn bị dữ liệu, build bản đo `devtools` và lệnh chạy lại) | B1b, B2 |
| B1b | Script thao tác UI tự động `docs/scripts/mem-ui.mjs` (Playwright `connectOverCDP`, Q5=B). Mỗi lần gọi làm một bước rồi ngắt kết nối CDP; còn đọc JS heap, kiểm `visibilityState`, đo thời gian thao tác đầu sau idle (Q21=B). Chi tiết ở "Thiết kế B1" | R1 | docs/scripts/mem-ui.mjs (tạo) | - |
| B1c | Job CI Windows chỉ đo kịch bản (a) trên bản release thuần (Q2=B), chạy trên mọi PR vào `SP-*/release` và `staging` (Q16=B), lọc PR docs theo Q22. Số CI chỉ tham khảo | R1 | .github/workflows/mem-bench.yml (tạo) | B1a, B2 |
| B2 | Probe bộ nhớ Go (Q3=A). Khi có `S3B_MEMPROBE=<file>`, một goroutine ghi mỗi 2 giây một dòng JSON: thời điểm, `/memory/classes/total:bytes`, `/memory/classes/heap/objects:bytes`, `/memory/classes/heap/released:bytes`, `/memory/classes/heap/stacks:bytes`, `/gc/heap/goal:bytes`, và cờ `dllLoaded`. Không có biến thì không chạy gì. Dừng theo `app.Context()` | R1 | internal/pkg/memprobe/memprobe.go (tạo), main.go (sửa: gọi `memprobe.Start` sau `internal.NewApp`), internal/modules/db/module.go + submodule_native_mng.go (sửa: `Loaded() bool`, không nạp DLL) | - |
| B3 | (phác thảo) Cờ WebView2 (`DisabledFeatures`/`AdditionalBrowserArgs`) chốt theo số đo; không đặt `SetMemoryLimit` mặc định (Q7=A). Gộp vào cả nhánh portable của `options.Windows` | R2 | main.go (sửa) | Số đo R1 |
| B4 | (phác thảo) Binding `TrimMemory`: `debug.FreeOSMemory()`, rồi gọi native `trim` (N2) **chỉ khi DLL đã nạp**; bỏ qua khi đang có truy vấn SQL hoặc transfer chạy. Theo Q8=C, FE là nguồn gọi duy nhất (idle 5 phút hoặc trang ẩn); **không** thêm hook Go `WindowMinimise` nếu R1 xác nhận thu nhỏ làm `document.visibilityState = hidden` (B1b kiểm); nếu không thì thêm hook Go và chống gọi trùng. Đặt trong module mới `internal/modules/system` + `handlers/system_handler.go` (chốt ở giai đoạn 2) | R3 | internal/modules/system/module.go (tạo), internal/handlers/system_handler.go (tạo), internal/app.go (sửa), main.go (sửa: register service), internal/modules/db/module.go (sửa: `Trim(ctx)`), submodule_native_mng.go (sửa) | N2 (nếu có), Số đo R1 |
| B5 | (phác thảo, chỉ khi d cho thấy đỉnh do copy) Bớt bản sao JSON Rust → Go → JS (ví dụ bỏ `append` copy ở `nativeLib.call`), giữ đúng hợp đồng `s3b_free` | R2 | internal/modules/db/native_windows.go, submodule_native_mng.go, submodule_query_mng.go (sửa) | Số đo R1 |
| B6 | (phác thảo) Giới hạn đỉnh RAM của Fetch all (`FetchRowsInput.All`). Chỉ làm khi người dùng đồng ý đổi hành vi (đổi so với 21d683a) | R2 | internal/modules/db/submodule_query_mng.go (sửa) | Số đo R1, câu hỏi ở giai đoạn 2 |

B1a, B1b, B1c là công cụ đo (không thuộc app); giao cho `go-backend` vì cùng branch R1 và không đụng `frontend/src`. `react-tester` không áp dụng cho `docs/scripts/*.mjs` (ngoài `frontend/src`). B1c chỉ cần B1a + B2 (kịch bản a không dùng CDP nên không gọi `mem-ui.mjs`).

### Thiết kế B1 (giai đoạn 1)

**Phân vai.** PowerShell (`mem-bench.ps1`) mở/đóng app, đặt env, lấy mẫu WMI, điền hộp thoại native (UI Automation), thu nhỏ/khôi phục cửa sổ, đọc file probe, tính trung vị, ghi kết quả. Node (`docs/scripts/mem-ui.mjs`, chạy `node scripts/mem-ui.mjs <step> --port <p> [tham số]` trong `docs/`) chỉ làm thao tác UI, đo thời gian trong trang và đọc JS heap, mỗi lần gọi một bước rồi thoát.

**Hai bản build** (Q20=A):
- **Bản release** (`build/bin/S3Browser.exe`, `go tool wails3 task windows:build`): chỉ dùng cho `a-release` (không env debug) và cho CI.
- **Bản đo** (`build/bin/bench/S3Browser.exe`, `-tags production,devtools` qua `EXTRA_TAGS=devtools OUT_DIR=build/bin/bench`): dùng cho `a-nocdp`, `a-cdp` và toàn bộ phiên b–f. Chỉ khác bản release ở `AreDevToolsEnabled` và menu role (đã xác minh, xem "Hiện trạng").
- Script ghi commit, tag build (đọc `go version -m <exe>` lấy `-tags`) của cả hai exe vào `summary.md`; từ chối chạy b–f nếu exe bản đo không có tag `devtools`.

**`mem-bench.ps1` — tham số** (comment-based help giống `db-bench.ps1`):
- `-Exe <đường dẫn>` (mặc định `build/bin/S3Browser.exe`), `-BenchExe <đường dẫn>` (mặc định `build/bin/bench/S3Browser.exe`), hoặc `-ProcessName <tên>` cho app so sánh (A5:SQL Mk-2, Navicat: chế độ bán tự động, Q17).
- `-Scenario` (`a`, `b`, `c`, `d`, `e`, `f`, `all`; mặc định `all`), `-Runs` (mặc định 3), `-NoCdp` (chỉ `a-release`, dùng cho CI), `-OutDir` (mặc định `test-env/mem/report/<ngày>_<giờ>/`, gitignore).
- Kết nối: `-S3Endpoint`, `-S3AccessKey`, `-S3SecretKey` (mặc định đọc từ env `S3B_BENCH_*`, không ghi secret vào CSV/log), `-Bucket` (mặc định `s3b-mem-10k`), `-SqliteFile` (mặc định trong `OutDir`; dùng lại cho app so sánh).
- `-PrepareData`: tạo bucket 10.000 object bằng `docker exec s3b-test-minio sh -c "... mc ..."` (sinh file trong container rồi `mc cp --recursive`), tạo file upload cho c (mặc định 100 file × 4 MiB trong thư mục tạm, chỉnh bằng `-UploadCount`/`-UploadSizeMiB`).

**Mở app.** Từ chối chạy khi đã có `S3Browser.exe` khác đang chạy (tránh dùng chung process browser WebView2). Env cho riêng process con: `APPDATA=<OutDir>\appdata-<run>` (cách ly DB, log, setting và user data WebView2 `%APPDATA%\S3Browser.exe`), `S3B_MEMPROBE=<OutDir>\probe-<run>.jsonl`, và khi cần CDP `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<cổng loopback trống>` (cộng các switch app theo Q23 nếu chọn A). Sau khi mở, kiểm `--user-data-dir=` của process browser nằm trong thư mục tạm, (khi có CDP) `http://127.0.0.1:<cổng>/json/version` trả lời, và so danh sách switch của process browser với lượt không CDP (ghi vào `summary.md`); không đạt thì dừng với thông báo rõ (Rủi ro 4, 6).

**Cây process và phân loại.** Từ PID gốc, dựng cây bằng `Get-CimInstance Win32_Process` (`ProcessId`, `ParentProcessId`, `CommandLine`) lặp tới hết con cháu. Phân loại: process app = `go`; `msedgewebview2.exe` không có `--type=` = `browser`; `--type=renderer`, `--type=gpu-process`, `--type=utility` (gồm network/storage service), `crashpad-handler` và loại khác = `other`. Private WS lấy từ `Win32_PerfFormattedData_PerfProc_Process.WorkingSetPrivate` khớp theo `IDProcess` (không theo tên instance, vì tên có `#n` và phụ thuộc ngôn ngữ). Mỗi điểm đo lấy 5 mẫu cách 2 giây, ghi trung vị.

**Tách phần.** `go_runtime` = `/memory/classes/total:bytes` dòng probe gần nhất; `go_heap` = `heap/objects`; `native_other` = Private WS(go) − `go_runtime` (gồm DLL Rust + tokio, Wails/COM, Q4=A); ghi kèm `dllLoaded`. Phần "DLL Rust" = hiệu số `native_other` sau và trước khi `dllLoaded` chuyển true trong cùng phiên.

**Các lượt chạy.** Một lần `-Scenario all -Runs 3` gồm:
- `a-release` × 3 (bản release, không env debug): mở app, chờ 30 s → mẫu `a@30s`; chờ tới 6 phút → mẫu `i1@6m`; đóng app.
- `a-nocdp` × 3 (bản đo, không env debug): như trên.
- Phiên chính × 3 (bản đo, có cổng CDP, Q19=A), trình tự bên dưới. Bước 1 của phiên chính chính là `a-cdp`.

**Trình tự phiên chính** (Q19=A, một phiên app nối tiếp):
1. a / i1 (`a-cdp`): mở app, nối/ngắt CDP một lần (như các bước khác), chờ 30 s → mẫu `a@30s`; chờ tới 6 phút → mẫu `i1@6m` (vượt ngưỡng idle 5 phút của Q8=C, để số nền và số sau R3 lấy cùng thời điểm).
2. b: `mem-ui.mjs connect-s3` (tạo profile MinIO, Connect, mở bucket, cuộn tới hết để nạp đủ 10.000 object) → `mem-ui.mjs scroll-s3` (đo **`scroll-warm`**, xem "Đo thời gian UI") → ngắt CDP, chờ 30 s → mẫu `b`; chờ 6 phút không thao tác → mẫu `i2-s3`; rồi `mem-ui.mjs scroll-s3` lần nữa → **`scroll-after-idle`** (thao tác đầu sau idle).
3. c: `mem-ui.mjs upload` (tiêm event thả file → upload thật); trong lúc truyền lấy mẫu mỗi 2 s, ghi **đỉnh**. Sau đó download (Q15=A, xem "Download bằng UI Automation") → lấy đỉnh; chờ 30 s sau khi xong → mẫu `c-after`.
4. d: `mem-ui.mjs sqlite` (chuyển SQL, tạo profile SQLite, Connect và ghi **thời gian Connect đầu** từ lúc bấm tới khi cây hiện, chạy `SELECT` 10.000 dòng, chờ grid có dữ liệu) → mẫu `d`; ngắt rồi Connect lại để có thời gian Connect lần hai (hiệu số ≈ chi phí nạp DLL, Q6); `mem-ui.mjs open-tab-sql` (đo **`open-tab-warm`**); chờ 6 phút → mẫu `i2-sql`; rồi `mem-ui.mjs open-tab-sql` lần nữa → **`open-tab-after-idle`**.
5. e (Q18=C):
   - e-s3: `mem-ui.mjs tabs-s3` mở 5 tab S3, mỗi tab mở bucket 10.000 object và cuộn tới hết → mẫu `e-s3-open`; `mem-ui.mjs close-all --mode s3` đóng hết tab S3 và ngắt kết nối → chờ 30 s mẫu `e-s3-closed`.
   - e-sql: `mem-ui.mjs tabs-sql` mở 5 tab SQL, mỗi tab chạy truy vấn 10.000 dòng → mẫu `e-sql-open`; `mem-ui.mjs close-all --mode sql` đóng hết tab SQL và ngắt kết nối → chờ 30 s mẫu `e-sql-closed`.
   - Chờ 6 phút → mẫu `i3` (sau khi cả S3 lẫn SQL đã đóng hết).
6. i4: `mem-ui.mjs minimize` (bấm nút thu nhỏ của `WindowControls`, ghi `document.visibilityState` sau khi thu nhỏ) → chờ 30 s mẫu `i4@30s`, 6 phút mẫu `i4@6m`; rồi đo **`restore`** (xem "Đo thời gian UI").
7. f: để yên 30 phút, lấy mẫu mỗi phút, ghi mẫu cuối `f` và đường cong.
8. Đóng app bằng nút đóng (`mem-ui.mjs close-app`) hoặc `CloseMainWindow`; dọn `appdata-<run>`.

Thời gian ước tính: phiên chính ~80 phút (6 điểm chờ 6 phút + f 30 phút + thao tác), × 3 = ~4 giờ; thêm `a-release` và `a-nocdp` (6 lượt × ~6,5 phút ≈ 40 phút). Tổng ~4,7 giờ, chưa kể app so sánh.

**Đo thời gian UI (Q21=B).** Đồng hồ: `Date.now()` trong trang và `[DateTimeOffset]::UtcNow` trong PowerShell cùng lấy giờ hệ thống của một máy, so trực tiếp được (sai lệch cỡ 1 ms). Mỗi số ghi trung vị 3 phiên.
- **`restore`** (từ thu nhỏ tới UI vẽ xong): sau mẫu `i4@6m`, `mem-ui.mjs arm-restore` nối CDP, cài trong trang một listener `visibilitychange` ghi `window.__s3bRestore = Date.now()` sau hai `requestAnimationFrame` liên tiếp khi trang chuyển sang `visible` (khung đầu tiên đã vẽ), rồi ngắt CDP (listener ở lại trong trang). PowerShell ghi `t0` rồi gọi `ShowWindow(SW_RESTORE)` qua P/Invoke; `mem-ui.mjs read-restore` đọc `__s3bRestore`; `restore_ms = __s3bRestore − t0`. Nếu thu nhỏ không làm `visibilityState` thành `hidden` (Rủi ro 15) thì ghi `restore: N/A (visibility không đổi)`. `arm-restore` chạy sau mẫu `i4@6m` để phiên CDP không lẫn vào mẫu i4.
- **`scroll-warm` / `scroll-after-idle`** (cuộn list 10.000 object): `mem-ui.mjs scroll-s3` trong trang ghi `t0 = performance.now()`, đặt `scrollTop` của khung cuộn list tới khoảng giữa (vị trí dòng ~5.000, tính từ chiều cao cuộn), chờ tới khi phần tử dòng của vị trí đó có trong DOM, rồi hai `requestAnimationFrame` → `scroll_ms`. Bản `after-idle` chạy ngay sau mẫu `i2-s3`, là thao tác đầu tiên sau 6 phút không thao tác.
- **`open-tab-warm` / `open-tab-after-idle`** (mở tab): `mem-ui.mjs open-tab-sql` bấm nút mở tab SQL mới, đo tới khi editor của tab mới hiện, rồi đóng lại tab đó (để không đổi trạng thái đo `i2-sql`/e). Bản `after-idle` chạy ngay sau mẫu `i2-sql`.
- Phiên CDP của các bước này có mặt cả ở trước và sau tối ưu (cùng cách đo), nên dùng được làm "nền" cho Q10.

**Download bằng UI Automation (Q15=A).** Code thực tế: nhiều object → hộp thoại chọn thư mục (`OpenFile` + `CanChooseDirectories`), một object → hộp thoại lưu (`SaveFile`). Script chọn tất cả object vừa upload nên dùng hộp thoại chọn thư mục; cùng một hàm xử lý được cả hộp thoại lưu (ô Edit + nút OK).
1. PowerShell chạy `mem-ui.mjs download` ở nền (`Start-Process`, không chờ): bước này chọn các object vừa upload, bấm Download, rồi chờ transfer xong (theo UI) mới thoát.
2. Song song, PowerShell (`System.Windows.Automation`, assembly `UIAutomationClient`/`UIAutomationTypes`) chờ tối đa 15 s cửa sổ hộp thoại (class `#32770`) thuộc PID của app; tìm ô Edit đường dẫn và nút OK theo **AutomationId** (không theo tên, vì tên phụ thuộc ngôn ngữ Windows; AutomationId cụ thể **chưa xác minh**, go-backend kiểm bằng `Inspect.exe` hoặc UIA dump khi viết), gõ đường dẫn thư mục tạm `<OutDir>\download-<run>`, bấm OK.
3. Trong lúc chờ node thoát, lấy mẫu mỗi 2 s để có đỉnh download.
4. Không thấy hộp thoại, không điền được, hoặc `mem-ui.mjs download` lỗi: gửi Escape/đóng hộp thoại (để app không bị treo ở hộp thoại modal), dừng node, ghi `download: FAIL (<lý do>)`; kịch bản c chỉ còn số upload, phiên vẫn tiếp tục.
5. Sau c xoá thư mục download tạm.

**JS heap.** Sau mỗi mẫu Private WS, gọi `mem-ui.mjs heap`: nối CDP, `Runtime.getHeapUsage` (usedSize, totalSize) qua `CDPSession` của page app, ngắt. Không ép GC (để số khớp trạng thái thật).

**Sai số (Q5=B, Q20=A).** Cổng debug, phiên CDP và tag `devtools` có thể làm tăng Private WS (chủ yếu process browser và renderer). Cách xử lý:
- Mọi bước UI xong là **ngắt CDP trước** khi chờ ổn định và lấy mẫu; JS heap đọc **sau** mẫu Private WS. Như vậy mẫu chỉ chịu chi phí "cổng mở, không client".
- **Sai số build** = trung vị `a-nocdp` − trung vị `a-release` (theo từng loại process). **Sai số CDP** = trung vị `a-cdp` − trung vị `a-nocdp`. Cả hai ghi thành dòng riêng trong `summary.md`, kèm tổng.
- Bảng b–f, i2–i4 ghi số thô (bản đo, có cổng) và cột "đã trừ sai số a" (sai số build + CDP) để tham khảo. So trước/sau ở giai đoạn 3 luôn dùng **cùng cách đo** (bản đo, có cổng), nên sai số triệt tiêu; số so với A5:SQL Mk-2/Navicat dùng `a-release` cho a và cột đã trừ sai số cho d, e-sql, f, có ghi chú.

**App so sánh (Q17=A).** `-ProcessName` hoặc `-Exe` của A5:SQL Mk-2/Navicat: script mở (hoặc gắn vào process đang chạy), dựng cây process giống trên (không có probe, không có JS heap, không có số thời gian UI). Đo **a, d, e-sql, f** bán tự động: mỗi kịch bản in hướng dẫn một dòng (ví dụ d: "mở file SQLite `<SqliteFile>`, chạy `SELECT` 10.000 dòng, nhấn Enter"; e-sql: "mở 5 tab truy vấn, mỗi tab chạy câu trên, nhấn Enter", rồi "đóng hết tab và ngắt kết nối, nhấn Enter") rồi chờ Enter, sau đó chờ ổn định và lấy mẫu như S3Browser. b, c ghi `N/A` (không có S3). Dùng cùng file SQLite với kịch bản d của S3Browser. A5:SQL Mk-2/Navicat có mở được SQLite ở bản người dùng đang có hay không: **chưa xác minh**; không được thì ghi `N/A` cho d, e-sql kèm lý do.

**Kết quả.** `samples.csv` (mỗi mẫu: run, build (`release`/`bench`), scenario, point, loại process, pid, privateWsBytes), `timings.csv` (run, metric: `connect-first`, `connect-second`, `restore`, `scroll-warm`, `scroll-after-idle`, `open-tab-warm`, `open-tab-after-idle`, `upload`, `download`; ms; trạng thái), `probe-<run>.jsonl`, `summary.md` (bảng trung vị/min/max theo kịch bản × phần: go_runtime, go_heap, native_other, browser, renderer, gpu, utility, other, tổng cây, JS heap; dòng sai số build và sai số CDP; bảng thời gian UI (trung vị/min/max); `visibilityState` khi thu nhỏ; danh sách switch browser của từng chế độ; trạng thái download; thông tin máy, bản build, tag, commit). Người dùng chép `summary.md` + CSV vào `sprints/sprint-20/measurements.md` và `sprints/sprint-20/mem/` (chỉ commit ở `SP-20/sprint_docs`).

**`mem-ui.mjs` — các bước:** `connect-s3`, `scroll-s3`, `upload`, `download`, `sqlite`, `open-tab-sql`, `tabs-s3`, `tabs-sql`, `close-all --mode s3|sql`, `minimize`, `arm-restore`, `read-restore`, `heap`, `close-app`. Truy vấn DOM theo role/label/text với nhãn `en` (script đặt ngôn ngữ app là English ở lần mở đầu qua Settings nếu cần; `APPDATA` mới nên setting mặc định). Upload: dựng `FilesDroppedOutput` (groups, kích thước file, giới hạn `maxFilesPerFolder` 50 → chia nhóm theo thư mục con) và tiêm `EventFilesDropped` với `tabId` lấy từ `data-tab-id` của list đang mở; tên event lấy từ `internal/modules/bucket/events.go` (go-backend tra khi viết). Mỗi bước có timeout và in JSON kết quả (thời gian, trạng thái) cho PowerShell đọc; lỗi thì exit code ≠ 0 và PowerShell ghi `FAIL` cho kịch bản/số đo đó, không dừng cả phiên.

**`.github/workflows/mem-bench.yml` (B1c, Q16=B).**
- Trigger: `pull_request` vào `branches: ['SP-*/release', staging]` (mặc định types `opened`, `synchronize`, `reopened`); thêm `workflow_dispatch` để chạy tay khi cần. Lọc PR chỉ đổi tài liệu bằng `paths-ignore` nếu Q22=A (danh sách dự kiến: `sprints/**`, `memory/**`, `**/*.md`, `docs/user-guide/**`, `docs/images/**`; không lọc `docs/scripts/**`).
- `concurrency: { group: mem-bench-${{ github.event.pull_request.number || github.ref }}, cancel-in-progress: true }`: push mới lên cùng PR huỷ lượt cũ.
- `runs-on: windows-latest`, `timeout-minutes: 75`, `permissions: contents: read`, không secret.
- Bước: checkout; `actions/setup-go` (go.mod); `oven-sh/setup-bun`; Rust `dtolnay/rust-toolchain@stable` (target msvc) + `Swatinem/rust-cache` (`workspaces: rust`), giống `pre-release.yml`, vì `build:native` chạy `common:copy:dll`; `go tool wails3 task windows:build` (bản release thuần, không cần bản `devtools`); kiểm WebView2 Runtime có trên runner (registry `EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}`), thiếu thì fail rõ ràng; `pwsh test-env/mem-bench.ps1 -Scenario a -Runs 3 -NoCdp` (chỉ `a-release`, không cần Playwright, MinIO hay `bun install --cwd docs`); `actions/upload-artifact` thư mục kết quả; ghi `summary.md` vào `$GITHUB_STEP_SUMMARY`.
- Job chỉ fail khi script lỗi (không đặt ngưỡng RAM); số CI ghi "tham khảo" trong `summary.md`. Không phải required check (branch protection do người dùng quản lý).
- **Thời gian/chi phí (ước tính, chưa đo)**: build ~12–18 phút khi cache Rust trúng (frontend + Rust + Go; lần đầu/không trúng cache có thể ~25 phút), đo 3 × ~7 phút ≈ 21 phút, tổng ~35–45 phút mỗi lượt, mỗi push lên PR là một lượt (lượt cũ bị huỷ). Runner Windows của GitHub: repo public thì miễn phí; repo private thì tính phút theo hệ số 2 (khoảng 70–90 phút quota mỗi lượt). Repo public hay private: **chưa xác minh**. Mỗi sprint có khoảng 3–5 PR feature + 1 PR docs + 1 PR release → staging.

### Chọn Go hay Rust (mục 7 `CLAUDE.md`)
- B1a/B1b/B1c: PowerShell, Node, YAML; không thuộc app.
- B2: Go, chỉ đọc `runtime/metrics` của chính Go, việc nhẹ.
- B3, B4 phần Go: Go, vì là tham số runtime Go và Go phải tự trả heap của mình. Phần giải phóng bộ nhớ của DLL: Rust (N2).
- B5, B6: giữ nguyên "Go chỉ chuyển nguyên JSON"; nếu cần chia trang thì Rust làm.
- Chưa có ứng viên chuyển code Go sang Rust; chỉ đề xuất ở giai đoạn 2 nếu số đo b/c cho thấy heap Go chiếm phần lớn và chuyển được.

Message code mới: không. | Migration / sqlc: không | Cần sinh lại bindings: giai đoạn 1 không (B2 không thêm binding); R3 có (B4 thêm `SystemHandler.TrimMemory`).

Dùng lại: B1b dùng `playwright` đã có trong `docs/package.json` và cách tiêm event `window._wails.dispatchWailsEvent` của `shots.mjs`; B1a theo khung `db-bench.ps1` (help, `$ErrorActionPreference`, thông tin máy qua `Win32_Processor`/`Win32_ComputerSystem`/`Win32_OperatingSystem`), UI Automation có sẵn trong .NET của Windows (không cài thêm); bản đo dùng `EXTRA_TAGS`/`OUT_DIR` sẵn có của `build/windows/Taskfile.yml`; B1c theo các bước setup của `pre-release.yml`; MinIO và `mc` của `test-env/docker-compose-minio.yml`. B2/B4: `submoduleNativeMng.get/mu/caller`, `withCallContext`, `logger.With`, `app.Context()`. | Hiệu năng: probe B2 chỉ chạy khi có env, `metrics.Read` với slice cấp sẵn, 2 giây một lần, ghi nối dòng (không giữ lịch sử trong RAM). Script đo lấy mẫu WMI theo PID (một truy vấn `Win32_PerfFormattedData_PerfProc_Process` mỗi mẫu, không truy vấn từng process) để chính script không làm nhiễu CPU. Đo thời gian UI chạy trong trang (`performance.now()`/`requestAnimationFrame`), không tính thời gian nối CDP. `FreeOSMemory` (B4) gây một lần GC STW, chỉ gọi một lần mỗi đợt idle.

Test hồi quy Go (go-tester, test tạm):
| Task | Function sửa | Nơi gọi | Kịch bản hồi quy (hành vi cũ phải giữ) |
|---|---|---|---|
| B1a/B1b/B1c | (không có function Go) | - | Không có unit test; verifier chạy thử trên máy có bản release và bản đo: `mem-bench.ps1 -Scenario a -Runs 1 -NoCdp` (bản release), `-Scenario a -Runs 1` (đủ `a-release`, `a-nocdp`, `a-cdp`) và `-Scenario d -Runs 1` (SQLite, không cần Docker; có `connect-first`, `open-tab-warm`, `open-tab-after-idle`); có MinIO thì thêm `-Scenario b -Runs 1` (có `scroll-warm`, `scroll-after-idle`) và `-Scenario c -Runs 1` (download qua UIA PASS, hoặc FAIL có lý do mà phiên vẫn chạy tiếp, không còn hộp thoại treo). Kiểm `summary.md` có đủ cột, sai số build/CDP, danh sách switch; không lộ secret; không còn process app/WebView2 sót; `APPDATA` thật không bị đụng. B1c: chạy `workflow_dispatch` hoặc mở PR thử một lần, có artifact |
| B2 | internal/pkg/memprobe/memprobe.go: `Start` | main.go | không có `S3B_MEMPROBE` thì không tạo file, không goroutine; có biến thì ghi dòng JSON hợp lệ đủ key; dừng khi ctx huỷ; đường dẫn không ghi được thì log, app vẫn chạy |
| B2 | internal/modules/db/submodule_native_mng.go: `Loaded` (mới), `get`; module.go: `Loaded` | memprobe (qua hàm truyền vào), module.go, submodule_conn_mng.go, submodule_query_mng.go | `Loaded()` false trước lần gọi đầu, true sau `get` thành công, false khi nạp lỗi; gọi `Loaded()` không nạp DLL; `get` vẫn nạp lại sau lần lỗi (hành vi cũ), vẫn trả `loadError` (DBE009) |
| B3 | main.go: dựng `options.Windows` | main | bản portable giữ `WebviewBrowserPath`/`WebviewUserDataPath`; browser args có ở cả hai nhánh (hàm thuần tách ra) |
| B4 | system/module.go: `TrimMemory`; db/module.go: `Trim`; submodule_native_mng.go | system_handler.go | DLL chưa nạp thì không nạp và không gọi native; DLL đã nạp thì gọi `trim` đúng 1 lần (fake `nativeCaller`); đang có truy vấn/transfer thì bỏ qua; ctx huỷ thì im lặng; `callNativeRaw`/`failCall` cũ map lỗi như trước (DBE004/005/008/009/015) |
| B5 | native_windows.go: `call`; submodule_native_mng.go: `callNativeRaw`; submodule_query_mng.go: `execute`, `openTableRows`, `fetchRows` | db/module.go, db_handler.go | JSON ra FE giống byte-by-byte (golden); `okPrefix` và nhánh lỗi giữ nguyên; buffer luôn `s3b_free` đúng 1 lần ở mọi nhánh |
| B6 | submodule_query_mng.go: `fetchRows` | db/module.go, db_handler.go | Fetch thường giữ `pageSize`/`maxPageBytes`/`queryTimeout`; tab đã đóng vẫn trả `closedMessage()` |

## 4. Task frontend (react-frontend)
| # | Task | Yêu cầu | File sửa / tạo | Phụ thuộc |
|---|---|---|---|---|
| F1 | (phác thảo, theo Q8=C) Hook idle gọi `TrimMemory` một lần mỗi đợt idle. Idle = 5 phút không có thao tác (`useIdle(300_000)` của `@mantine/hooks`: chuột, phím, cuộn, chạm, click). Trang ẩn (`useDocumentVisibility() === 'hidden'`, gồm thu nhỏ nếu R1 xác nhận) thì gọi ngay. Một "đợt idle" bắt đầu khi chuyển sang idle hoặc hidden và kết thúc khi có thao tác hoặc trang hiện lại; trong một đợt chỉ gọi tối đa 1 lần (idle 5 phút rồi thu nhỏ không gọi lần hai). Gắn một lần ở `MainLayout` | R3 | frontend/src/common/hooks/useIdleTrim.ts (tạo), frontend/src/components/layouts/MainLayout.tsx (sửa) | B4 |
| F2 | (phác thảo) Giảm JS heap theo số đo (JS heap ở b, d, e). Ứng viên: dữ liệu tab đã đóng còn bị giữ, state lớn của tab ẩn, cache store. Danh sách file chốt sau số đo | R2 | chưa xác định (chốt ở giai đoạn 2) | Số đo R1 |

i18n key mới (đủ 7 ngôn ngữ): không (F1 không có UI).

Dùng lại: `useIdle`, `useDocumentVisibility` (`@mantine/hooks`, đã kiểm có trong `node_modules/@mantine/hooks`), `callIPC` với `showMessage` tắt. Không tự viết hook idle. | Hiệu năng: `useIdle` dùng listener sẵn của Mantine, không gắn `mousemove` riêng; chỉ gọi IPC khi chuyển trạng thái (hoạt động → idle, hiện → ẩn), không gọi lặp theo timer. Hằng 5 phút đặt một chỗ.

Test frontend (react-tester):
| Task | File cần test | Case cần phủ |
|---|---|---|
| F1 | frontend/src/common/hooks/useIdleTrim.ts | chưa đủ 5 phút thì không gọi; đủ 5 phút gọi đúng 1 lần; còn idle thì không gọi lại; có thao tác rồi idle lần nữa thì gọi lại; trang ẩn thì gọi ngay; đã gọi vì idle rồi trang ẩn trong cùng đợt thì không gọi lần hai; ẩn → hiện → ẩn là đợt mới thì gọi lại; unmount thì không gọi nữa; `callIPC` trả null không lỗi; fake timer chỉ giả `setTimeout`/`clearTimeout`/`Date` (memory mục 3) |
| F1 | frontend/src/components/layouts/MainLayout.tsx | hồi quy: chuyển S3/SQL, giữ workspace đã vào, retry khi chunk lỗi, nút Settings/History như cũ; hook idle gắn đúng một lần |
| F2 | (theo file thực sửa) | hồi quy hiển thị và phân trang cũ; dữ liệu được giải phóng khi đóng tab hoặc ngắt kết nối |

## 5. Branch
Tên branch chưa kiểm với remote (planner không có Bash). `git-flow` phải chạy `git ls-remote --heads origin 'SP-20/*'` trước khi tạo.

| Branch | Yêu cầu | Task | Ghi chú |
|---|---|---|---|
| SP-20/mem_baseline | R1 | B1a, B1b, B1c, B2 | Giai đoạn 1. Không sinh lại bindings. Kết quả đo ghi vào `sprints/sprint-20/measurements.md` (+ CSV ở `sprints/sprint-20/mem/`), chỉ commit ở `SP-20/sprint_docs`. PR của branch này là lượt đầu tiên chạy job `mem-bench` (workflow có trong chính PR) |
| SP-20/idle_memory_trim | R3 | N2, B4, F1 | Giai đoạn 3, làm trước R2 (Q13=A). Chốt lại sau số đo |
| SP-20/memory_tuning | R2 | N1, B3, B5, B6, F2 | Giai đoạn 3. Chốt lại sau số đo; B3 và B4 cùng sửa `main.go` ở đoạn khác nhau, conflict nhỏ |

## 6. Thứ tự thực hiện (luôn tuần tự, xong branch này mới sang branch sau)
**Giai đoạn 1: đo nền** (Q23 đã trả lời, không còn câu hỏi chờ; B2, B1b, B1a, B1c làm được ngay)
1. Tách `SP-20/mem_baseline` từ `origin/SP-20/release` (release tạo một lần từ `origin/staging`).
2. Backend: B2 → B1b → B1a → B1c → Go test hồi quy B2 (go-tester, test tạm, xoá sau khi chạy) → verify (build bản release và bản đo `devtools`, chạy thử theo bảng hồi quy ở trên; kiểm biome không áp dụng cho `docs/scripts`, nếu biome.json của repo có phủ `docs/` thì chạy `biome check docs/scripts/mem-ui.mjs`, chưa xác minh) → review → commit, push, PR vào `SP-20/release` (job `mem-bench` chạy trên PR này).
3. Người dùng (hoặc orchestrator nếu máy có Docker + MinIO): build hai bản, `mem-bench.ps1 -PrepareData` rồi `mem-bench.ps1 -Scenario all -Runs 3`; chạy chế độ bán tự động cho A5:SQL Mk-2 và Navicat (a, d, e-sql, f; Q17=A). Số đo (RAM và thời gian UI) ghi vào `sprints/sprint-20/measurements.md`, kèm kết quả job CI.

**Giai đoạn 2: dừng để người dùng duyệt**
4. Orchestrator gọi lại planner kèm số đo. Planner cập nhật plan: chốt % giảm (Q14), chọn/bỏ N1, N2, B3–B6, F1, F2, quyết định hook Go `WindowMinimise` (theo `visibilityState` đo được), hợp đồng native cuối cùng, câu hỏi mới (ví dụ B6). Orchestrator hỏi người dùng duyệt.

**Giai đoạn 3: tối ưu** (mỗi branch: tách từ `origin/SP-20/release` → native + rust-tester → backend → `go tool wails3 generate bindings -f "-tags=wailsgen" -clean=true -ts` → go-tester → frontend → react-tester → verify → review → commit, push, PR)
5. `SP-20/idle_memory_trim` (R3), mỗi thay đổi kèm số đo trước/sau ở i1–i4 bằng `mem-bench.ps1`, cùng `restore`, `scroll-after-idle`, `open-tab-after-idle` so với số nền R1 (Q10, Q21=B).
6. `SP-20/memory_tuning` (R2), mỗi thay đổi kèm số đo trước/sau ở kịch bản bị ảnh hưởng, cùng `elapsedMs` trang 10.000 dòng (`test-env/db-bench.ps1`) và thời gian list 10.000 object (`scroll-warm`).

## 7. Rủi ro
| # | Rủi ro | Mức độ | Cách giảm thiểu |
|---|---|---|---|
| 1 | Số đo dao động mạnh (WebView2 tự điều chỉnh bộ nhớ, Windows trim working set, app khác chạy nền), % giảm không phân biệt được với nhiễu | high | Trung vị 3 phiên, 5 mẫu mỗi điểm, thời gian ổn định cố định, ghi min/max; cùng máy, cùng cách đo cho trước và sau |
| 2 | Phần lớn RAM nằm ở WebView2 mà Wails v3.1.0 chỉ cho chỉnh qua browser args; % giảm đạt được có thể thấp | high | Đo trước rồi mới chốt % (Q14); thử từng cờ kèm số đo; ghi rõ phần không tác động được |
| 3 | Cổng CDP, phiên Playwright và tag `devtools` làm tăng Private WS (browser, renderer), làm sai số b–f | high | Ngắt CDP trước khi lấy mẫu; đo `a-release`/`a-nocdp`/`a-cdp` để có sai số build và CDP theo loại process; so trước/sau luôn cùng cách đo; ghi rõ trong `summary.md` |
| 4 | Cổng CDP không mở được kể cả ở bản `devtools` (ví dụ env bị bỏ qua) | medium | Tag `devtools` đã xác minh bật `AreDevToolsEnabled`; B1a kiểm `/json/version` ngay sau khi mở app, dừng với thông báo rõ |
| 5 | Cờ WebView2 (B3) làm chậm vẽ, cuộn list hoặc hỏng tính năng (kéo thả, hộp thoại, OIDC) | medium | Mỗi cờ đo cả `scroll-warm`; test tay kéo thả, upload/download, SQL editor; không dùng cờ đổi bảo mật |
| 6 | `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` có thể ghi đè chuỗi args app luôn truyền (`--disable-features=msSmartScreenProtection`, sau này cờ B3), hoặc bị bỏ qua khi process browser dùng chung user data với app đang chạy (chưa xác minh) | medium | Q23; script so switch giữa lượt có/không CDP và ghi vào `summary.md`; từ chối chạy khi có `S3Browser.exe` khác, đặt `APPDATA` riêng (đã xác minh user data theo `APPDATA`) và kiểm `--user-data-dir=`; sau B3 chạy lại kiểm này |
| 7 | Remote debugging port mở khi đo | low | Chỉ có ở bản đo `devtools` (không phát hành), bật qua env do script đặt cho riêng process con, Chromium mặc định bind 127.0.0.1; CI chỉ chạy bản release không cổng |
| 8 | UI Automation điền hộp thoại download dễ vỡ theo bản Windows, ngôn ngữ, AutomationId (chưa xác minh); hộp thoại modal treo làm hỏng cả phiên | medium | Tìm theo AutomationId, không theo tên; timeout 15 s; lỗi thì đóng hộp thoại, ghi FAIL, c chỉ đo upload, phiên chạy tiếp (Q15=A) |
| 9 | Upload giả bằng event thả file phải dựng đúng `FilesDroppedOutput` (groups, giới hạn 50 file/thư mục, 1.000 file/lần); sai cấu trúc thì FE bỏ qua hoặc báo lỗi | medium | B1b in kết quả upload (số file thành công) và fail rõ khi lệch; đọc model trong `models/` khi viết |
| 10 | UI đổi nhãn/cấu trúc làm `mem-ui.mjs` hỏng ở sprint sau | medium | Truy vấn theo role/label, nhãn `en`; mỗi bước có timeout và in lỗi rõ; verifier chạy thử a, d |
| 11 | Job CI: runner `windows-latest` có thể thiếu WebView2 Runtime hoặc không cho app GUI chạy trong phiên của runner (chưa xác minh); số đo dao động theo runner; chạy trên mọi PR (Q16=B) tốn ~35–45 phút runner Windows mỗi lượt, repo private thì tính phút hệ số 2 | medium | Bước kiểm WebView2 fail rõ; số CI chỉ tham khảo (Q2=B), job không đặt ngưỡng; `concurrency` huỷ lượt cũ; lọc PR docs theo Q22; `timeout-minutes: 75` |
| 12 | Thời gian đo dài: ~4,7 giờ cho `-Scenario all -Runs 3` (phiên chính ~80 phút × 3, thêm 6 lượt a), chưa kể app so sánh | low | Tự động hoàn toàn; `-Scenario`/`-Runs` để chạy riêng; kết quả từng phiên ghi ngay ra CSV |
| 13 | Gỡ DLL/runtime tokio để i3 ≈ i1 có thể crash | high | Không đưa vào plan (Q9=A) |
| 14 | `FreeOSMemory`/native `trim` chạy lúc upload/download hoặc truy vấn làm giật; thu nhỏ/mở lại liên tục làm gọi trim nhiều lần (mỗi lần thu nhỏ là một đợt mới theo Q8=C) | medium | B4 bỏ qua khi có truy vấn/transfer; mỗi đợt chỉ một lần; đo `restore` và thao tác đầu sau idle theo Q10 |
| 15 | Thu nhỏ có thể không đổi `document.visibilityState` sang `hidden` (Wails gọi `chromium.Hide()`, chưa xác minh hiệu ứng lên trang); khi đó cách đo `restore` dựa `visibilitychange` không dùng được | medium | B1b ghi `visibilityState` khi thu nhỏ; không hidden thì `restore` ghi N/A, giai đoạn 2 thêm hook Go `WindowMinimise` cho B4 và chọn lại cách đo restore |
| 16 | Phần "DLL Rust" chỉ là hiệu số (Q4=A), lẫn bộ nhớ native của Wails/COM | low | So trước/sau `dllLoaded` trong cùng phiên |
| 17 | Script không có unit test (PowerShell/Node ngoài `frontend/src`), lỗi tính trung vị, dựng cây process hay đo thời gian khó phát hiện | low | Verifier đối chiếu tổng cây với Task Manager (tab Details, cột Memory (private working set)) ở kịch bản a một lần; đối chiếu `restore` với quay màn hình một lần |
| 18 | Sprint có 13 task nếu giữ hết phác thảo (vượt khoảng 10) | medium | Giai đoạn 2 cắt task không có số đo ủng hộ; vẫn > 10 thì đề xuất chuyển R2 sang sprint-21 |
| 19 | B6 (Fetch all) đổi hành vi vừa thêm ở 21d683a | medium | Chỉ làm khi người dùng đồng ý ở giai đoạn 2 |
| 20 | Đo thời gian UI (Q21=B): thao tác `scroll-after-idle`/`open-tab-after-idle` cần nối CDP trước, chính việc nối có thể "đánh thức" renderer làm số sau idle tốt hơn thực tế | low | Đo trong trang bắt đầu sau khi đã nối (cùng cách cho trước/sau tối ưu); ghi rõ hạn chế trong `summary.md`; so với `-warm` cùng phiên |
| 21 | A5:SQL Mk-2/Navicat có thể không mở được SQLite ở bản người dùng có (chưa xác minh) | low | Ghi N/A cho d, e-sql kèm lý do; a, f vẫn đo |

## 8. Tiêu chí hoàn thành
- [ ] Unit test frontend đạt Branches (C1) và Lines ≥ 95% cho từng file đã đổi; toàn bộ `vitest run` qua, console sạch; test hồi quy Go (tạm) và `cargo test` (với `S3B_REQUIRE_DB=1` khi Docker chạy) đều qua.
- [ ] R1: Chạy `test-env/mem-bench.ps1 -Scenario a -Runs 1` → `summary.md` có Private WS theo loại process (go, browser, renderer, gpu, utility, other), tổng cây, `go_runtime`/`go_heap`/`native_other` từ probe, JS heap, dòng "Sai số build" (`a-nocdp` − `a-release`) và "Sai số CDP" (`a-cdp` − `a-nocdp`), danh sách switch browser của từng chế độ.
- [ ] R1: Chạy `mem-bench.ps1 -Scenario d -Runs 1` không cần thao tác tay → có số d, i2-sql, thời gian Connect SQL lần đầu và lần hai, `open-tab-warm`, `open-tab-after-idle`, `dllLoaded` chuyển true.
- [ ] R1: Chạy `-Scenario b` và `-Scenario c` (có MinIO) → có `scroll-warm`, `scroll-after-idle`, đỉnh upload, và download PASS qua UI Automation hoặc FAIL có lý do mà phiên vẫn chạy tiếp, không còn hộp thoại treo.
- [ ] R1: Kịch bản e có đủ `e-s3-open`, `e-s3-closed`, `e-sql-open`, `e-sql-closed`, `i3`; kịch bản i4 có `restore` (ms) hoặc N/A kèm `visibilityState`.
- [ ] R1: Sau khi chạy script không còn process `S3Browser.exe`/`msedgewebview2.exe` của phiên đo; thư mục `%APPDATA%\S3Browser` và `%APPDATA%\S3Browser.exe` thật không đổi; CSV/log không chứa access key/secret.
- [ ] R1: Mở PR vào `SP-*/release` hoặc `staging` (có đổi code) → job CI `mem-bench` tự chạy kịch bản a trên bản release, push mới huỷ lượt cũ, có artifact `summary.md` (ghi "tham khảo"); PR chỉ đổi tài liệu bị bỏ qua nếu Q22=A.
- [ ] R1: `sprints/sprint-20/measurements.md` có trung vị 3 phiên của a–f và i1–i4 cho S3Browser, bảng thời gian UI (restore, cuộn, mở tab: warm và after-idle; Connect đầu/lần hai), số A5:SQL Mk-2 và Navicat cho a, d, e-sql, f (b, c N/A), `visibilityState` khi thu nhỏ, và lệnh chạy lại (gồm lệnh build bản đo `devtools`).
- [ ] R1: Không có `S3B_MEMPROBE` thì app không tạo file probe và hành vi không đổi.
- [ ] Giai đoạn 2: người dùng đã duyệt % giảm từng kịch bản và danh sách task tối ưu (plan cập nhật).
- [ ] R3: i1–i4 sau tối ưu giảm đúng % đã duyệt; i3 ≤ i1 + 10% (không tính DLL + tokio); `restore` ≤ 300 ms; `scroll-after-idle` và `open-tab-after-idle` chậm hơn số nền R1 không quá 100 ms.
- [ ] R3: Để app không thao tác 5 phút thì `TrimMemory` được gọi đúng 1 lần (probe: `heap/released` tăng); thu nhỏ thì gọi ngay; chưa vào SQL thì DLL vẫn chưa nạp sau trim.
- [ ] R2: Mỗi thay đổi có số đo trước/sau ở kịch bản bị ảnh hưởng; `elapsedMs` trang 10.000 dòng SQLite (bản release) < 40 ms; `scroll-warm` của list 10.000 object không chậm hơn số đo nền.
