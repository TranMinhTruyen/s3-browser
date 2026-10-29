# Plan sprint-09

> Phân tích ban đầu của R1, R2 nằm ở `sprints/sprint-08/plan.md` mục 8. File này ghi lại phạm vi thực tế đã làm, kể cả phần bổ sung trong sprint.

## 1. Branch và PR

| Yêu cầu | Branch | PR |
|---|---|---|
| R1 + R3 | `SP-09/tab_drag_drop_profile_list` (đổi tên từ `SP-09/tab_drag_drop`) | #8 |
| R2 | `SP-09/tab_persistence` | #9 |

R3 phát sinh khi đang làm R1 và sửa cùng vùng UI (TabActionBar, select), nên gộp vào branch của R1.

## 2. R1: Kéo thả tab (bổ sung sau commit đầu)

| # | Task | File |
|---|---|---|
| F7a | Tab kéo bằng `DragOverlay` (portal vào `document.body`), không trong suốt, không bị cắt hay giật khi kéo ra mép | `TabLayout.tsx`, `components/TabDragPreview.tsx` |
| F7b | Collision tự viết: chỉ đổi chỗ khi tab kéo phủ ≥ 90% tab đích | `TabLayout.tsx` |
| F7c | Thay Mantine `Scroller` bằng `TabScroller`: mũi tên hai bên không đè tab, ẩn khi tới đầu/cuối, phân trang canh tab ở mép trái, animation cuộn bằng rAF, cuộn bằng wheel | `components/TabScroller.tsx` |
| F7d | Vạch ngăn giữa các tab không được chọn (giống Chrome) bằng CSS `::after` | `components/SortableTab.tsx`, `components/SortableTab.module.css` |
| F7e | Hiệu năng 200 tab: lazy mount `TabDetail` chỉ khi tab đã được mở; không cuộn nhảy sau khi thả | `TabLayout.tsx` |

i18n: `tabLayout.tooltip.scrollLeft`, `tabLayout.tooltip.scrollRight` (en/vi/ja).

## 3. R3: Danh sách profile và select

| # | Task | File |
|---|---|---|
| F9 | Virtualize danh sách profile bằng `useVirtualizer` (estimate 64, gap 8, overscan 5, `measureElement`); `LeftNavbar` đổi sang flex column | `navbar/components/ConnectionProfiles.tsx`, `navbar/LeftNavbar.tsx` |
| F10 | Tách `ConnectionProfileItem` (`memo`), callback ổn định nhận `key`; reset `openedMenuKey` khi dòng bị cuộn ra ngoài | `navbar/components/ConnectionProfileItem.tsx` |
| F11 | `Combobox` có prop `searchPlaceholder`, `emptyText`: search trong dropdown, tự focus khi mở, reset từ khoá khi đóng (qua `onDropdownClose`) | `inputs/combobox/Combobox.tsx`, `inputs/combobox/useSelectCombobox.ts`, `layouts/tab/components/TabActionBar.tsx` |
| F12 | `BucketPicker` tự focus ô search khi mở | `inputs/combobox/BucketPicker.tsx` |
| F13 | Theme Mantine dùng chung: nền, viền, đổ bóng, màu option cho `Combobox`, `Select`, `MultiSelect`, `Autocomplete`, `TagsInput` | `common/theme/appTheme.ts`, `inputs/combobox/combobox.module.css`, `main.tsx` |

i18n: `tabLayout.search.placeholderProfile`, `tabLayout.search.emptyProfile` (en/vi/ja).

## 4. Kiểm tra

- vitest: 862/862 pass. Coverage C1 và Lines ≥ 95% cho mọi file đã đổi. `TabScroller.tsx` đạt 95.91% branches, các guard phòng thủ không test được. `ConnectionProfiles.tsx` đạt 98.21%.
- tsc, biome, oxlint: sạch.
- Review hiệu năng (200 profile / 200 tab): không có vấn đề mức cao.

## 5. Còn lại (chưa sửa)

| Vấn đề | Mức | Ghi chú |
|---|---|---|
| `BucketPicker` không `memo` option, chậm khi đã "load more" lên ~200 bucket | Trung bình–thấp | Tách option `memo` như `Combobox` |
| `ConnectionProfiles` ghi đè profile bằng `value` lấy trước `await` khi connect/disconnect | Thấp | Đọc lại profile mới nhất sau `await` |
| Auto-connect bắn tất cả IPC song song (200 profile) | Thấp | Kiểm tra giới hạn ở Go trước, nếu chưa có thì giới hạn 5–10 |
| Selector `Object.fromEntries` trong `TabDetail` chạy lại cho mỗi tab đã mở | Thấp | Code có từ trước |

## 6. Cần thử bằng tay

- Kéo thả tab: cảm giác kéo, ngưỡng 90%, không còn vạch đen, không nhảy cuộn sau khi thả.
- `TabScroller`: mũi tên, phân trang, wheel, vạch ngăn tab.
- 200 profile: cuộn mượt, context menu ở đầu/giữa/cuối, connect/disconnect/edit/delete.
- Dropdown ở light/dark: SettingModal, ConnectModal, select region, select profile, select bucket; bóng không bị modal cắt.
