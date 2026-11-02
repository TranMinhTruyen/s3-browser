# Sprint 12: Tối ưu hiệu năng

## Mục tiêu
Người dùng thấy app bị lag khi dùng. Ưu tiên ba chỗ người dùng báo lag: đổi ngôn ngữ, đổi font, cuộn danh sách profile. Sau đó giảm độ trễ khi cuộn danh sách object, khi đang upload/download và lúc khởi động, dựa trên kết quả rà soát code (2026-11-02). Cuối sprint refactor toàn bộ backend (R7) và frontend (R8) để code gọn hơn và bỏ code thừa.

## Kết quả rà soát (tóm tắt)

Ước lượng theo mức ảnh hưởng tới người dùng, từ cao xuống thấp. Đây là kết quả đọc code, **chưa đo bằng profiler**.

| # | Vị trí | Vấn đề | Mức |
|---|--------|--------|-----|
| 1 | `frontend/src/common/hooks/useObjectPaging.ts` (`OBJECT_PAGE_SIZE = 20`) | Mỗi trang chỉ 20 object, hàng cao ~104px nên 1 màn hình ≈ 8 hàng: cuộn folder lớn phải chờ một round-trip S3 sau mỗi ~2 màn hình. ListObjectsV2 tốn cùng 1 request cho tới 1000 key. | Cao |
| 1b | `pages/bucket/BucketListView.tsx` (`BUCKET_PAGE_SIZE = 10`) | Danh sách bucket tải 10 bucket mỗi request, trong khi ListBuckets cho tối đa 10000/request. | Trung bình |
| 2 | `ObjectListView.tsx` (effect auto-load) | Chỉ tải trang kế khi còn 2 hàng bên dưới viewport, nên gần như lần nào cũng thấy loader ở cuối. | Cao |
| 3 | `submodule_uploader_mng.go`, `submodule_downloader_mng.go`, `submodule_*_s3.go` | Mỗi file đang chạy có một ticker 200ms và emit một event riêng: tối đa 5 upload + 6 download ≈ 55 event/giây, mỗi event là một `set()` immer và một lần re-render item (RingProgress SVG). | Trung bình–Cao |
| 4 | `UploaderWindow.tsx`, `DownloaderWindow.tsx` | Event progress được đưa thẳng vào store, không gộp theo frame. `selectDownloadingIds` chạy `Object.values().filter().map()` trên toàn bộ lịch sử ở mỗi event. | Trung bình |
| 5 | `pages/object/ObjectItem.tsx` | Mỗi hàng mount một `Menu` Mantine (floating-ui, context) dù hiếm khi mở; `ObjectRow` không `memo` và nhận `menuItems` là JSX mới mỗi lần render. Hàng có chiều cao cố định nhưng vẫn đo bằng `measureElement` (reflow khi cuộn). | Trung bình |
| 6 | `locales/i18n.ts` | Import tĩnh cả 7 ngôn ngữ vào bundle khởi động, dù chỉ dùng 1 (+ `en` fallback). | Trung bình (khởi động) |
| 7 | `common/hooks/useTabPersistence.ts` | Selector `JSON.stringify(serializeTabs())` chạy ở **mọi** thay đổi của `tabListStore` (chọn object, mở drawer, xoá...). | Thấp |
| 8 | `ObjectItem.tsx` selector | `selectionItem.includes` / `deletingItems.includes` là O(n) cho mỗi hàng, mỗi lần store đổi; nặng khi chọn nhiều. | Thấp |
| 9 | `ConnectionProfiles.tsx` | Select nguyên `connectionProfiles`, nên mọi thay đổi 1 profile (vd. `isConnected`) re-render cả navbar. | Thấp |
| 10 | `common/utils/settingUtils.ts` (`applySettings`) | `i18n.changeLanguage` chạy đồng bộ: mọi component có `useTranslation` render lại cùng lúc, kể cả nội dung các tab đang ẩn (`keepMountedMode="display-none"`) và từng hàng object/profile. `t` đổi nên mọi `useCallback`/`useMemo` phụ thuộc `t` cũng tạo lại. | Cao (người dùng báo) |
| 11 | `applySettings` + `getFontFamily` | Đổi font (và đổi ngôn ngữ, vì fallback CJK phụ thuộc ngôn ngữ) ghi `--mantine-font-family` lên `<html>`: tính lại style và layout toàn trang, sau đó mọi `ResizeObserver` (`measureElement` của list object/profile, `TabScroller`, `useElementSize`) cùng bắn, gây thêm một loạt render. | Cao (người dùng báo) |
| 12 | `style.css` | `@font-face` Nunito thiếu `font-display`; JetBrains Mono khai báo 4 weight, lần đầu chọn phải nạp font rồi layout lại. | Thấp |
| 13 | `ConnectionProfileItem.tsx` | Mỗi hàng profile luôn mount một `Menu` + `Menu.ContextMenu` + `Badge`; khi cuộn, hàng mới vào vùng render phải mount lại toàn bộ (floating-ui, context). | Cao (người dùng báo) |
| 14 | `ConnectionProfiles.tsx` (virtualizer) | Đo chiều cao từng hàng bằng `measureElement` với ước lượng 64px; chiều cao thật lệch thì tổng chiều cao đổi trong lúc cuộn (giật thanh cuộn). `overscan: 5` nhỏ. Effect dọn menu phụ thuộc `virtualItems` (mảng mới mỗi render) nên chạy ở mọi lần render. | Trung bình |

Đã kiểm tra, **không** thấy vấn đề: backend `listObject`/`listBucket` (không gọi thêm API theo từng object), danh sách transfer và navbar đã virtualize, modal đã lazy load, devtools zustand chỉ bật ở dev.

## Yêu cầu

### R1: Cuộn danh sách object mượt
- **Mô tả:** Cuộn folder có hàng nghìn object không bị khựng chờ tải trang; hàng render nhẹ hơn.
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** trang object (`ObjectListView`, `ObjectItem`, `useObjectPaging`)
- **Gợi ý hướng làm:**
  - **Kích thước trang (chốt 2026-11-02, người dùng giao chọn phương án nhanh nhất):**
    - Trang đầu của folder: **200** key, để hiện danh sách nhanh (S3/MinIO trả 200 key nhanh hơn 1000, mà 200 hàng đã đủ nhiều màn hình).
    - Các trang sau: **1000** key (mức tối đa của ListObjectsV2 trên cả AWS S3 và MinIO), ít round-trip nhất.
    - Danh sách bucket: tăng `BUCKET_PAGE_SIZE` từ 10 lên **1000**, đa số tài khoản chỉ cần một request.
    - Search giữ `searchPageSize = 1000` như hiện tại.
  - Tải trước (prefetch) trang kế ngay khi còn khoảng **2 màn hình** hàng chưa xem (tính theo số hàng visible), không đợi tới 2 hàng cuối, để người dùng không thấy loader khi cuộn bình thường.
  - Nối trang mới: listing folder không trùng key giữa các trang nên chỉ lọc trùng khi đang search (hiện mỗi trang tạo `Set` toàn bộ key cũ).
  - Chỉ mount `Menu` khi người dùng bấm nút "more actions" (hoặc dùng một menu dùng chung cho cả list); `memo` cho `ObjectRow`.
  - Hàng cao cố định thì dùng `estimateSize` cố định, bỏ `measureElement`.
  - Selection/deleting trong store dùng `Record<string, true>` để tra O(1) (giữ nguyên API action).
- **Tiêu chí chấp nhận:**
  - [ ] Folder ≥ 5000 object: cuộn liên tục không thấy loader ở cuối danh sách trong điều kiện mạng bình thường.
  - [ ] Thời gian hiện trang đầu không chậm hơn hiện tại quá 100ms (đo cả AWS và MinIO).
  - [ ] Bật/tắt chọn một object chỉ re-render đúng hàng đó (kiểm bằng React Profiler).
  - [ ] Không đổi hành vi hiện có: chọn, xoá, tải xuống, mở drawer, tìm kiếm, "load more" sau lỗi.

### R2: Gộp sự kiện tiến trình upload/download
- **Mô tả:** Khi nhiều file đang truyền, UI vẫn phản hồi nhanh (cuộn, đổi tab, mở menu).
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** cửa sổ Uploader/Downloader
- **Gợi ý hướng làm:**
  - **Đã được đồng ý đổi event (2026-11-02):** được thay event progress cũ bằng event batch mới và sinh lại bindings, miễn giảm lag.
  - Backend: một ticker chung cho mỗi loại transfer, mỗi chu kỳ emit **một** event chứa mảng progress của mọi job đang chạy (event mới, khai báo trong `events.go`, sinh lại bindings).
  - Frontend: một action `set()` cập nhật cả batch; nếu vẫn giữ event cũ thì gom event theo `requestAnimationFrame` trước khi ghi store.
  - Lưu sẵn danh sách id đang DOWNLOADING trong store thay vì lọc lại toàn bộ lịch sử mỗi event.
- **Tiêu chí chấp nhận:**
  - [ ] 5 upload + 6 download đồng thời: tối đa ~5 lần ghi store/giây cho mỗi loại transfer.
  - [ ] Phần trăm, dung lượng, trạng thái "finalizing", huỷ một/huỷ tất cả vẫn đúng.

### R3: Giảm thời gian khởi động
- **Mô tả:** App mở nhanh hơn, bundle khởi động nhỏ hơn.
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** khởi động app, đổi ngôn ngữ trong Setting
- **Gợi ý hướng làm:** Chỉ nạp sẵn `en` + ngôn ngữ đang chọn; ngôn ngữ khác `import()` động khi người dùng đổi (dùng `i18n.addResourceBundle`). So sánh kích thước bundle trước/sau bằng `vite build`.
- **Tiêu chí chấp nhận:**
  - [ ] Chunk khởi động không còn chứa locale của ngôn ngữ không dùng.
  - [ ] Đổi ngôn ngữ không nháy key thô, không có warning i18next thiếu key trong console.

### R4: Dọn re-render thừa
- **Mô tả:** Giảm việc tính toán lặp lại không cần thiết trong store và component.
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** `useTabPersistence`, `ConnectionProfiles`
- **Gợi ý hướng làm:**
  - `useTabPersistence`: selector hẹp (thứ tự tab, `activeTab`, `profileId` qua `useShallow`), chỉ `JSON.stringify` khi các giá trị đó đổi.
  - `ConnectionProfiles`: select danh sách id bằng `useShallow`, mỗi `ConnectionProfileItem` tự select profile của mình.
- **Tiêu chí chấp nhận:**
  - [ ] Chọn object, mở/đóng drawer không chạy lại serialize tab.
  - [ ] Connect/disconnect một profile chỉ re-render item của profile đó.

### R5: Đổi ngôn ngữ và font không bị khựng
- **Mô tả:** Chọn ngôn ngữ hoặc font trong Setting (xem trước trực tiếp) thì giao diện đổi ngay, không đơ.
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** modal Setting, toàn bộ app
- **Gợi ý hướng làm:**
  - Bọc nội dung tab không active bằng `<Activity mode="hidden">` của React 19 (giữ state như hiện tại nhưng hoãn render tab ẩn), thay cho chỉ `display: none`.
  - Giảm số component đăng ký i18n: hàng object/profile không gọi `useTranslation` riêng, nhãn lấy từ component cha hoặc chỉ có khi menu mở (đi cùng R1, R6).
  - Thử đưa việc đổi ngôn ngữ vào `startTransition` để UI vẫn phản hồi; cần kiểm tra `react-i18next` bản đang dùng có cho phép cập nhật dạng transition không.
  - Hàng list có chiều cao cố định thì bỏ `measureElement` để đổi font không kích hoạt đo lại hàng loạt; cân nhắc `contain: content` cho hàng.
  - Thêm `font-display: swap` cho Nunito; chỉ nạp các weight JetBrains Mono thực sự dùng.
- **Tiêu chí chấp nhận:**
  - [ ] Có 3 tab đã mở với list object dài: đổi ngôn ngữ/font, thời gian commit React và task dài trên main thread giảm rõ so với baseline (ghi số liệu).
  - [ ] Tab ẩn vẫn giữ nguyên state (folder, vị trí cuộn, lựa chọn) khi quay lại.
  - [ ] Revert/Apply/Save trong Setting vẫn đúng; không có key thô hay warning i18next.

### R6: Cuộn danh sách profile mượt
- **Mô tả:** Cuộn navbar profile không giật, kể cả khi có nhiều profile.
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** navbar trái (`ConnectionProfiles`, `ConnectionProfileItem`)
- **Hiện tượng người dùng báo (2026-11-02):** khoảng 200 profile; kéo thanh cuộn thì lag, và thumb bị lệch so với vị trí chuột.
- **Nguyên nhân lệch:** `ESTIMATED_ITEM_HEIGHT = 64` nhưng hàng thật cao khoảng 68px (viền 2 + padding 16 + 2 dòng chữ ~24.8px theo theme mặc định). Hàng chưa đo tính theo 64px, nên khi kéo, từng hàng mới được `measureElement` đo lại làm `getTotalSize()` tăng dần (~4px × 200 ≈ 800px), thumb nhảy và không còn khớp với chuột. Chiều cao dòng còn đổi theo font (R5), nên một hằng số ước lượng không đủ.
- **Gợi ý hướng làm:**
  - Cố định chiều cao hàng bằng CSS (`Card` có `h` cố định, chữ `truncate`) và dùng đúng giá trị đó cho `estimateSize`, bỏ `measureElement`, để tổng chiều cao không đổi khi cuộn hay đổi font.
  - Chỉ mount `Menu` cho hàng đang mở context menu (hoặc một menu dùng chung định vị theo chuột); hàng thường chỉ là `Card`.
  - Chiều cao hàng cố định + `estimateSize` đúng, bỏ `measureElement`; tăng `overscan`.
  - Effect dọn menu phụ thuộc giá trị ổn định (key đang mở có nằm trong range hay không) thay vì `virtualItems`.
  - Gộp với R4: mỗi item tự select profile của mình.
- **Tiêu chí chấp nhận:**
  - [ ] 200 profile: cuộn liên tục không có task dài > 50ms (tab Performance).
  - [ ] Kéo thanh cuộn từ đầu tới cuối: thumb bám theo chuột, chiều cao nội dung (`scrollHeight`) không đổi trong lúc kéo, với mọi font.
  - [ ] Chuột phải, double-click connect, connect/disconnect/edit/delete vẫn hoạt động như cũ.

### R7: Refactor backend, bỏ code thừa
- **Mô tả:** Người dùng muốn code gọn hơn, bỏ code thừa trên toàn repo (chốt 2026-11-02: phạm vi toàn bộ FE + BE, làm hết trong sprint-12). R7 làm **backend Go + config**, R8 làm frontend. Hành vi app giữ nguyên.
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** không đổi UI
- **Phạm vi:**
  - Bỏ code chết: export/hàm/type/hằng không còn ai dùng (ngoài test), key i18n không còn dùng (xoá ở cả 7 ngôn ngữ), message code Go không còn dùng (xoá cả key trong `ipcMessage.json`), cấu hình thừa (vd. `.golangci.yml` còn loại trừ `rabbitmq` dù project không dùng).
  - Gộp code lặp: vd. các đoạn xử lý lỗi lặp lại trong submodule Go (`isCallCanceled` → `isCredentialsExpired` → `ThrowError`), logic job/cancel giống nhau giữa uploader và downloader.
  - Rút gọn hàm quá dài khi việc tách làm code dễ đọc hơn, không tách chỉ để file ngắn lại.
  - Công cụ: được phép cài `golang.org/x/tools/cmd/deadcode` vào `tool (...)` của `go.mod`, gọi bằng `go tool deadcode ./...` (người dùng đồng ý 2026-11-02). Kết quả là gợi ý, phải kiểm tra trước khi xoá (hàm Wails gọi qua binding có thể bị báo nhầm).
  - Message code bị xoá thì xoá luôn key trong `ipcMessage.json` của cả 7 ngôn ngữ (chỉ đụng file locale, không refactor FE).
  - Comment: giữ **tiếng Anh** như hiện tại (chốt 2026-11-02, không làm song ngữ); sửa comment sai/lỗi thời, bỏ comment chỉ lặp lại nội dung code.
- **Cách chia branch (đề xuất cho planner):** làm **sau** R1–R6 để không conflict; 2 branch/PR: (a) BE `modules/bucket`, (b) BE còn lại + config.
- **Tiêu chí chấp nhận:**
  - [ ] `go vet`, `go build`, `golangci-lint`, `go tool deadcode` (đã xử lý hết mục đúng) đều sạch.
  - [ ] Không đổi hành vi: test FE hiện có vẫn pass; BE kiểm tay theo `test-env/test-profiles.txt`.
  - [ ] Bindings sinh lại khớp; không sửa tay `frontend/bindings/**`, `internal/pkg/db/sqlc/**`.
  - [ ] `report.md` liệt kê số dòng xoá/thêm theo vùng và danh sách code đã xoá.

### R8: Refactor frontend, bỏ code thừa
- **Mô tả:** Frontend gọn hơn, bỏ code thừa, hành vi app giữ nguyên. Làm sau R7.
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** không đổi UI
- **Phạm vi:**
  - Bỏ code chết: cài `knip` làm devDependency bằng `bun add -d knip` (người dùng đồng ý 2026-11-02), cấu hình tối thiểu (entry `src/main.tsx`, project `src/**`, bỏ qua `bindings/**`; `src/test/**` chỉ tính là nơi dùng của test). Kết quả là gợi ý: export chỉ còn test dùng thì xem xét xoá cả export lẫn test; type re-export cho binding thì giữ.
  - Key i18n không còn dùng: xoá ở cả 7 ngôn ngữ, giữ đúng tập key giữa các ngôn ngữ.
  - Gộp code lặp: `UploaderItem`/`DownloaderItem`, `UploaderWindow`/`DownloaderWindow` (tách phần chung: hàng tiến trình, khung cửa sổ); các action trong `tabListStore.ts` lặp cùng mẫu "lấy tab rồi sửa".
  - Rút gọn `ConnectModal.tsx`, `UploadPickerModal.tsx`, `connectSchema.ts` khi việc tách làm code dễ đọc hơn, không tách chỉ để file ngắn lại.
  - Comment giữ **tiếng Anh** (chốt 2026-11-02, không làm song ngữ); sửa comment sai/lỗi thời, bỏ comment chỉ lặp lại code.
  - Không làm mất các tối ưu của R1–R6 (chiều cao hàng cố định, menu mount khi cần, `Activity` cho tab ẩn...): so sánh nhanh bằng React Profiler trước/sau R8.
- **Cách chia branch (đề xuất cho planner):** làm **sau** R7, mỗi vùng một branch/PR, tuần tự: (c) `common/` (hooks, stores, utils, cài `knip`), (d) `components/`, (e) `pages/` + locale.
- **Tiêu chí chấp nhận:**
  - [ ] `tsc --noEmit`, biome, oxlint đều sạch; `knip` không còn báo mục nào, hoặc mục còn lại có ghi lý do giữ trong `report.md`.
  - [ ] Mọi file FE đã sửa đạt C1 ≥ 95% và Lines ≥ 95%, kể cả file chỉ bị xoá code; console sạch khi chạy test.
  - [ ] Test FE hiện có vẫn pass mà **không** phải sửa assert (chỉ sửa import/đường dẫn khi file bị gộp/đổi tên).
  - [ ] Không có warning i18next thiếu key khi chạy app và test; không sửa tay `frontend/bindings/**`.
  - [ ] `report.md` liệt kê số dòng xoá/thêm theo vùng và danh sách code đã xoá.

## Ngoài phạm vi
- Thay đổi giao diện hay tính năng mới.
- Viết unit test backend Go (theo quy ước hiện tại).
- Đổi thư viện UI/state (Mantine, zustand, immer).

## Ràng buộc / ghi chú
- **Đo trên bản dev và bản build:** người dùng thấy lag trên bản dev. Bản dev chậm hơn bản build vì `StrictMode` (`main.tsx`) render mỗi component 2 lần, React dùng bản development (có kiểm tra thêm), code chưa minify, và Vite phục vụ từng module riêng. Vì vậy:
  - Việc đầu tiên của sprint: build bản production (`go tool wails3 task build`) và đo baseline cho đổi ngôn ngữ, đổi font, kéo thanh cuộn profile, trên **cả hai bản**.
  - Lỗi thanh cuộn profile bị lệch (R6) là lỗi logic, xảy ra ở cả hai bản: luôn sửa.
  - Lỗi chỉ thấy trên bản dev thì không tối ưu riêng cho dev; **không** bỏ `StrictMode` và không tắt kiểm tra dev để "hết lag".
  - Yêu cầu nào trên bản build đã mượt (không có task dài > 50ms) thì báo lại người dùng trước khi làm, có thể dời sang sprint sau.
- Mỗi yêu cầu đo **trước và sau** bằng React Profiler / tab Performance của DevTools WebView2, ghi số liệu cả bản dev và bản build vào `report.md`.
- Giữ coverage FE C1 ≥ 95% cho mọi file đã đổi, console sạch khi chạy test.
- R2 đổi event backend: frontend và backend phải đổi trong cùng branch.

## Câu hỏi đã biết
1. ~~Lag rõ nhất ở đâu?~~ Đã trả lời (2026-11-02): đổi ngôn ngữ, đổi font, cuộn danh sách profile; cuộn object và upload/download cũng hơi lag, cần đo lại. Thứ tự ưu tiên: R5, R6, R1, R2, R4, R3, rồi R7, R8.
2. ~~Lag thấy trên bản nào?~~ Đã trả lời (2026-11-02): bản dev (`go tool wails3 task dev`). Xem mục "Đo trên bản dev và bản build" ở phần Ràng buộc.
3. Quy mô dữ liệu thường dùng: số object trong một folder, số tab mở cùng lúc, số profile? Số profile: khoảng 200 (người dùng báo 2026-11-02), nên giữ virtualize cho navbar.
4. ~~Kích thước trang?~~ Người dùng giao chọn phương án nhanh nhất (2026-11-02): xem R1 (200 trang đầu, 1000 các trang sau, bucket 1000).
5. ~~Đổi event R2?~~ Đồng ý (2026-11-02).
6. ~~Cài công cụ tìm code chết?~~ Đồng ý (2026-11-02): `deadcode` cho R7, `knip` cho R8.
7. ~~Tách refactor?~~ Ban đầu chia 2 sprint, sau đó người dùng chốt gộp hết vào sprint-12 (2026-11-02): R7 backend, R8 frontend. Sprint sẽ dài; orchestrator có thể dừng sau từng branch để người dùng review.
