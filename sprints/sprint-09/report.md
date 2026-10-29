## Kết quả sprint-09
- Trạng thái: Hoàn thành
- Tổng thay đổi (không tính tài liệu sprint): +1224 / -44 dòng
  - SP-09/tab_drag_drop: +556 / -34 (16 file)
  - SP-09/tab_persistence: +668 / -10 (20 file)

### Branch
| Branch | Yêu cầu | Số vòng review | Commit | Trạng thái |
|---|---|---|---|---|
| SP-09/tab_drag_drop | R1 | 2/3 | ca7e14fe | Đạt |
| SP-09/tab_persistence | R2 | 2/3 | (commit cùng tài liệu sprint) | Đạt |

### File sửa đổi
| File | +/- |
|---|---|
| frontend/package.json | +5 / -0 (R1) |
| frontend/src/common/stores/tabListStore.ts | +14 (R1), +26 (R2) |
| frontend/src/components/layouts/tab/TabLayout.tsx | R1, tổng +84 dòng thay đổi |
| frontend/src/main.tsx | R1 tổng 5 dòng thay đổi, +5 / -0 (R2) |
| frontend/src/locales/{en,vi,ja}/components/tabLayout.json | +1 mỗi file (R1) |
| frontend/src/App.tsx | +3 / -0 (R2) |
| frontend/src/common/stores/profileStore.ts | +4 / -2 (R2) |
| frontend/src/locales/{en,vi,ja}/messages/ipcMessage.json | +4 / -1 mỗi file (R2) |
| internal/handlers/setting_handler.go | +10 / -0 (R2) |
| internal/modules/setting/module.go | +41 / -0 (R2) |
| internal/modules/setting/submodule_file_mng.go | +9 / -3 (R2) |
| models/alias.go | +6 / -0 (R2) |
| frontend/src/test/common/stores/tabListStore.test.ts | +38 (R1), +66 (R2) |
| frontend/src/test/components/layouts/tab/TabLayout.test.tsx | R1, tổng +126 dòng thay đổi |
| frontend/src/test/components/layouts/tab/TabLayoutNoScroller.test.tsx | +1 (R1) |
| frontend/src/test/common/stores/profileStore.test.ts | +2 / -2 (R2) |

### File thêm mới
| File | Số dòng |
|---|---|
| frontend/src/common/cnst/motionConst.ts (R1) | 10 |
| frontend/src/components/layouts/tab/components/SortableTab.tsx (R1) | 81 |
| frontend/src/components/providers/MotionProvider.tsx (R1) | 12 |
| frontend/src/test/_helpers/mockMotion.tsx (R1) | 64 |
| frontend/src/test/components/layouts/tab/components/SortableTab.test.tsx (R1) | 117 |
| frontend/src/test/components/providers/MotionProvider.test.tsx (R1) | 30 |
| frontend/src/common/utils/tabPersistence.ts (R2) | 45 |
| frontend/src/components/layouts/tab/useTabPersistence.ts (R2) | 40 |
| internal/modules/setting/submodule_tab_mng.go (R2) | 113 |
| models/setting/tab_input.go (R2) | 7 |
| models/setting/tab_output.go (R2) | 13 |
| frontend/src/test/common/utils/tabPersistence.test.ts (R2) | 122 |
| frontend/src/test/components/layouts/tab/useTabPersistence.test.ts (R2) | 144 |

Bindings (`frontend/bindings/**`) được sinh lại cho R2 (`GetTabState`, `SaveTabState`, `TabItem`, `TabState`, `SaveTabStateInput`) nhưng thư mục này không được git track.

### Đối chiếu yêu cầu
- R1:
  - [x] Kéo thả tab thoải mái, không giới hạn (dnd-kit, trục ngang, hỗ trợ bàn phím).
  - [x] Animation mượt: dnd-kit CSS transform + motion (nâng tab khi kéo, enter/exit khi mở/đóng tab), `LazyMotion` + `m`, `reducedMotion="user"`.
- R2:
  - [x] Mở app load lại toàn bộ tab đã nhớ (thứ tự, tab active, profile) từ `<DataDir>/tabs.json`, lưu liên tục debounce 500ms.
  - [x] Không tự connect.
  - [x] Profile đã xoá: giữ tab, bỏ profile (chỉ khi tải danh sách profile thành công).

### Kiểm tra
- R1: tsc, biome, oxlint PASS; vitest 759/759; coverage Branches/Lines 100% cho tabListStore.ts, TabLayout.tsx, SortableTab.tsx, MotionProvider.tsx.
- R2: golangci-lint (0 issues), go vet, go build PASS; bindings khớp; tsc, oxlint PASS; vitest 770/770; coverage Branches/Lines 100% cho tabListStore.ts, profileStore.ts, tabPersistence.ts, useTabPersistence.ts, App.tsx.

### Quyết định phát sinh trong lúc làm (đã được người dùng chấp nhận)
- Thêm lib `motion` (Q1) và nền tảng animation dùng chung (`MotionProvider`, `motionConst.ts`).
- `profileStore.loadConnectionProfiles` đổi từ `Promise<void>` sang `Promise<boolean>` (ngoài plan).
- `tabs.json` hỏng JSON: chỉ log, mở với tab mặc định, không hiện cảnh báo.
- Bug phát hiện ở vòng 1 R2 và đã sửa: khi `GetTabState` lỗi I/O, lần đổi tab đầu tiên ghi đè `tabs.json`. Nay dùng cờ `restoreFailed` để không lưu trong cả phiên đó.

### Phần chưa làm / cần lưu ý
- Chưa thử thủ công trong app: animation exit khi đóng tab, tab có nhảy hình sau khi thả không, auto-scroll khi kéo với `Scroller`, outline tab có lệch vài px không.
- Low (R1), chưa sửa:
  - Tooltip native "Kéo để đổi vị trí" hiện trên mọi tab.
  - Cursor grab vẫn hiện khi chỉ có 1 tab.
  - Space/Enter bắt đầu kéo bằng bàn phím thay vì chọn tab (phím mũi tên vẫn chọn tab được).
  - Tab còn lại nhảy chỗ ngay khi đóng tab (không có layout animation).
  - Mock dnd-kit lặp giữa 2 file test.
- Low (R2), chưa sửa:
  - `useTabPersistence` subscribe qua selector khiến `App` re-render khi layout tab đổi; có thể chuyển sang `store.subscribe`.
  - `restoreTabs` dùng `in`, nên đổi sang `Object.hasOwn`.
  - Lưu lỗi không retry.
  - `writeJSONAtomic` chưa `Sync()` trước `Rename`.
  - Toast lỗi tải profile lúc khởi động có thể không hiện vì chạy trước khi `Toaster` mount.
- Test flaky ngoài phạm vi sprint khi máy tải nặng: `UploadLimitModal.test.tsx` (timeout), `SettingModal.test.tsx`.
- `biome.json` khai báo schema 2.6.3 lệch CLI 2.6.4 → nên chạy `biome migrate`.
- Helper test cũ `renderWithProviders.tsx` nằm ở `src/test/` thay vì `src/test/_helpers/` theo CLAUDE.md.
- `frontend/bun.lock` bị gitignore, nên PR R1 chỉ có thay đổi `package.json`.
- Orchestrator đã lỡ chạy `git add -N .` (intent-to-add) trên branch SP-09/tab_persistence khi lấy số liệu.

### Đề xuất cập nhật CLAUDE.md (người dùng tự sửa)
- Stack: thêm `@dnd-kit/*` và `motion`.
- Animation: dùng `m` + `LazyMotion` qua `MotionProvider`, không dùng `motion.*` trực tiếp; preset đặt ở `common/cnst/motionConst.ts`.
- Test: mock `motion/react` bằng `src/test/_helpers/mockMotion.tsx`.
- Backend: dùng `writeJSONAtomic` cho file JSON trong data dir.
