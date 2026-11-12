# Plan sprint-18

> Sprint chỉ có frontend (UX/UI chế độ SQL, dữ liệu mock trong RAM). Không có task native/backend, không sinh lại bindings.
> Lưu ý: planner không có tool chạy lệnh nên không chạy được `graphify query`/`git status`/`git show`; plan dựa trên Glob/Grep/Read các file nêu bên dưới.
> Docs Wails (https://v3.wails.io/) trả 403 như memory đã ghi; sprint không dùng API Wails mới nào.
> Cập nhật 2026-11-10: người dùng đã trả lời Q1–Q23 (mục 2), không còn câu hỏi mở.
> Cập nhật 2026-11-10 (lần 2): người dùng thêm vào R1 việc bỏ `react-router-dom` (D24), thuộc task F1, cùng branch `SP-18/sql_mode_ui`.
> Cập nhật 2026-11-11 (lần 3): người dùng chốt **D26** — giữ tái cấu trúc thư mục frontend đã có trong working tree, đưa vào **một commit refactor riêng trước R1** (task F0). Cây thư mục mới thay D12/D23; đường dẫn file của F1–F9 và bảng test đã đổi theo cây thực tế (đọc bằng Glob ngày 2026-11-11).
> Cập nhật 2026-11-11 (lần 4): người dùng trả lời Q24–Q26 → **D27** (giữ `StatusDot` ở nhãn tab S3), **D13** sửa theo Q25 (chấm trạng thái kết nối), **D28** (cách chia commit), **D29** (file ngoài sprint).
> Cập nhật 2026-11-11 (lần 5): người dùng chốt **D30** (giữ CSS dải tab mới), **D29 sửa**, **D31** (5 mục sửa low giao react-frontend, thêm vào F1/F2/F4/F6/F8), **D32** (2 mục chỉ ghi report). Mở **Q27**.
> Cập nhật 2026-11-12 (lần 6): người dùng đã duyệt plan. **Q27 = C** (A + B, xem D31a). Quyết định git mới **D33**: giữ nguyên commit tạm `a3d1486 chore(temp): all change file in sprint-18` (674 file, đã có trên `origin/SP-18/release` và `origin/SP-18/sql_mode_ui`), **bỏ** việc chia commit C1/R0..R9 của D1/D28/D29; phần còn lại làm tiếp trên `SP-18/sql_mode_ui` rồi commit mới. Không còn câu hỏi mở.

## 1. Tóm tắt yêu cầu

- R0 (refactor, D26): chuyển code S3 vào `pages/s3/`, dải tab dùng chung vào `components/tabs/`, code SQL theo cây `pages/sql/`; không đổi hành vi S3 (ngoại lệ có chủ ý: CSS dải tab D30). Kèm sửa nội dung `docs/ARCHITECTURE*.md` (7 bản) và `docs/scripts/{shots.mjs,annotations.json}` theo cây mới (D29). **Đã nằm trong `a3d1486` (D33)**, còn lại chỉ kiểm/sửa.
- R1: `SegmentedControl` S3/SQL trên header (`MainLayout`, vùng `no-drag`), đổi **toàn bộ thân app**; chuyển qua lại giữ nguyên state hai bên; Downloader/Uploader vẫn chạy ở cả hai chế độ; double-click lên control không maximize. **Bỏ react-router** (D24): `App` render thẳng `MainLayout`, `MainLayout` lazy `S3Workspace`/`SqlWorkspace`, xoá `RouterItem.tsx`, gỡ `react-router-dom`. Chunk tải lỗi phải thử lại được: chọn lại chế độ **hoặc** bấm nút "Thử lại" (D31a, Q27 = C).
- R2: Navbar SQL giống navbar S3 (`S3Navbar`): nhóm nút (Connect/Tạo/Import/Refresh), danh sách profile DB virtualize, menu chuột phải (Connect/Disconnect, Edit, Export, Delete). Profile mock (PostgreSQL + SQLite) khai báo ở một file, store RAM.
- R3: Modal tạo/sửa profile DB (bố cục giống `ConnectModal`), validate zod, lưu vào store RAM, footer theo quy ước modal.
- R4: Dải tab SQL giống S3 (thêm/đóng/kéo thả/Ctrl+Shift+←→/tự cuộn/animation), tab chỉ mount khi mở lần đầu và giữ state khi ẩn, store tab riêng. Sau D26 dùng chung `components/tabs/TabStrip`. Nhãn tab S3 và SQL cùng có chấm `StatusDot` theo trạng thái kết nối (D27, D13).
- R5: Header mỗi tab SQL giống `TabActionBar`: Combobox profile, Connect (giả), Execute (toast tên profile + toàn bộ SQL).
- R6: Editor CodeMirror 6 (tô màu SQL, số dòng) ở `pages/sql/components/sqlEditor/` (D26), theme lấy từ biến Mantine, font theo Settings, tắt keymap xung đột, chặn hành vi mặc định WebView2 cho Ctrl+F/E/Q. Có hint khi gõ (autocomplete): từ khoá theo dialect + tên bảng/cột từ schema mock của profile đang chọn (D25).
- R7: Ctrl+Q format bằng `sql-formatter` theo dialect của profile (toàn bộ hoặc phần chọn), một bước undo, lỗi cú pháp thì toast lỗi.
- R8: Ctrl+F mở hộp Find/Replace không chặn editor (Find next, đếm `i/n`, Replace, Replace all), Esc/Cancel đóng và trả focus.
- R9: Ctrl+E: toast tên profile + phần chọn (hoặc toàn bộ), cảnh báo khi chưa chọn profile hoặc nội dung rỗng.

### Đối chiếu S3 đã kiểm trong code (để bám "giống S3")

> Bảng này ghi lúc lập plan (trước D26), đường dẫn là đường dẫn **cũ**. Đường dẫn hiện tại xem bảng ánh xạ ở D26 (mục 2).

| Thành phần S3 | File (cũ → mới) | Hành vi cần chép / điểm khác |
|---|---|---|
| Header | `components/layouts/MainLayout.tsx` (không đổi chỗ) | `onDoubleClickHeader` cũ chỉ bỏ qua khi target nằm trong `button`. `SegmentedControl` Mantine render `input[type=radio]` + `label`, **không phải button** → phải sửa điều kiện (F1; đã thành `closest('button, [data-no-maximise]')`). |
| Thân app | `MainLayout.tsx` + `components/router/RouterItem.tsx` (xoá) → `pages/s3/S3Workspace.tsx` | `Splitter` (navbar 18% min 18%, page 85% min 50%, `p="4px"`). Trước D24 `TabPage` là `lazy()` qua `<Outlet/>`, app **không có `Suspense` hay ErrorBoundary**. |
| Router | `App.tsx`, `components/router/RouterItem.tsx` | Đã kiểm trước D24: chỉ một route `/` → `TabPage`, không có `useNavigate`/`Link`/`useParams`/`useLocation`. Ngày 2026-11-11 grep `frontend/` (trừ `node_modules`) không còn `react-router`, `components/router`, `pages/tab/`. |
| Navbar | `components/layouts/navbar/{LeftNavbar,HeaderButtonGroup,ConnectionProfiles,ConnectionProfileItem}.tsx` → `pages/s3/navbar/{S3Navbar,S3HeaderButtonGroup,ConnectionProfiles,ConnectionProfileItem}.tsx`; `ConnectionProfileItem.module.css` → `components/display/ProfileCard.module.css` (dùng chung với `DbProfileItem`) | Icon: `PlugZap`, `ListPlus`, `FileUp`, `RefreshCw` (Refresh `ml="auto"`). Một `Menu` dùng chung mount theo `menuKey`. Menu: Connect khi chưa kết nối, Disconnect (đỏ) khi đã kết nối, **Edit ẩn khi đã kết nối**, Export, Divider, Delete (đỏ). Delete đang kết nối hỏi `C000003` rồi `C000002`. Double-click card = Connect. `CARD_HEIGHT = 68`, `ROW_GAP = 8`, `overscan: 10`. |
| Tab strip | `pages/tab/{TabPage,SortableTab,TabDragPreview,TabScroller}.tsx`, `tabConst.ts`, `SortableTab.module.css` → `components/tabs/{TabStrip,SortableTab,TabDragPreview,TabScroller}.tsx`, `tabConst.ts`, `SortableTab.module.css`; `pages/s3/S3TabPage.tsx` chỉ còn bọc `TabStrip` | `PointerSensor` distance 5, `SWAP_COVER_RATIO 0.9`, overlay `restrictToHorizontalAxis` + `restrictToFirstScrollableAncestor`, portal `document.body`, `visited` cập nhật trong render, scrollIntoView khi đổi tab/thêm/đóng. S3 bọc detail bằng `Activity`, SQL không (D10). Tooltip tab (`close`, `drag`, `add`, `scrollLeft`, `scrollRight`) nay ở namespace `common` (`common:tab.*`). CSS dải tab đổi kiểu (D30). |
| Nhãn tab | `pages/tab/components/TabLabel.tsx` → `pages/s3/components/TabLabel.tsx` | Trước D26: hiện tên profile **chỉ khi đã kết nối**, không có chấm. Hiện tại (đọc 2026-11-11): có `StatusDot` khi tab có profile (xanh đã kết nối, đỏ chưa), tên vẫn chỉ hiện khi đã kết nối → giữ theo **D27**. |
| Header tab | `pages/tab/components/{TabActionBar,TabDetail}.tsx` → `pages/s3/components/` | Combobox `width 200px`, `searchPlaceholder`/`emptyText` từ `tabLayout.search.*`; Connect disable khi `isConnected || !selectedProfileId`. |
| Modal profile | `components/modals/connect/{ConnectModal.tsx,connectSchema.ts}` → `pages/s3/modals/connect/` | Header `INFO_BG_COLOR` + title giữa + `CloseButton`; không `Paper withBorder`, không nút Cancel. Edit hỏi `C000001` rồi giữ modal mở; Create đóng modal. |
| Validate | `common/hooks/useFieldError.ts` (không đổi), `locales/*/messages/validateMessage.json` | Mã `V000001`..`V000012`; thêm `V000013` (D21). |
| Font | `common/utils/settingUtils.ts`, `common/cnst/settingConst.ts` (không đổi) | Đổi font ghi `--mantine-font-family` lên `document.documentElement.style` → editor dùng biến này. CodeMirror base theme đặt `monospace` cho `.cm-scroller` → theme phải ghi đè (F6). |

## 2. Câu hỏi chưa rõ và quyết định đã chốt

### Câu hỏi mở

Không còn câu hỏi mở (Q1–Q27 đã trả lời).

| # | Câu hỏi | Đề xuất | Trả lời |
|---|---|---|---|
| Q27 | D31 yêu cầu chunk workspace tải lỗi "phải thử lại được". Thử lại được kích hoạt bằng gì? | A: chọn lại chế độ trên `SegmentedControl`. B: nút "Thử lại" trong vùng rỗng (key `common:retry`). C: A + B. | **Đã trả lời 2026-11-12: C (A + B)** → ghi ở D31a. |

### Quyết định đã chốt

Người dùng trả lời ngày 2026-11-10. Q1, Q2, Q14, Q15, Q16 có trả lời riêng; các câu còn lại theo đúng đề xuất. D24, D25, D26 do người dùng thêm sau. D27–D29 (và sửa D13) từ trả lời Q24–Q26 ngày 2026-11-11. D30–D32 (và sửa D28, D29) ngày 2026-11-11 lần 5. Q27 và D33 ngày 2026-11-12.

| # | Nội dung | Quyết định |
|---|---|---|
| D1 (Q1) | Gộp branch | **Một** branch `SP-18/sql_mode_ui` cho R0–R9. Phần "mỗi R một commit", commit `chore` riêng cho `biome.json` và commit refactor R0 riêng **đã bị thay bởi D33**. |
| D2 (Q2) | Tách sprint | **Không tách** sprint. |
| D3 (Q3) | Điều kiện Execute / Ctrl+E | Chỉ cần **đã chọn profile**, không cần đã Connect. |
| D4 (Q4) | Nhớ chế độ S3/SQL sau khi tắt app | Không; luôn mở ở S3 (`useState` trong `MainLayout`, không ghi `settings.json`). |
| D5 (Q5) | Hai tab chọn cùng profile | Được (như S3). |
| D6 (Q6) | Tab trống ban đầu | Có 1 tab trống khi mở SQL lần đầu. |
| D7 (Q7) | Trường form R3 | PostgreSQL: host (bắt buộc), port (bắt buộc, số 1–65535, mặc định 5432), database (bắt buộc), username (bắt buộc), password (không bắt buộc, `PasswordInput`), SSL mode (`Select`: `disable`, `allow`, `prefer`, `require`, `verify-ca`, `verify-full`, mặc định `prefer`). SQLite: đường dẫn file (bắt buộc) + nút chọn file hiện toast. Chung: tên (bắt buộc, mặc định `Connection No.<uuid>`), màu, loại DB (`SegmentedControl`, mặc định PostgreSQL). Không thêm schema mặc định, timeout, SSL cert, autoConnect, savePassword, Test connection. |
| D8 (Q8) | Find | Không phân biệt hoa/thường, không regex/whole word. Điền sẵn khi phần chọn khác rỗng và không chứa xuống dòng; nhiều dòng thì giữ giá trị cũ. |
| D9 (Q9) | Ẩn chế độ không hiển thị | `display: none` cho **cả hai** cây (giữ mount, effect vẫn chạy); cây SQL chỉ mount sau lần chọn SQL đầu tiên; không dùng `Activity` ở cấp chế độ. |
| D10 (Q10) | Ẩn tab SQL | Phương án A: không dùng `Activity`; `Tabs keepMountedMode="display-none"` + `visited` (tab mount khi mở lần đầu, editor giữ doc/undo/vùng chọn/scroll). |
| D11 (Q11) | Nơi lưu nội dung editor | `sqlTabStore` chỉ giữ metadata tab (thứ tự, tab đang chọn, `profileId`); nội dung, vùng chọn, undo nằm trong `EditorState` trong component; Execute/Ctrl+E đọc text từ `EditorView`. |
| D12 (Q12) | Dùng lại file S3 | **Thay bởi D26.** Nay: dải tab dùng chung `components/tabs/` (`TabStrip` nhận store qua prop, không còn `SqlSortableTab`/`SqlTabDragPreview`); CSS card profile dùng chung `components/display/ProfileCard.module.css`; `common/cnst/motionConst.ts` giữ nguyên chỗ. Navbar, nhãn tab, action bar, modal SQL vẫn là bản riêng (đọc store SQL). |
| D13 (Q13, Q25) | Nhãn tab SQL | Hiện tên khi **đã chọn** profile (kể cả chưa kết nối); chưa chọn hoặc profile bị xoá → `sqlTab:title.defaultTabName`. Chấm bên trái tên là **`components/display/StatusDot`** (10px, xanh `--mantine-color-green-6` = đã kết nối, đỏ `--mantine-color-red-6` = chưa), chỉ hiện khi đã chọn profile. `SqlTabLabel.test.tsx` sửa cho khớp — đổi hành vi có chủ ý theo Q25, ghi trong báo cáo. |
| D14 (Q14) | Nhãn mặc định tab SQL | **"New query"**, key `sqlTab:title.defaultTabName`, dịch đủ 7 ngôn ngữ: en "New query", vi "Truy vấn mới", ja "新しいクエリ", zh-CN "新查询", zh-TW "新查詢", ru "Новый запрос", de "Neue Abfrage". |
| D15 (Q15) | Font editor | **Theo font trong Settings**: `font-family: var(--mantine-font-family)`, `font-size: var(--mantine-font-size-sm)`; không cố định monospace. Ghi đè font của `.cm-scroller`/`.cm-content`/`.cm-gutters`. |
| D16 (Q16) | Package | Cài đúng 8 package bằng **bun**: `@codemirror/state`, `@codemirror/view`, `@codemirror/commands`, `@codemirror/language`, `@codemirror/lang-sql`, `@codemirror/search`, `@lezer/highlight`, `sql-formatter`. Không cài meta package `codemirror`. |
| D17 (Q17) | Luồng Lưu modal R3 | Create: lưu, toast, đóng. Edit: hỏi `C000001`, lưu, toast, **đóng modal**. Footer: Cancel (đỏ) trái, Save phải; không Test connection. Thân bọc `<Paper withBorder>`. |
| D18 (Q18) | Toast có SQL | Cắt 500 ký tự + `…`, ở `description`, `white-space: pre-wrap`, font monospace (`var(--mantine-font-family-monospace)`), tối đa 10 dòng; tiêu đề là tên profile. |
| D19 (Q19) | Vị trí SegmentedControl | Bên trái, ngay sau tên app, `Group` `no-drag` riêng, `size="xs"`. |
| D20 (Q20) | Hiệu năng format | Main thread; `sql-formatter` nạp động ở lần Ctrl+Q đầu; `formatDialect` với 3 dialect (`sql`, `postgresql`, `sqlite`). Đo tay 5.000 dòng; > 500 ms thì mở sprint sau chuyển sang worker. |
| D21 (Q21) | Tên trùng | So sau `trim`, không phân biệt hoa/thường, chỉ trong profile DB, edit bỏ qua chính nó. Mã `V000013`: "{0} already exists" trong `validateMessage.json` 7 ngôn ngữ. |
| D22 (Q22) | Kết nối giả | Connect tức thì. Edit ẩn khi đang kết nối. Delete profile đang kết nối hỏi `C000003` rồi `C000002`. Disconnect không hỏi. Profile bị xoá: tab dùng nó về `profileId = null`. |
| D23 (Q23) | Thư mục code | **Thay bởi D26.** Giữ phần còn hiệu lực: code SQL ở `pages/sql/**` (store `pages/sql/stores/`, mock `pages/sql/mock/`); modal DB import trực tiếp trong chunk SQL, không thêm vào `lazyModals.ts`. |
| D24 | Bỏ react-router | Thuộc R1/F1. `App.tsx` render thẳng `<MainLayout />`; xoá `components/router/RouterItem.tsx`; `bun remove react-router-dom`. `MainLayout` có `WORKSPACES` (`mode`, `labelKey`, `errorKey`, `load`) cho `@/pages/s3/S3Workspace` và `@/pages/sql/SqlWorkspace`, lỗi tải chunk → toast `common:s3LoadError`/`common:sqlLoadError` (thử lại theo D31a); state `visited: Set<AppMode>` (khởi tạo `S3`), giữ mount bằng `display: none`; fallback `Center h="100%"` + `Loader`. `S3Workspace` = `Splitter` + `S3Navbar` + `S3TabPage` (import tĩnh). Phần ARCHITECTURE nhắc router/`RouterItem` sửa theo D29. |
| D25 | Hint khi gõ SQL (autocomplete) | Ghép vào R6/F6. Từ khoá/hàm/kiểu theo dialect (`lang-sql`) **và** tên bảng/cột từ schema mock của profile đang chọn (chưa chọn hoặc không có schema → chỉ từ khoá). Tự hiện khi gõ + Ctrl+Space; ↑/↓ chọn, Enter/Tab nhận, Esc đóng. `bun add @codemirror/autocomplete`. Schema mock ở `pages/sql/mock/dbSchemaMock.ts` (comment `TODO(sprint backend DB)`). |
| D26 | Tái cấu trúc thư mục frontend | Giữ nguyên tái cấu trúc đã có. Cây mới thay D12/D23. Nội dung S3 không đổi hành vi (ngoại lệ: D27, D30); file S3 chỉ di chuyển (đổi đường dẫn import) là chấp nhận được. Bảng ánh xạ bên dưới. Phần "commit refactor riêng trước R1" **thay bởi D33** (refactor đã nằm trong `a3d1486`). |
| D27 (Q24) | `StatusDot` ở nhãn tab S3 | **Giữ** chấm `StatusDot` trong `pages/s3/components/TabLabel.tsx` (tab có profile → chấm xanh/đỏ; tên vẫn chỉ hiện khi đã kết nối). **Đổi hành vi S3 có chủ ý**, ghi trong báo cáo và mô tả PR. Phần "thuộc commit R4" **thay bởi D33**. |
| D28 (Q26) | Chia commit | **Thay bởi D33** (không chia commit theo R nữa). Phần còn hiệu lực: `frontend/bun.lock` bị gitignore, **không track**, không commit; `.claude/**`, `CLAUDE.md` không commit; stage theo đường dẫn cụ thể. |
| D29 (sửa lần 5) | File ngoài `frontend/` | `biome.json` (`$schema` 2.6.6), `docs/ARCHITECTURE*.md` (7 bản), `docs/scripts/{shots.mjs,annotations.json}` **đã nằm trong `a3d1486`** (D33), không còn commit `chore` riêng. Còn lại: kiểm nội dung 7 bản ARCHITECTURE khớp code mới (bỏ `RouterItem`/react-router; `S3Workspace`/`SqlWorkspace` lazy trong `MainLayout`; cây `pages/<mode>/{stores,hooks,utils,modals,navbar,components,transfer}`; `components/tabs/`; state không còn ở `common/stores`), sửa nếu chưa đúng (F0). `.claude/**`, `CLAUDE.md`: không đưa vào commit nào. |
| D30 | CSS dải tab | **Giữ** thay đổi `frontend/src/components/tabs/SortableTab.module.css`: bỏ vạch phân cách kiểu Chrome `.wrapper::after`, viền 1px cho tab chưa chọn, tab active viền trong suốt. Đổi giao diện S3 có chủ ý (áp cả SQL), đã nằm trong `a3d1486`. Ảnh docs có dải tab có thể lệch giao diện → ghi vào report, không chụp lại trong sprint này. |
| D31 | Mục low giao react-frontend | (a) F1 `MainLayout.tsx`: chunk lỗi phải thử lại được, không cache lazy rỗng — **theo Q27 = C** (xem D31a bên dưới). (b) F8 `FindReplacePanel.tsx` dòng 130: footer `Group` thêm `p="8px"`. (c) F2/F4: `reset()` của `dbProfileStore` (dòng 76–77) và `sqlTabStore` (dòng 106–107) gọi `invalidateLoads(SCOPE)` (`common/utils/ipcUtils.ts`) theo quy ước store. (d) F6 `SqlEditor.tsx`: effect dòng 83–86 chạy cả lúc mount và `dispatch` reconfigure trùng với cấu hình vừa tạo ở dòng 55 → bỏ lần reconfigure thừa lúc mount (chỉ reconfigure khi dialect/schema đổi so với giá trị đã dùng). (e) F2 `DbProfileItem.tsx` dòng 43: đang select nguyên object profile (`s.dbProfiles[profileKey]`) → selector hẹp từng field hoặc `useShallow`. Chỉ SQL, **không** sửa `pages/s3/navbar/ConnectionProfileItem.tsx`. (Số dòng ghi ngày 2026-11-11, có thể lệch sau `a3d1486`.) |
| D31a (Q27 = C) | Thử lại khi chunk workspace tải lỗi | **A + B.** (A) Lỗi tải chunk → `toast.error` như cũ (`common:s3LoadError`/`common:sqlLoadError` + description); `lazy` của chế độ đó được **tạo lại** (không giữ component rỗng trong cache) và chế độ bị bỏ khỏi `visited`; người dùng **chọn lại chế độ** trên `SegmentedControl` là tải lại (S3 lỗi lúc khởi động: chọn SQL rồi S3). (B) **Đồng thời**, khi chế độ đang hiển thị không nằm trong `visited` vì tải lỗi, vùng thân hiện **nút "Thử lại"** (wrapper `components/buttons/Button`, chữ `common:retry`, căn giữa như fallback `Loader`); bấm nút → đưa chế độ lại vào `visited` → tải lại chunk. Chỉ tạo lại `lazy` của chế độ lỗi; chế độ kia giữ mount. Key mới `common:retry` đủ 7 ngôn ngữ (en "Retry", vi "Thử lại", ja "再試行", zh-CN "重试", zh-TW "重試", ru "Повторить", de "Erneut versuchen" — lấy y như `retry` đã có ở `pages/s3/bucketDetailDrawer.json`). Hiện trạng (đọc 2026-11-12): `MainLayout.tsx` đã có phần A (`lazyWorkspaces` mức module, `delete lazyWorkspaces[mode]` + `onLoadFail` bỏ khỏi `visited`) nhưng **chưa có** nút Thử lại; chế độ lỗi đang hiển thị thì vùng thân trống. |
| D32 | Chỉ ghi report, không sửa | (1) `frontend/src/style.css` dòng 12 `overflow: hidden` trên `body`. (2) Nhóm nút bên phải header `MainLayout.tsx` có `data-no-maximise` (double-click lên vùng trống của nhóm nút không maximize). |
| D33 | Git sprint-18 (2026-11-12, thay phần chia commit của D1/D26/D27/D28/D29) | **Giữ nguyên** commit tạm `a3d1486 chore(temp): all change file in sprint-18` (674 file: toàn bộ thay đổi sprint-18 tới thời điểm đó, gồm refactor R0, `biome.json`, docs), đã có trên `origin/SP-18/release` và `origin/SP-18/sql_mode_ui` (trùng nhau). **Không** chia lại thành C1/R0..R9, không rewrite lịch sử. Phần còn lại (F0 kiểm + sửa docs, F1 D31a, F2 D31c/D31e, F4 D31c, F6 D31d, F8 D31b, test của react-tester, các mục kiểm F3/F5/F7/F9) làm tiếp trên `SP-18/sql_mode_ui` (branch đã tồn tại, **không** tạo release/branch mới), rồi `git-flow` tạo **một hoặc vài commit mới** (Conventional Commits, tiếng Anh), push, PR `SP-18/sql_mode_ui` → `SP-18/release`. `.claude/**` và `CLAUDE.md` không commit; stage theo đường dẫn cụ thể. |

### Bảng ánh xạ D26 (cây thực tế đọc ngày 2026-11-11)

Đường dẫn tính từ `frontend/src/`. Dòng ghi "chưa xác minh" là chỗ planner không đọc được đường dẫn cũ (không chạy được `git`).

| Nhóm | Cũ | Mới |
|---|---|---|
| Store S3 | `common/stores/{downloaderStore,masterDataStore,profileStore,tabListStore,uploaderStore}.ts` | `pages/s3/stores/` (cùng tên). `common/stores/` còn `createStore`, `modalStackStore`, `settingStore`, `updateStore` (sửa import). |
| Hook S3 | `common/hooks/{useConnectProfile,useCredentialExpiring,useFilesDroppedUpload,useObjectPaging,useTabPersistence}.ts` | `pages/s3/hooks/` |
| Util S3 | `common/utils/{authUtils,bucketUtils,dropTargetUtils,tabPersistence,tabState,tabUtils,uploadUtils}.ts` | `pages/s3/utils/`. `common/utils/startup.ts` sửa import. |
| Navbar S3 | `components/layouts/navbar/LeftNavbar.tsx`, `.../components/{HeaderButtonGroup,ConnectionProfiles,ConnectionProfileItem}.tsx` (HeaderButtonGroup: chưa xác minh đường dẫn cũ) | `pages/s3/navbar/{S3Navbar,S3HeaderButtonGroup,ConnectionProfiles,ConnectionProfileItem}.tsx` |
| CSS card profile | `components/layouts/navbar/components/ConnectionProfileItem.module.css` | `components/display/ProfileCard.module.css` (dùng chung S3 + SQL) |
| Transfer | chưa xác minh đường dẫn cũ | `pages/s3/transfer/{TransferPanel,TransferRow,TransferSizes,VirtualItemList}.tsx`, `transferItem.ts`, `downloader/{DownloaderWindow,DownloaderItem}.tsx`, `uploader/{UploaderWindow,UploaderItem}.tsx` |
| Modal S3 | `components/modals/{bucket,connect,delete,history,profile,upload}/**` (chưa xác minh từng file) | `pages/s3/modals/{bucket,connect,delete,history,profile,upload}/**`; `components/modals/lazyModals.ts` sửa import. `components/modals/` còn `confirm/`, `setting/`, `lazyModals.ts`, `modalColors.ts`, `modalLayout.ts`. |
| Component S3 | `components/display/{DetailRow,PolicyBadge}.tsx`, `components/inputs/BucketPolicyInput.tsx`, `components/inputs/combobox/{AwsProfileCombobox,BucketPicker,RegionCombobox}.tsx`; `pages/tab/components/*` | `pages/s3/components/{DetailRow,PolicyBadge,BucketPolicyInput,AwsProfileCombobox,BucketPicker,RegionCombobox,TabActionBar,TabBreadcrumb,TabDetail,TabLabel,BucketDetailDrawer,ObjectDetailDrawer}.tsx` |
| Trang bucket/object | `pages/tab/bucket/**`, `pages/tab/object/**` | `pages/s3/bucket/**`, `pages/s3/object/**` |
| Tab page S3 | `pages/tab/TabPage.tsx` (+ `S3Workspace.tsx` của D24) | `pages/s3/S3TabPage.tsx` (bọc `TabStrip` + `Activity`), `pages/s3/S3Workspace.tsx` |
| Dải tab dùng chung | `pages/tab/{SortableTab,TabDragPreview,TabScroller}.tsx`, `tabConst.ts`, `SortableTab.module.css` | `components/tabs/{TabStrip,SortableTab,TabDragPreview,TabScroller}.tsx`, `tabConst.ts`, `SortableTab.module.css` (nội dung CSS đổi theo D30). `TabStrip` là logic tách từ `TabPage` cũ, nhận `useTabStore`, `renderLabel`, `renderDetail`. |
| Display dùng chung | (mới) | `components/display/StatusDot.tsx` (dùng ở `TabLabel` S3 và `SqlTabLabel`) |
| SQL | (plan cũ: `components/inputs/sqlEditor/`, `components/modals/dbProfile/`) | `pages/sql/components/sqlEditor/{SqlEditor.tsx,sqlEditorTheme.ts}`, `pages/sql/modals/dbProfile/{DbProfileModal.tsx,dbProfileSchema.ts}`; còn lại `pages/sql/{SqlWorkspace,SqlTabPage}.tsx`, `pages/sql/navbar/`, `pages/sql/components/`, `pages/sql/stores/`, `pages/sql/mock/`, `pages/sql/utils/` |
| Locale S3 | `locales/<lang>/components/**`, `locales/<lang>/pages/tab/**` (chưa xác minh từng file) | `locales/<lang>/pages/s3/**`. Tên namespace trong `resource.ts` **không đổi**. `locales/<lang>/components/` còn `layouts/appUpdate.json`, `modals/{confirmModal,settingModal}.json`. |
| Locale SQL | (plan cũ: `components/modals/dbProfileModal.json`) | `locales/<lang>/pages/sql/{sqlNavbar,sqlTab}.json`, `locales/<lang>/pages/sql/modals/dbProfileModal.json` |
| Key tab | tooltip tab trong `tabLayout` (plan cũ) | `common:tab.{close,drag,add,scrollLeft,scrollRight}` (dùng chung S3 + SQL; `sqlTab.tooltip` chỉ còn `connect`, `execute`) |
| Test | `src/test/common/**`, `src/test/components/**`, `src/test/pages/tab/**` của các file trên | `src/test/pages/s3/**`, `src/test/pages/sql/**`, `src/test/components/tabs/{SortableTab,TabDragPreview,TabScroller}.test.tsx`; `src/test/components/layouts/MainLayout{,S3Error,S3Loading,Sql,SqlError,SqlLoading}.test.tsx`; `src/test/App.test.tsx`. Ngày 2026-11-11 **chưa có** `src/test/components/tabs/TabStrip.test.tsx` và test riêng cho `components/display/StatusDot.tsx` (chưa xác minh lại sau `a3d1486`). `src/test/components/router/RouterItem.test.tsx` xoá theo D24. |
| Docs | `docs/ARCHITECTURE*.md` (7), `docs/scripts/{shots.mjs,annotations.json}` | Đã sửa trong `a3d1486`. Grep ngày 2026-11-12: 7 bản không còn `RouterItem`/`react-router`/`pages/tab/`, dòng 190 mỗi bản đã nhắc `S3Workspace`/`SqlWorkspace` lazy trong `MainLayout`, `components/tabs`. Phần còn lại của nội dung **chưa xác minh** đầy đủ (F0 kiểm). |

## 3a. Task native (rust-native)

Không có (ngoài phạm vi sprint).

## 3. Task backend (go-backend)

Không có. Message code mới: không. Migration / sqlc: không. Cần sinh lại bindings: không.

## 4. Task frontend (react-frontend)

> Đường dẫn bên dưới là đường dẫn **sau D26**, tính từ `frontend/src/` nếu không ghi rõ. Theo D33, toàn bộ code R0–R9 đã có trong `a3d1486`; cột "Trạng thái" ghi phần **còn phải làm** trên `SP-18/sql_mode_ui`.

| # | Task | Yêu cầu | File sửa / tạo | Phụ thuộc | Trạng thái (D33) |
|---|---|---|---|---|---|
| F0 | **Refactor thư mục (D26)**: code S3 vào `pages/s3/**`, dải tab dùng chung `components/tabs/**` (`TabStrip` nhận store qua prop, `S3TabPage` bọc `TabStrip` + `Activity`), CSS dải tab mới (D30), CSS card `components/display/ProfileCard.module.css`, locale S3 vào `locales/<lang>/pages/s3/**` (giữ tên namespace), tooltip tab vào `common:tab.*`. **Docs (D29)**: `docs/ARCHITECTURE*.md` 7 bản khớp code mới; `docs/scripts/{shots.mjs,annotations.json}`. | R0 | Theo bảng ánh xạ D26; `docs/ARCHITECTURE{,.vi,.ja,.zh-CN,.zh-TW,.ru,.de}.md` (sửa nếu chưa đúng) | - | Đã trong `a3d1486`. **Còn**: kiểm grep import cũ, `tsc`/`biome`/`oxlint`/`knip`; đọc 7 bản ARCHITECTURE, sửa nếu chưa khớp (viết `en` trước rồi dịch, đọc lại từng bản — memory 2026-11-09); kiểm `annotations.json` đủ 7 ngôn ngữ. |
| F1 | Header + chuyển chế độ: `SegmentedControl` (S3/SQL, wrapper `components/inputs/SegmentedControl`) trong `Group` `no-drag` + `data-no-maximise` (D19); `mode` + `visited` (D4, D24); lazy `S3Workspace`/`SqlWorkspace`, ẩn bằng `display: none` (D9), `Suspense`. `onDoubleClickHeader` dùng `closest('button, [data-no-maximise]')`. Downloader/Uploader ngoài vùng ẩn. **Bỏ react-router (D24)**. **D31a (Q27 = C)**: giữ phần A đã có (tạo lại `lazy` của chế độ lỗi, bỏ khỏi `visited`, chọn lại chế độ là tải lại); **thêm phần B**: khi `mode` hiện tại không nằm trong `visited` (do tải lỗi) thì render vùng `Center h="100%"` chứa `Button` (wrapper `@/components/buttons/Button`) chữ `tCommon('retry')`, `onClickRetry` (bọc `useCallback`) đưa `mode` lại vào `visited`. Không thêm ErrorBoundary, không tự retry. | R1 | `components/layouts/MainLayout.tsx` (sửa); `locales/{7}/common.json` (sửa: thêm `retry`) | F0 | **Còn**: phần B của D31a + key `common:retry` 7 ngôn ngữ + test. Các phần khác đã trong `a3d1486`, chỉ kiểm. |
| F2 | Store + mock + navbar profile DB: `dbProfileStore` (SCOPE `dbProfile`), mock 2 PostgreSQL + 1 SQLite, `SqlNavbar`, `SqlHeaderButtonGroup`, `DbProfiles`, `DbProfileItem`, `sqlToast.ts`. | R2 | `pages/sql/stores/dbProfileStore.ts` (sửa, **D31c**: `reset()` gọi `invalidateLoads(SCOPE)`); `pages/sql/navbar/DbProfileItem.tsx` (sửa, **D31e**: selector hẹp/`useShallow`, không select nguyên object) | F4 (`clearProfile`) | **Còn**: D31c, D31e + test. |
| F3 | Modal tạo/sửa profile DB (D7, D17, D21). | R3 | `pages/sql/modals/dbProfile/{DbProfileModal.tsx,dbProfileSchema.ts}`; `locales/{7}/pages/sql/modals/dbProfileModal.json`; `locales/{7}/messages/validateMessage.json` (`V000013`) | F2 | Đã trong `a3d1486`, **chỉ kiểm** (test C1, console sạch). |
| F4 | Store tab + dải tab SQL + chấm trạng thái: `sqlTabStore` (SCOPE `sqlTab`, 1 tab ban đầu, `clearProfile`), `SqlTabPage`, `SqlTabLabel` (D13), `StatusDot`, `TabLabel` S3 (D27). | R4 | `pages/sql/stores/sqlTabStore.ts` (sửa, **D31c**: `reset()` gọi `invalidateLoads(SCOPE)`) | F0, F1 | **Còn**: D31c + test; kiểm/viết test `TabStrip`, `StatusDot`, `SqlTabLabel` (D13), `TabLabel` (D27). |
| F5 | Header tab + khung tab: `SqlTabDetail`, `SqlTabActionBar`, `runSql` (D3, D18). | R5 | `pages/sql/components/{SqlTabDetail,SqlTabActionBar}.tsx`; `pages/sql/utils/sqlToast.ts` | F2, F4 | Đã trong `a3d1486`, **chỉ kiểm**. |
| F6 | Editor CodeMirror + autocomplete (D15, D16, D25). | R6 | `pages/sql/components/sqlEditor/SqlEditor.tsx` (sửa, **D31d**: không reconfigure lúc mount, chỉ khi dialect/schema đổi) | F5 | **Còn**: D31d + test. |
| F7 | Ctrl+Q format (`sqlFormat.ts`, D20). | R7 | `pages/sql/utils/sqlFormat.ts`; `pages/sql/components/SqlTabDetail.tsx` | F6 | Đã trong `a3d1486`, **chỉ kiểm**. |
| F8 | Ctrl+F Find/Replace (`findReplace.ts`, `FindReplacePanel`, D8). | R8 | `pages/sql/components/FindReplacePanel.tsx` (sửa, **D31b**: footer `Group p="8px" justify="space-between" wrap="nowrap"`) | F6 | **Còn**: D31b + hồi quy test. |
| F9 | Ctrl+E (D3, kiểm rỗng dùng chung với Execute). | R9 | `pages/sql/components/SqlTabDetail.tsx` | F5, F6 | Đã trong `a3d1486`, **chỉ kiểm**. |

Task C1 (commit `chore` riêng cho `biome.json`) **bỏ** theo D33 (`biome.json` đã nằm trong `a3d1486`).

`{7}` = `en`, `vi`, `ja`, `zh-CN`, `zh-TW`, `ru`, `de`.

i18n key mới trong phần còn lại (en/vi/ja/zh-CN/zh-TW/ru/de):
- `common:retry` (F1, D31a): en "Retry", vi "Thử lại", ja "再試行", zh-CN "重试", zh-TW "重試", ru "Повторить", de "Erneut versuchen".
- Các key khác của sprint (`common:appMode.*`, `sqlLoadError`, `s3LoadError`, `tab.*`; `sqlNavbar`, `dbProfileModal`, `sqlTab`, `V000013`) đã có trong `a3d1486`; chỉ kiểm qua `localeParity.test.ts`.

Test frontend (react-tester). File test đặt theo cây mới (`src/test/<đường dẫn file>`). Ngưỡng C1 ≥ 95% và Lines ≥ 95% áp cho **mọi file production đã đổi trong sprint** (gồm cả file trong `a3d1486`), không chỉ file sửa thêm:

| Task | File cần test | Case cần phủ |
|---|---|---|
| F0 | `components/tabs/TabStrip.tsx` → `src/test/components/tabs/TabStrip.test.tsx` (tạo nếu chưa có, hoặc chứng minh đủ C1 qua `S3TabPage*.test.tsx` + `SqlTabPage.test.tsx`, ghi rõ) | Nút `+` gọi `addTab`; nút đóng chỉ khi ≥2 tab, click đóng không đổi tab active (`stopPropagation`); `visited`: nội dung chỉ render khi tab active lần đầu, giữ khi đổi tab, tab đã đóng bị bỏ khỏi `visited`; `renderDetail` nhận `active` đúng; collision detection (ratio đạt/không đạt 0.9, rect thiếu, giữ id trước); drag start/end (có/không `over`)/cancel; `onMoveTab` ở hai đầu không gọi `moveTab`; scrollIntoView khi đổi tab/thêm/đóng, không gọi khi đang kéo; `screenReaderInstructions` lấy `common:tab.drag`. |
| F0 | `components/tabs/{SortableTab,TabDragPreview,TabScroller}.tsx` | Hồi quy assert cũ (chỉ đổi import/key i18n); Ctrl+Shift+←/→ gọi `onMoveTab` và giữ focus; phím khác / không sortable bỏ qua; nút đóng gọi `onClickClose`; tooltip theo `common:tab.*`. CSS (D30) không có logic — chỉ kiểm class active/không active vẫn gắn đúng. |
| F0 | `pages/s3/S3TabPage.tsx` (`S3TabPage.test.tsx`, `S3TabPageA11y.test.tsx`, `S3TabPageNoScroller.test.tsx`) | Hồi quy mọi assert của test `TabPage` cũ; tab ẩn bọc `Activity` mode `hidden`, tab active `visible`. |
| F0 | Mọi file S3 đã di chuyển (`src/test/pages/s3/**`, `App.test.tsx`, `common/**`) | Không đổi assert, chỉ đổi đường dẫn import/`vi.mock`. File production chỉ đổi import vẫn phải đạt C1 ≥ 95%: file cũ đã đạt thì chỉ chạy lại; file chưa đạt thì ghi danh sách và hỏi trước khi viết bù. |
| F0 | `docs/scripts/shots.mjs`, `annotations.json`, `ARCHITECTURE*.md` | Không có unit test. Kiểm: `annotations.json` đủ 7 ngôn ngữ và đủ khoá cho ảnh `shots.mjs` dùng; 7 bản ARCHITECTURE cùng cấu trúc mục, không còn nhắc `RouterItem`/react-router/`pages/tab`/`common/stores` cho state S3 (grep). Không bắt buộc chạy lại `shots.mjs` (D30). |
| F1 | `components/layouts/MainLayout.tsx` (`MainLayout.test.tsx`, `MainLayoutS3Error.test.tsx`, `MainLayoutS3Loading.test.tsx`, `MainLayoutSql.test.tsx`, `MainLayoutSqlError.test.tsx`, `MainLayoutSqlLoading.test.tsx`; thêm case vào các file `*Error` hoặc file mới `MainLayoutRetry.test.tsx` nếu cần) | Hồi quy: nút Settings/History, double-click vùng trống maximize, double-click nút không maximize, double-click nhóm nút phải không maximize (D32); mặc định S3 hiện, SQL chưa mount; chọn SQL → S3 `display:none` vẫn trong DOM; chọn lại S3 → SQL vẫn mount, S3 không mount lại; double-click lên SegmentedControl không gọi `ToggleMaximise`; đang tải hiện `Loader`; Downloader/Uploader render ở cả hai chế độ. **D31a phần A**: lỗi tải chunk S3/SQL → `toast.error` key `common:s3LoadError`/`common:sqlLoadError` + description, header vẫn dùng được; chọn chế độ khác rồi chọn lại chế độ lỗi → `import` được gọi lần 2. **D31a phần B**: sau lỗi, vùng thân hiện nút `common:retry` (truy vấn theo role `button` + tên); bấm → `import` gọi lần 2, lần 2 thành công thì workspace hiện và nút biến mất; lần 2 vẫn lỗi → toast lại và nút hiện lại; chế độ không lỗi (đã mount) không bị remount khi retry chế độ kia; nút không hiện khi chế độ đang tải bình thường. Lưu ý cache `lazyWorkspaces` ở mức module: mỗi test cần `vi.resetModules()`/import lại `MainLayout` để không dính cache của test trước. |
| F1 | `locales/{7}/common.json` | `localeParity.test.ts` pass (key `retry` có ở cả 7 bản). |
| F1 | `App.tsx` (`src/test/App.test.tsx`) | Không còn router/`RouterItem`; `MainLayout` render; giữ assert cũ: `loadAll` khi mount + `reset` khi unmount, `normalizeTabProfilesFromDisk` + `resetProfiles`, `useTabPersistence`/`useCredentialExpiring` (mock theo `@/pages/s3/...`), `Toaster`, `AppUpdateToast`. |
| F1 | `components/router/RouterItem.tsx` (đã xoá) | `RouterItem.test.tsx` xoá chủ ý theo D24 (ghi trong báo cáo). |
| F1 | `frontend/package.json` | Grep không còn `react-router` trong `frontend/src/**`, `package.json`; `tsc --noEmit`, `knip` sạch. |
| F1 | `pages/s3/S3Workspace.tsx`, `pages/sql/SqlWorkspace.tsx` | Render navbar + tab page (mock con). |
| F2 | `pages/sql/stores/dbProfileStore.ts` | Khởi tạo bằng mock; `saveDbProfile` thêm/ghi đè; `deleteDbProfile` id có / không có; `setConnected` true/false, id không tồn tại không đổi; `getDbProfileById` null/undefined/có; `reset` về mock **và gọi `invalidateLoads('dbProfile')`** (D31c, mock `@/common/utils/ipcUtils`). |
| F2 | `pages/sql/mock/dbProfileMock.ts` | Có ≥1 PostgreSQL và ≥1 SQLite, id duy nhất (file chỉ khai báo hằng: loại khỏi ngưỡng nếu chỉ là dữ liệu — ghi rõ). |
| F2 | `pages/sql/navbar/SqlHeaderButtonGroup.tsx` | 4 nút có tooltip đúng; Tạo mở modal; Connect/Import/Refresh gọi toast "chưa có backend". |
| F2 | `pages/sql/navbar/DbProfiles.tsx` | Danh sách rỗng hiện text empty; virtualizer; chuột phải trên dòng mở menu, ngoài dòng `preventDefault`; menu chưa kết nối / đã kết nối (Edit ẩn); Connect/Disconnect đổi store + toast; Edit mở modal; Export toast; Delete hỏi 1 lần / 2 lần, huỷ từng bước không xoá, xác nhận thì xoá + `clearProfile`; double-click connect, đã kết nối thì không làm gì; cuộn đóng menu. |
| F2 | `pages/sql/navbar/DbProfileItem.tsx` | Profile không tồn tại render null; có màu/không màu; light/dark; badge PostgreSQL/SQLite; icon kết nối/không. **D31e**: đổi field của profile khác không làm item re-render thừa (đếm render qua mock con nếu khả thi, nếu không ghi rõ); đổi tên/màu/trạng thái của chính profile thì cập nhật. |
| F2 | `pages/sql/navbar/SqlNavbar.tsx` | Render header + list. |
| F2 | `pages/sql/utils/sqlToast.ts` | `truncateSql` dưới/bằng/trên 500 ký tự; `notifyNoBackend` gọi `toast.info` đúng key. |
| F3 | `pages/sql/modals/dbProfile/dbProfileSchema.ts` | Thiếu từng trường bắt buộc; port 0, 1, 65535, 65536, rỗng, không phải số; tên trùng (khác hoa/thường, có khoảng trắng), edit trùng chính nó hợp lệ; đổi loại DB chỉ validate trường của loại đó. |
| F3 | `pages/sql/modals/dbProfile/DbProfileModal.tsx` | Create: mặc định (port 5432, sslMode prefer), lưu + toast + đóng; Edit: điền dữ liệu cũ, hỏi C000001, huỷ không lưu, xác nhận cập nhật + đóng; đổi PostgreSQL↔SQLite đổi trường và xoá lỗi; nút chọn file gọi toast; lỗi theo field; Cancel/X đóng không lưu; password không có trong toast. |
| F4 | `pages/sql/stores/sqlTabStore.ts` | 1 tab ban đầu; `addTab` set active; `closeTab` khi 1 tab, tab không tồn tại, đóng tab active chọn tab phải/trái, đóng tab không active; `moveTab` from/to âm hoặc bằng nhau; `setTabProfile` tab có/không; `clearProfile` chỉ đổi tab khớp; `setActiveTab(null)` bỏ qua; `reset` **gọi `invalidateLoads('sqlTab')`** (D31c). |
| F4 | `pages/sql/SqlTabPage.tsx` | Truyền đúng store/label/detail cho `TabStrip`; tab SQL ẩn không bọc `Activity` (D10). |
| F4 | `pages/sql/components/SqlTabLabel.tsx` (`SqlTabLabel.test.tsx` sửa theo D13/Q25, ghi trong báo cáo) | Chưa chọn → "New query", không chấm; đã chọn chưa kết nối → tên + `StatusDot` đỏ; đã kết nối → tên + xanh; profile bị xoá → "New query", không chấm; đổi tên ở modal → nhãn đổi; Connect/Disconnect → màu chấm đổi. |
| F4 | `components/display/StatusDot.tsx` → `src/test/components/display/StatusDot.test.tsx` (tạo nếu chưa có, hoặc phủ qua `TabLabel`/`SqlTabLabel`, ghi rõ) | `connected` true → `--mantine-color-green-6`, false → `--mantine-color-red-6`. |
| F4 | `pages/s3/components/TabLabel.tsx` (D27, `TabLabel.test.tsx` cập nhật có chủ ý) | Hồi quy: chưa kết nối → "New profile", đã kết nối → tên. Mới: tab không có profile → không chấm; có profile chưa kết nối → chấm đỏ + "New profile"; đã kết nối → chấm xanh + tên. |
| F5 | `pages/sql/components/SqlTabActionBar.tsx` | Combobox hiện option, đổi gọi callback; Connect disable khi chưa chọn / đã kết nối; Execute disable khi chưa chọn, enable khi đã chọn dù chưa kết nối (D3); click gọi callback. |
| F5 | `pages/sql/components/SqlTabDetail.tsx` (`SqlTabDetail.test.tsx`, `SqlTabDetailGuards.test.tsx`) | Đổi profile chỉ đổi tab này; Connect giả đổi store + toast; Execute toast tên profile + toàn bộ SQL, SQL dài bị cắt; SQL rỗng cảnh báo. |
| F6 | `pages/sql/components/sqlEditor/SqlEditor.tsx` | Tạo `EditorView` khi mount, `destroy` khi unmount; **D31d**: mount không `dispatch` reconfigure (spy `view.dispatch`/`Compartment.reconfigure` không được gọi lần đầu); đổi dialect/schema → reconfigure đúng một lần, không tạo view mới; rerender cùng dialect/schema → không reconfigure; Ctrl+Q/F/E gọi đúng callback và `preventDefault`; phím khác không chặn; `ref` trả view; console sạch. Stub `Range.getClientRects`/`getBoundingClientRect` (helper `src/test/_helpers/codemirror.ts`). Autocomplete (D25): `SEL` → có `SELECT`; có schema → tên bảng, sau `bang.` → cột; không schema → không tên bảng; Ctrl+Space mở; Enter/Tab nhận, Esc đóng; Enter khi không có gợi ý vẫn xuống dòng. |
| F6 | `pages/sql/mock/dbSchemaMock.ts` + `SqlTabDetail` | Mỗi profile mock có schema (hoặc ghi rõ); `SqlTabDetail` truyền đúng schema theo profile, đổi profile đổi schema, chưa chọn → `undefined`. |
| F6 | `pages/sql/components/sqlEditor/sqlEditorTheme.ts` | Không có màu hex/rgb; HighlightStyle có tag chính; font `.cm-scroller`/`.cm-content`/`.cm-gutters` là `var(--mantine-font-family)` + `var(--mantine-font-size-sm)` (D15). |
| F7 | `pages/sql/utils/sqlFormat.ts` + command trong `SqlTabDetail` | Dialect theo postgresql/sqlite/null; format toàn bộ; phần chọn giữ phần còn lại; SQL lỗi → toast, doc không đổi; một `undo` về nội dung trước; import động một lần; doc rỗng. |
| F8 | `pages/sql/utils/findReplace.ts` | Không phân biệt hoa/thường; Unicode (`İ`, `ß`) không lệch; tìm sau con trỏ, quay vòng; chuỗi rỗng; không có kết quả; `replaceCurrent` khớp / không khớp; `replaceAll` trả số chỗ, 0 chỗ không tạo transaction; mỗi lệnh một bước undo. |
| F8 | `pages/sql/components/FindReplacePanel.tsx` | Ctrl+F có phần chọn một dòng → điền sẵn, nhiều dòng → không; `i/n` / "không tìm thấy"; Replace lần đầu hiện ô thay thế, lần sau thay và chọn kết quả kế; Replace all toast số chỗ; Esc/Cancel đóng + focus editor; không chặn gõ vào editor; giữ state khi đổi tab. D31b chỉ đổi padding (không có nhánh mới), hồi quy toàn bộ case trên. |
| F9 | `pages/sql/components/SqlTabDetail.tsx` (Ctrl+E) | Chưa chọn profile → cảnh báo; đã chọn chưa kết nối → vẫn toast (D3); có phần chọn → toast phần chọn; không chọn → toàn bộ; rỗng / chỉ khoảng trắng → cảnh báo. |
| Tất cả | `vitest run` toàn bộ ở đỉnh branch | Không test S3 nào fail (nhất là `MainLayout*`, `S3TabPage*`, `TabLabel`, `ConnectionProfiles`, `ConnectionProfileItem`, `App`, `components/tabs/*`); `localeParity.test.ts` pass; console sạch. Ngoại lệ chủ ý: D24, D26, D27, D13/Q25 — ghi rõ trong báo cáo. |

## 5. Branch

| Branch | Yêu cầu | Task | Ghi chú |
|---|---|---|---|
| SP-18/sql_mode_ui | R0–R9 | F0–F9 | D1/D2: một branch, không tách sprint. **D33**: branch đã tồn tại, đỉnh `a3d1486` trùng `origin/SP-18/release`; không tạo release/branch mới, không chia lại `a3d1486`. Phần còn lại commit mới (một hoặc vài commit Conventional Commits tiếng Anh, ví dụ `fix(layout): add retry button when workspace chunk fails to load`, `refactor(sql): narrow store selectors and invalidate loads on reset`, `test(...)`), push, PR vào `SP-18/release`. `.claude/**`, `CLAUDE.md`, `frontend/bun.lock` không commit; stage theo đường dẫn cụ thể. |

## 6. Thứ tự thực hiện (luôn tuần tự)

1. Branch `SP-18/sql_mode_ui` đã là branch hiện tại, đỉnh `a3d1486` (D33). Không gọi `git-flow` tạo release/branch.
2. Native: không có.
3. Backend: không có.
4. Không cần sinh bindings (không đổi Go). Vẫn chạy `go tool wails3 generate bindings -clean=true -ts` một lần vì `frontend/bindings` bị gitignore (memory) để `tsc` chạy được.
5. Frontend (react-frontend), tuần tự: F0 kiểm (grep không còn import tới `@/common/stores/{profile,tabList,...}`, `@/components/layouts/navbar`, `@/pages/tab`, `@/components/router`; `tsc`, `biome`, `oxlint`, `knip` sạch) + kiểm/sửa docs ARCHITECTURE 7 bản (D29) → F1 (D31a phần B + `common:retry` 7 ngôn ngữ) → F2 (D31c, D31e) → F4 (D31c) → F6 (D31d) → F8 (D31b). F3, F5, F7, F9 chỉ kiểm.
6. FE test (react-tester): test mới `TabStrip`/`StatusDot` nếu chưa có; `SqlTabLabel.test.tsx` theo D13, `TabLabel.test.tsx` theo D27; case D31 (gồm nút Thử lại của D31a); đo C1 cho mọi file production đã đổi trong sprint (diff `origin/staging...HEAD` + working tree) → verify (chạy toàn bộ `vitest run` tuần tự) → review → `git-flow`: commit mới trên `SP-18/sql_mode_ui` (stage theo đường dẫn cụ thể), push, PR vào `SP-18/release`.
7. Phạm vi review: diff mới so với `origin/SP-18/release` là trọng tâm; vì `a3d1486` không đi qua review theo R (đã vào release), code-reviewer xem thêm diff toàn sprint `origin/staging...HEAD` ở mức tổng thể (ưu tiên `MainLayout`, `TabStrip`, store SQL, `SqlEditor`).
8. Mô tả PR ghi: `a3d1486` là commit tạm đã có trên release (D33); đổi giao diện dải tab S3 (D30); đổi hành vi nhãn tab S3 (D27); xoá `RouterItem.test.tsx` (D24); thêm nút Thử lại khi tải chunk lỗi (D31a).
9. Report ghi: ảnh docs có dải tab có thể lệch giao diện (D30); `body overflow: hidden` ở `style.css` và `data-no-maximise` trên nhóm nút phải header (D32); các cặp S3↔SQL (K3); D33.

## 7. Rủi ro

| # | Rủi ro | Mức độ | Cách giảm thiểu |
|---|---|---|---|
| K1 | Ẩn cây S3 sai cách (`Activity`) làm huỷ IPC đang chạy, mất subscription event, auto-connect chạy lại. | high | D9: `display: none` cho cả hai cây; test hồi quy MainLayout + test tay chuyển chế độ khi đang connect/listing. |
| K2 | Sprint lớn (~30 file mới SQL + refactor ~100 file di chuyển, 7×4 locale, docs 7 bản, 10 task); `a3d1486` gom 674 file trong một commit nên lịch sử không tách được theo yêu cầu, `git bisect`/revert từng R không làm được. | high | Người dùng chấp nhận (D33). Review tổng thể diff `origin/staging...HEAD` (`git diff -M` để thấy rename); verifier chạy ở đỉnh; test hồi quy đầy đủ. |
| K19 | R0 (D26) không phải di chuyển thuần: tách `TabPage` → `TabStrip`, đổi namespace tooltip, gộp CSS card, đổi CSS dải tab (D30), sửa docs 7 bản — lẫn trong `a3d1486` với R1–R9. | high | Review so `TabStrip` với `TabPage` cũ (`git show origin/staging:frontend/src/pages/tab/TabPage.tsx`); test hồi quy assert cũ không đổi; test tay S3: thêm/đóng/kéo/Ctrl+Shift+←→/cuộn tab, khôi phục tab từ `settings.json`, giao diện dải tab mới ở light/dark, chấm trạng thái đổi màu khi Connect/Disconnect. |
| K26 | `a3d1486` đã nằm trên `origin/SP-18/release` nên PR `sql_mode_ui` → release chỉ hiện các commit mới; nội dung chính của sprint không có PR riêng để review. Chưa xác minh `a3d1486` có chứa `.claude/**`/`CLAUDE.md` hay không (working tree sạch lúc bắt đầu). | medium | Code-reviewer xem diff toàn sprint (mục 6 bước 7). `git-flow`/verifier kiểm `git show --stat a3d1486 -- .claude CLAUDE.md`; nếu có thì báo người dùng trước khi PR `SP-18/release` → `staging` (không tự sửa lịch sử). |
| K23 | `ARCHITECTURE*.md` 7 bản có thể lệch giữa các bản (sót câu, câu lặp — memory 2026-11-09); nội dung đầy đủ chưa xác minh. | medium | Đọc lại từng bản; grep 7 bản không còn `RouterItem`, `react-router`, `pages/tab`, `common/stores/profileStore`; sửa thì viết `en` trước rồi dịch. |
| K24 | D31a: retry dễ làm remount/mất state của chế độ đang chạy tốt; cache `lazyWorkspaces` ở mức module dính giữa các test và giữa các instance `MainLayout`; `onFail` được bắt trong closure lần tạo `lazy` đầu tiên. | medium | Chỉ xoá cache của chế độ lỗi; nút Thử lại chỉ đưa `mode` lỗi lại vào `visited`; test lần 2 thành công / lần 2 lỗi / chế độ kia không remount; test dùng `vi.resetModules()`. |
| K25 | Ảnh docs có dải tab lệch giao diện mới (D30); `shots.mjs` có thể không còn khớp DOM sau D26. | low | Ghi vào report; không chụp lại trong sprint; kiểm selector `shots.mjs` theo DOM mới khi review (chạy thử chưa bắt buộc). |
| K22 | Working tree có thể có thay đổi không thuộc sprint (`.claude/**`, `CLAUDE.md`) dễ bị stage nhầm khi commit mới. | medium | Stage/commit theo đường dẫn cụ thể, kiểm `git diff --cached` trước mỗi commit; không `git add -A`/`git add .`. Nếu `git-flow` từ chối vì working tree bẩn thì cần người dùng cho ngoại lệ rõ ràng. |
| K21 | Di chuyển file locale/test có thể sót 1 trong 7 ngôn ngữ, hoặc test cũ bị xoá thay vì chuyển. | medium | `localeParity.test.ts` + `i18n.test.ts`; react-tester so số file test với `origin/staging` và báo file test bị mất (trừ `RouterItem.test.tsx`). |
| K3 | Code SQL chép từ S3 trôi khác S3 sau này; D31e làm `DbProfileItem` khác cách select của `ConnectionProfileItem`. | low | Ghi trong report/memory các cặp S3↔SQL (`S3Navbar`↔`SqlNavbar`, `ConnectionProfiles`↔`DbProfiles`, `ConnectionProfileItem`↔`DbProfileItem`, `TabActionBar`↔`SqlTabActionBar`, `TabLabel`↔`SqlTabLabel`); S3 không sửa trong sprint này theo D31. |
| K4 | CodeMirror trong jsdom: thiếu `getClientRects`, đo layout → khó đạt C1 ≥ 95% cho `SqlEditor.tsx`. | medium | Stub API Range; tách logic thuần ra `.ts`; ghi rõ nhánh không test được. |
| K5 | Chưa xác minh WebView2 tôn trọng `preventDefault` cho Ctrl+F; docs Wails 403. | medium | `preventDefault` ở keymap CodeMirror; test case `manual` trên app thật. |
| K6 | `lazy()` chunk lỗi tải làm sập cây (app không có ErrorBoundary). | medium | Toast + component rỗng, bọc `Suspense`, thử lại theo D31a (chọn lại chế độ hoặc nút Thử lại); có test lỗi cho cả S3 và SQL. |
| K7 | `sql-formatter` chạy main thread, chunk lớn. | medium | D20: 3 dialect, import động; đo tay 5.000 dòng. |
| K15 | D24: header + navbar render trước khi chunk `S3Workspace` tải xong (`Loader` thoáng qua). | medium | Test hồi quy `MainLayout*`, `App`; test tay mở app ở S3; `vite build` kiểm chunk. |
| K16 | Gỡ `react-router-dom` đổi test cũ; dễ hiểu nhầm là "sửa test để cho qua". | low | D24 chủ ý; ghi rõ trong báo cáo. |
| K17 | `bun.lock` không track nên bản cài trên máy khác/CI resolve lại theo `package.json` (chưa xác minh CI dùng `bun install` không lock). | low | Chỉ chạy lệnh bun, không sửa tay `package.json`. |
| K8 | Font editor theo Settings (D15) làm lệch căn cột / đo con trỏ với font CJK. | low | Test tay đổi font khi editor mở; nếu lệch thì `view.requestMeasure()` (chưa xác minh). |
| K9 | `Splitter`, `TabScroller`, virtualizer, CodeMirror khi `display: none` đo kích thước 0. | low | Test tay chuyển chế độ khi dải tab tràn / danh sách dài / editor nhiều dòng. |
| K10 | `light-dark()` trong theme CodeMirror cần `color-scheme`; chưa xác minh. | low | Test tay đổi theme khi editor mở. |
| K11 | Password mock trong store, lộ qua `window.__stores` ở dev. | low | Chỉ dev; không log/toast password; comment trong mock. |
| K12 | Thêm package có thể conflict PR bump deps khác. | low | Chỉ cài đúng danh sách D16 + D25. |
| K13 | Sửa `onDoubleClickHeader` có thể đổi hành vi double-click. | low | Test hồi quy các case double-click cũ + nhóm nút phải (D32). |
| K18 | Autocomplete: Ctrl+Space bị IME bắt; Esc tranh với `FindReplacePanel`. | low | Gợi ý tự hiện khi gõ; test manual với bộ gõ CJK; popup đã gắn `document.body`. |
| K14 | Hai `DndContext` + hai `DragOverlay` portal vào `document.body`. | low | Test tay kéo tab ở cả hai chế độ. |

## 8. Tiêu chí hoàn thành

- [x] Mọi câu hỏi Q1–Q26 có trả lời và plan đã cập nhật theo (mục 2).
- [x] Q27 có trả lời (C = A + B), plan cập nhật theo (D31a).
- [ ] Unit test frontend đạt C1 ≥ 95% và Lines ≥ 95% cho từng file production đã đổi/mới trong sprint (gồm cả file trong `a3d1486`; trừ file chỉ khai báo hằng/type và nhánh ghi rõ không test được), gồm `App.tsx`, `MainLayout.tsx`, `components/tabs/TabStrip.tsx`, `components/display/StatusDot.tsx`, `pages/s3/components/TabLabel.tsx`, `pages/sql/components/SqlTabLabel.tsx`, các file sửa theo D31.
- [ ] `vitest run` toàn bộ pass ở đỉnh branch, console sạch; test S3 cũ không bị sửa assert (ngoại lệ D24, D26, D27). `SqlTabLabel.test.tsx` sửa theo D13 (Q25). Không mất file test nào so với `origin/staging` ngoài `RouterItem.test.tsx`.
- [ ] `biome check`, `oxlint`, `tsc --noEmit`, `knip` sạch cho các file đổi (ở đỉnh branch).
- [ ] Không còn `react-router` trong `frontend/src/**`, `frontend/package.json`; không còn import tới `@/pages/tab`, `@/components/router`, `@/components/layouts/navbar`, store/hook/util S3 ở `@/common/**`.
- [ ] Mở app hiện S3 như trước; lỗi tải chunk chỉ toast, không trắng app; **thử lại được** bằng cả hai cách: chọn lại chế độ và nút "Thử lại" (`common:retry`, 7 ngôn ngữ) (D31a).
- [ ] Chuyển S3↔SQL giữ state hai bên; Downloader/Uploader chạy ở cả hai chế độ.
- [ ] Chế độ SQL (CodeMirror, sql-formatter) không nằm trong chunk khởi động (kiểm `vite build`).
- [ ] Ctrl+Q/F/E hoạt động khi editor focus trên app thật, WebView2 không mở thanh find (test case manual).
- [ ] Gõ SQL có hint (D25) theo dialect + schema mock; popup theo theme Mantine light/dark.
- [ ] Tab SQL mới hiện "New query" (7 ngôn ngữ); nhãn tab SQL và S3 có chấm `StatusDot` theo trạng thái kết nối (D13, D27); dải tab theo CSS mới (D30) ở cả hai chế độ; editor đổi font theo Settings; toast SQL dùng monospace.
- [ ] D31: `reset()` của `dbProfileStore`/`sqlTabStore` gọi `invalidateLoads(SCOPE)`; `SqlEditor` không reconfigure lúc mount; `DbProfileItem` không select nguyên object; footer `FindReplacePanel` có `p="8px"`.
- [ ] Mọi chuỗi UI mới đủ 7 ngôn ngữ, cùng tập key và placeholder với `en`, đăng ký trong `resource.ts` của 7 ngôn ngữ; file locale S3 nằm ở `locales/<lang>/pages/s3/**` đủ 7 ngôn ngữ.
- [ ] File S3 chỉ được di chuyển / đổi đường dẫn import (D26), trừ: `MainLayout.tsx`, `App.tsx`, `RouterItem.tsx` (xoá), `package.json`, `TabPage` → `TabStrip` + `S3TabPage.tsx`, `S3Workspace.tsx`, key `common:tab.*`, `ProfileCard.module.css`, `SortableTab.module.css` (D30), `TabLabel.tsx` (D27), file locale/`validateMessage.json` dùng chung.
- [ ] Mock profile và toast "chưa có backend" nằm ở `pages/sql/mock/` và `pages/sql/utils/sqlToast.ts`, có comment cho sprint backend.
- [ ] Git theo D33: giữ nguyên `a3d1486`; phần còn lại là commit mới (Conventional Commits, tiếng Anh) trên `SP-18/sql_mode_ui`, push, PR vào `SP-18/release`; `.claude/**`, `CLAUDE.md`, `bun.lock` không có trong commit mới.
- [ ] `docs/ARCHITECTURE*.md` 7 bản khớp code mới (không còn `RouterItem`/react-router; có `S3Workspace`/`SqlWorkspace` lazy, cây `pages/<mode>/...`, `components/tabs/`), cùng cấu trúc giữa 7 bản.
- [ ] Report ghi: ảnh docs dải tab có thể lệch (D30), `body overflow: hidden` và `data-no-maximise` nhóm nút phải (D32), các cặp S3↔SQL (K3), D33.
