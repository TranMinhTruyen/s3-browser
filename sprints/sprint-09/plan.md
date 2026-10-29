# Plan sprint-09

Nguồn: `requirement.md` và `sprints/sprint-08/plan.md` mục 8, đã đối chiếu lại với code hiện tại. Đã cập nhật theo câu trả lời của người dùng (Q1-Q9). Người dùng đã duyệt triển khai.

## 0. Hiện trạng đã kiểm chứng trong code
- `frontend/src/components/layouts/tab/TabLayout.tsx`: `Tabs` Mantine + `Scroller`; thứ tự tab = `Object.keys(tabList)`; có `useEffect` `scrollIntoView` tab `[data-active]` khi `tabIds`/`activeTab` đổi; nút đóng là `CloseButton component="span"` với `stopPropagation`. Chưa có `moveTab`.
- `frontend/src/common/stores/tabListStore.ts`: `tabList: Record<uuid, TabDetail>`, `TabDetail.profileId?: string | null`, `closeTab` chọn tab kế dựa vào thứ tự key. Chưa có `moveTab`/`restoreTabs`/`serializeTabs`. Key là UUID (không phải số nguyên) nên thứ tự chèn của object được giữ.
- `TabLabel` chỉ hiện tên profile khi `profile.isConnected`; chưa connect thì hiện "New profile". Profile của tab chọn trong `TabDetail.onChangeSelectProfile`.
- `profileStore.loadConnectionProfiles()` gọi khi mount `ConnectionProfiles.tsx`; `clearProfile(id)` gọi khi xoá profile.
- `main.tsx` `await useSettingStore.getState().load()` trước khi render, bao `MantineProvider` > `NiceModal.Provider` > `App`; `main.tsx` bị loại khỏi coverage. `App.tsx` chỉ có `useLayoutEffect` load master data.
- Backend `internal/modules/setting`: `module.go` (STE001-STE004), `submodule_setting_mng.go` (mutex), `submodule_file_mng.go` (`settings.json` ghi atomic: CreateTemp + Rename, đường dẫn từ `portable.DataDir`). `SettingHandler` đã đăng ký trong `main.go`. Model ở `models/setting/`, re-export trong `models/alias.go`.
- `frontend/package.json` chưa có `@dnd-kit/*` và `motion`. Chưa có bindings cho tab state.
- Chưa có lớp animation dùng chung nào trong `frontend/src` (chưa xác minh toàn bộ; chỉ thấy không có `motion` trong dependencies).

## 1. Tóm tắt yêu cầu
- R1: Kéo thả tab trong TabLayout để đổi vị trí (không giới hạn), animation mượt bằng `@dnd-kit` + `motion` (nâng tab khi kéo, enter/exit khi thêm/đóng tab), chú ý hiệu năng; đặt nền tảng animation dùng lại cho sprint animation toàn app sau này.
- R2: Ghi nhớ số lượng, vị trí, profile của tab khi đóng app; mở lại thì load lại các tab, không tự connect.

## 2. Câu hỏi chưa rõ
| # | Câu hỏi | Đề xuất | Trả lời |
|---|---|---|---|
| Q1 | R1: Dùng lib nào và kéo theo cách nào? | `@dnd-kit` (core, sortable, utilities, modifiers), `restrictToHorizontalAxis` + `restrictToParentElement`, `KeyboardSensor`; animation dùng thêm `motion` | Đã trả lời: đúng đề xuất. THAY ĐỔI: người dùng đồng ý cài thêm `motion` (import từ `motion/react`) cho animation kéo thả tab; sẽ có sprint sau thêm animation toàn app nên đặt nền tảng dùng lại (transition dùng chung, `MotionConfig` tôn trọng `prefers-reduced-motion`). |
| Q2 | R2: Lưu khi nào? | Lưu liên tục, debounce ~500ms | Đã trả lời: lưu liên tục, debounce 500ms. |
| Q3 | R2: Nhớ những gì? | Thứ tự, tab active, `profileId` | Đã trả lời: chỉ nhớ thứ tự, tab active, `profileId`. |
| Q4 | R2: Profile đã xoá? | Giữ tab, `profileId = null`, chỉ chuẩn hoá sau khi `loadConnectionProfiles` thành công | Đã trả lời: đúng đề xuất. |
| Q5 | R2: Lưu ở đâu? | `<DataDir>/tabs.json`, ghi atomic chung với settings, trong module `setting` | Đã trả lời: đúng đề xuất. |
| Q6 | R2: Đổi `TabLabel` hiện tên profile khi chưa connect? | Không đổi | Đã trả lời: không đổi label trong sprint này. |
| Q7 | Nơi khôi phục tab? | `main.tsx` trước render, logic ở `tabPersistence.ts` | Đã trả lời: đúng đề xuất. |
| Q8 | Gộp R1/R2 một branch? | Tách 2 branch | Đã trả lời: tách `SP-09/tab_drag_drop` (R1, trước) và `SP-09/tab_persistence` (R2). |
| Q9 | Có áp animation enter/exit cho thêm/đóng tab (`AnimatePresence`) hay chỉ animation lúc kéo thả? | Làm cả hai, `initial={false}` | Đã trả lời: làm cả hai (enter/exit khi thêm/đóng tab bằng `AnimatePresence initial={false}` + hiệu ứng nâng tab khi kéo). |

## 3. Task backend (go-backend)
Tất cả thuộc R2 (R1 không cần backend).

| # | Task | Yêu cầu | File sửa / tạo | Phụ thuộc |
|---|---|---|---|---|
| B1 | Model `TabState` (`Tabs []TabItem{ID, ProfileID}`, `ActiveTab`) + `SaveTabStateInput`, json camelCase; re-export trong alias | R2 | `models/setting/tab_state.go` (tạo), `models/alias.go` (sửa) | - |
| B2 | Tách hàm ghi atomic dùng chung từ `submoduleFileMng.write`, thêm đọc/ghi `tabs.json` (file thiếu hoặc hỏng thì trả state rỗng) | R2 | `internal/modules/setting/submodule_file_mng.go` (sửa), `internal/modules/setting/submodule_tab_mng.go` (tạo: mutex + `get`/`save`, validate: số tab tối đa hợp lý, id không rỗng/không trùng, `activeTab` thuộc danh sách; chuẩn hoá khi đọc) | B1 |
| B3 | API public `GetTabState`/`SaveTabState` có doc comment; message `STE005` (lỗi tải tab state), `STE006` (lỗi lưu), `STE007` (dữ liệu tab không hợp lệ) khai báo `var` ở đầu `module.go` | R2 | `internal/modules/setting/module.go` (sửa) | B2 |
| B4 | Handler mỏng `GetTabState`/`SaveTabState` | R2 | `internal/handlers/setting_handler.go` (sửa) | B3 |
| B5 | Key i18n cho STE005-STE007 (en/vi/ja) | R2 | `frontend/src/locales/{en,vi,ja}/messages/ipcMessage.json` (sửa) | B3 |

Message code mới: STE005, STE006, STE007  |  Migration / sqlc: không  |  Cần sinh lại bindings: có (branch R2)

Ghi chú: `SaveTabState` không dùng `ctx` (ghi file cục bộ nhanh). Lưu nền nên FE dùng `showMessage: false`; backend vẫn log `slog.Error`.

## 4. Task frontend (react-frontend)

### R1: kéo thả tab (branch SP-09/tab_drag_drop)
| # | Task | Yêu cầu | File sửa / tạo | Phụ thuộc |
|---|---|---|---|---|
| F1 | `bun add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities @dnd-kit/modifiers motion` trong `frontend/` (đã được đồng ý) | R1 | `frontend/package.json`, `frontend/bun.lock` (sửa qua bun) | - |
| F2 | `tabListStore.moveTab(activeId, overId)`: dựng lại object `tabList` theo thứ tự mới (giữ state tab, no-op nếu id trùng/không tồn tại), không đổi `activeTab` | R1 | `frontend/src/common/stores/tabListStore.ts` (sửa) | - |
| F10 | Nền tảng animation dùng lại: `motionConst.ts` (hằng transition dùng chung, vd `TRANSITION_FAST`, `TRANSITION_SPRING`, variants `fadeScale`), component `MotionProvider` = `LazyMotion features={domAnimation} strict` + `MotionConfig reducedMotion="user"` (tôn trọng `prefers-reduced-motion`); bọc quanh `App` trong `main.tsx`. Dùng `m.*` thay `motion.*` để giảm bundle | R1 | `frontend/src/common/cnst/motionConst.ts` (tạo), `frontend/src/components/providers/MotionProvider.tsx` (tạo), `frontend/src/main.tsx` (sửa) | F1 |
| F3 | `SortableTab` (`memo`, `useSortable`): wrapper ngoài nhận dnd-kit (`setNodeRef`, `style.transform = CSS.Translate.toString(transform)`, `transition` của dnd-kit, `touch-action`, `cursor: grab`, `zIndex` khi `isDragging`); bên trong là `m.div` riêng chịu animation của motion: nâng tab khi kéo (`animate={{ scale, boxShadow }}` theo `isDragging`) và enter/exit khi thêm/đóng tab (opacity + co giãn chiều rộng). `Tabs.Tab` giữ nguyên click, nút đóng, tooltip kéo | R1 | `frontend/src/components/layouts/tab/components/SortableTab.tsx` (tạo) | F2, F10 |
| F4 | `TabLayout`: bọc `DndContext` (`PointerSensor` `activationConstraint: { distance: 5 }`, `KeyboardSensor`, `closestCenter`, modifiers `restrictToHorizontalAxis` + `restrictToParentElement`) + `SortableContext` (`horizontalListSortingStrategy`); `onDragEnd` gọi `moveTab` khi `over` khác và không null; `AnimatePresence initial={false}` quanh danh sách tab; giữ `scrollIntoView` tab active nhưng bỏ qua khi đang kéo; mọi hàm bọc `useCallback` | R1 | `frontend/src/components/layouts/tab/TabLayout.tsx` (sửa) | F3 |
| F5 | i18n `tabLayout.tooltip.dragTab` (en/vi/ja) | R1 | `frontend/src/locales/{en,vi,ja}/components/tabLayout.json` (sửa) | - |

Cách kết hợp dnd-kit + motion (chọn để không xung đột transform):
- dnd-kit giữ toàn quyền `transform`/`transition` của wrapper ngoài (vị trí tab khi kéo và khi các tab khác dịch chỗ). Tuyệt đối không dùng `layout`/`layoutId` của motion trên cùng phần tử hoặc ancestor của phần tử mà dnd-kit đang dịch, vì khi thả dnd-kit xoá transform đồng thời DOM đổi thứ tự, motion `layout` sẽ đo lệch và animate chồng lên (nhảy hình).
- motion chỉ animate `m.div` nội dung bên trong (khác phần tử với transform của dnd-kit): hiệu ứng nâng khi kéo (scale + shadow) và enter/exit khi thêm/đóng tab (opacity, chiều rộng/scale). Hai transform nằm ở hai phần tử lồng nhau nên cộng dồn an toàn.
- Dùng `LazyMotion` + `domAnimation` (không cần `domMax` vì không dùng layout animation), chỉ animate `transform`/`opacity` (GPU, không gây reflow).
- Phương án dự phòng nếu kết hợp lỗi (đặc biệt phần exit): bỏ exit, giữ enter + nâng tab, hoặc chỉ dùng transition CSS của dnd-kit (chưa xác minh hành vi của `AnimatePresence` với phần tử sortable thoát khỏi `SortableContext`; cần thử thủ công, nếu phải bỏ thì báo lại người dùng).

### R2: ghi nhớ tab (branch SP-09/tab_persistence)
| # | Task | Yêu cầu | File sửa / tạo | Phụ thuộc |
|---|---|---|---|---|
| F6 | `tabListStore`: `serializeTabs()` (trả `{ tabs: [{id, profileId}], activeTab }` theo thứ tự key) và `restoreTabs(state)` (rỗng hoặc id lỗi thì giữ tab mặc định; `activeTab` không hợp lệ thì tab đầu; dựng bằng `newTab()` + `profileId`) | R2 | `frontend/src/common/stores/tabListStore.ts` (sửa) | B1 |
| F7 | Util `tabPersistence.ts`: `restoreTabsFromDisk()` (`GetTabState` qua `callIPC`, `showMessage: false`; null thì bỏ qua), `normalizeTabProfiles(profiles)` (đặt `profileId=null` cho profile không còn), `saveTabState` | R2 | `frontend/src/common/utils/tabPersistence.ts` (tạo) | F6, B4 |
| F8 | Hook `useTabPersistence`: selector hẹp (chuỗi serialize ổn định), debounce 500ms, bỏ qua khi payload không đổi, không lưu trước khi khôi phục xong (cờ `restored`), huỷ timer khi unmount, flush khi `pagehide` nếu có thể; không connect. Mount trong `App.tsx` | R2 | `frontend/src/components/layouts/tab/useTabPersistence.ts` (tạo), `frontend/src/App.tsx` (sửa) | F6, F7 |
| F9 | `main.tsx`: `await restoreTabsFromDisk()` sau `settingStore.load()`, trước render; chuẩn hoá profile đã xoá sau khi `loadConnectionProfiles` thành công (logic ở `tabPersistence.ts`) | R2 | `frontend/src/main.tsx` (sửa), `frontend/src/common/utils/tabPersistence.ts` | F7 |

Lưu ý conflict giữa hai branch: cả hai sửa `main.tsx` (R1 bọc `MotionProvider`, R2 thêm restore) ở hai vị trí khác nhau, và `tabListStore.ts` (khác action). Branch sau rebase trên master sau khi branch trước merge.

i18n key mới (en/vi/ja): `tabLayout.tooltip.dragTab` (R1); R2 không có text UI mới.

Test frontend (react-tester):
| Task | File cần test | Case cần phủ |
|---|---|---|
| F2 | `frontend/src/test/common/stores/tabListStore.test.ts` | `moveTab` lên trước/xuống sau, trùng id no-op, id không tồn tại no-op (active lẫn over), giữ state tab và `activeTab`; `moveTab` rồi `closeTab` |
| F10 | `frontend/src/test/components/providers/MotionProvider.test.tsx` | render children, truyền `reducedMotion="user"` vào `MotionConfig` (mock `motion/react`); `motionConst.ts` là file hằng thì bị loại khỏi coverage |
| F3 | `frontend/src/test/components/layouts/tab/components/SortableTab.test.tsx` | render children, `isDragging` true/false (style/animate), click chọn tab, nút đóng không kích hoạt chọn; mock `@dnd-kit/sortable` và `motion/react` |
| F4 | `frontend/src/test/components/layouts/tab/TabLayout.test.tsx`, `TabLayoutNoScroller.test.tsx` | thứ tự tab, `onDragEnd` gọi `moveTab` khi over khác, bỏ qua khi over null / cùng id, `scrollIntoView` bị bỏ qua khi đang kéo, thêm/đóng tab (AnimatePresence mock), không có Scroller; mock `@dnd-kit/core` (jsdom không giả lập pointer drag), ghi rõ nhánh sensor không test được nếu có |
| F6 | `tabListStore.test.ts` | `serializeTabs` thứ tự + profile null/undefined; `restoreTabs` rỗng, `activeTab` hợp lệ/không hợp lệ, id trùng, giữ `profileId` |
| F7 | `frontend/src/test/common/utils/tabPersistence.test.ts` | `callIPC` trả body / null / tab rỗng; profile còn / bị xoá / danh sách rỗng; tải profile lỗi thì không chuẩn hoá |
| F8 | `frontend/src/test/components/layouts/tab/useTabPersistence.test.tsx` (fake timers) | không lưu trước restore, debounce gộp, payload không đổi thì không lưu, lưu thất bại (null) không ném lỗi, unmount huỷ timer, flush khi `pagehide` |
| F9 | `frontend/src/test/App.test.tsx` (sửa) | App gọi hook persistence (mock hook); `main.tsx` loại khỏi coverage, logic ở `tabPersistence.ts` |

Cách mock `motion` trong test: helper dùng chung `frontend/src/test/_helpers/mockMotion.tsx` (react-tester tạo), dùng qua `vi.mock('motion/react', async () => (await import('@/test/_helpers/mockMotion')).motionMock)`. Mock gồm: `m` và `motion` là Proxy trả component render phần tử HTML thường (lọc các prop `animate`, `initial`, `exit`, `transition`, `variants`, `whileHover`... không để lọt xuống DOM), `AnimatePresence`, `LazyMotion`, `MotionConfig` chỉ render children (`MotionConfig` ghi lại prop để test `reducedMotion`), và `domAnimation` là object rỗng. Test kiểm tra prop `animate` bằng cách mock component ghi lại props (vd `data-animate`). Không dùng timer thật; không chờ animation.

## 5. Branch
| Branch | Yêu cầu | Task | Ghi chú |
|---|---|---|---|
| SP-09/tab_drag_drop | R1 | F1, F2, F3, F4, F5, F10 | Chỉ frontend, không sinh bindings. Làm trước. |
| SP-09/tab_persistence | R2 | B1, B2, B3, B4, B5, F6, F7, F8, F9 | Cần sinh bindings. Không sửa `TabLayout.tsx`. Sau khi cả hai merge, thứ tự tab do kéo thả được lưu tự động (`serializeTabs` theo `Object.keys`). |

## 6. Thứ tự thực hiện (tuần tự, xong branch này mới sang branch sau)
1. `SP-09/tab_drag_drop`: tách từ `origin/master` (git-flow) -> F1 (`bun add`) -> không có backend, không cần sinh bindings -> F2, F10, F3, F5, F4 -> FE test (react-tester) -> verify -> review -> commit.
2. `SP-09/tab_persistence`: tách từ `origin/master` -> B1-B5 -> `go tool wails3 generate bindings -clean=true -ts` -> F6, F7, F8, F9 -> FE test -> verify -> review -> commit.

## 7. Rủi ro
| # | Rủi ro | Mức độ | Cách giảm thiểu |
|---|---|---|---|
| 1 | Race khi khôi phục: hook lưu ghi đè `tabs.json` bằng tab mặc định trước khi restore xong | high | Restore trước render trong `main.tsx`, cờ `restored`, test "không lưu trước restore" |
| 2 | Chuẩn hoá profile khi danh sách profile chưa tải xong sẽ xoá nhầm profile hợp lệ | high | Chỉ chuẩn hoá sau khi `loadConnectionProfiles` thành công |
| 3 | Xung đột transform giữa dnd-kit và motion (nhảy hình khi thả, animate chồng) | high | dnd-kit sở hữu transform của wrapper ngoài; motion chỉ animate `m.div` lồng bên trong; không dùng `layout`/`layoutId`; có phương án dự phòng chỉ dùng transition dnd-kit; kiểm tra thủ công kéo/thả/đóng tab |
| 4 | Hiệu năng kéo thả: re-render mọi tab/panel mỗi frame, bundle tăng do `motion` | medium | `SortableTab`/`TabLabel` `memo`; chỉ animate transform/opacity; `LazyMotion` + `domAnimation` + `m.*`; `DndContext` chỉ bọc thanh tab (panel ngoài); `moveTab` chỉ gọi lúc thả; không dùng `DragOverlay`; `reducedMotion="user"` |
| 5 | `AnimatePresence` exit với tab bị xoá khỏi `SortableContext` ngay (store xoá tức thì) có thể giật hoặc `useSortable` báo lỗi | medium | Chưa xác minh; thử thủ công, nếu lỗi dùng phương án dự phòng (bỏ exit) và báo lại người dùng |
| 6 | Xung đột kéo với click, nút đóng, `Scroller`, `scrollIntoView`, scroll ngang khi tab tràn | medium | `activationConstraint` distance 5px, nút đóng `stopPropagation`, bỏ `scrollIntoView` khi đang kéo, `restrictToParentElement`; auto-scroll của dnd-kit với `Scroller` Mantine chưa xác minh |
| 7 | Test kéo thả và animation trong jsdom khó phủ nhánh | medium | Mock `@dnd-kit/*` và `motion/react` bằng helper dùng chung; tách `onDragEnd` thành hàm test được; ghi rõ nhánh không test được |
| 8 | Đổi thứ tự `tabList` làm `closeTab` chọn tab kế theo thứ tự mới | low | Hành vi mong muốn; có test |
| 9 | Ghi đĩa liên tục | low | Debounce 500ms, so sánh payload, ghi atomic |
| 10 | `main.tsx`/`tabListStore.ts` bị sửa ở cả hai branch | low | Khác vị trí/khác action; rebase sau khi branch trước merge |
| 11 | File `tabs.json` hỏng/chỉnh tay | low | Backend validate và trả state rỗng; FE `restoreTabs` kiểm tra thêm |
| 12 | Số task 15 (6 + 9) vượt ngưỡng ~10 | low | Đã chia 2 branch độc lập; có thể tách R2 sang sprint riêng nếu thấy nặng |

## 8. Tiêu chí hoàn thành
- [ ] Unit test frontend đạt C1 và lines >= 95% cho từng file đã đổi (nêu lý do nhánh không test được)
- [ ] Kéo thả tab mượt, không giới hạn số lần, click/đóng tab/bàn phím vẫn hoạt động; không nhảy hình khi thả
- [ ] Có animation enter/exit khi thêm/đóng tab và hiệu ứng nâng tab khi kéo; tôn trọng `prefers-reduced-motion`; nền tảng motion (`MotionProvider`, hằng transition) dùng lại được cho sprint sau
- [ ] Đóng và mở lại app: số tab, thứ tự, tab active, profile của tab được khôi phục; không tự connect
- [ ] Profile bị xoá thì tab được giữ với `profileId = null`
- [ ] `STE005`-`STE007` có key trong 3 `ipcMessage.json`; `tabLayout.tooltip.dragTab` đủ en/vi/ja
- [ ] Model mới re-export trong `models/alias.go`; `go vet`, `go build`, golangci-lint, biome, oxlint, `tsc --noEmit` đạt
- [ ] Bindings sinh lại bằng `go tool wails3 generate bindings -clean=true -ts`, không sửa tay
