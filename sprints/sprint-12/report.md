## Kết quả sprint-12
- Trạng thái: **DONE** (2026-11-04). Mọi yêu cầu đã merge vào `staging`, R8e qua PR #5. Người dùng đã đo và kiểm tay theo nhóm, xác nhận đạt tiêu chí (số liệu đo tay không ghi trong report).
- Tổng thay đổi: số liệu theo từng PR ở bảng dưới (git log --shortstat). R8e: commit `d0ae1b5` +84 / -58 dòng (12 file, gồm 1 file test mới), cộng phần chỉnh UI và tách trang tab ở mục "R8e: chỉnh UI và tách trang tab" (+219 / -201, 73 file, chủ yếu là di chuyển file).
- Ghi chú repo: ngày 2026-11-03 repo tách khỏi monorepo `kanban-board`. PR #25-#33 thuộc repo cũ; PR #2, #3, #4 thuộc `TranMinhTruyen/s3-browser`.

### Branch
| Branch | Yêu cầu | PR | Thay đổi | Trạng thái |
|---|---|---|---|---|
| SP-12/lang_font_switch | R5 | #25 (cũ) | không lấy số | Đã merge |
| SP-12/profile_list_scroll | R6 + R4 (ConnectionProfiles) | #26, #27 (cũ) | #27: +44 (2 file) | Đã merge |
| SP-12/object_list_scroll | R1 | #28 (cũ) | +619 / -277 (22 file) | Đã merge |
| SP-12/transfer_progress_batch | R2 | #29 (cũ) | +347 / -118 (22 file) | Đã merge |
| SP-12/tab_persist_selector | R4 | #30 (cũ) | +180 / -9 (5 file) | Đã merge |
| SP-12/locale_lazy_load | R3 | #31 (cũ) | không lấy số | Đã merge |
| SP-12/refactor_be_bucket | R7a | #32 (cũ) | +143 / -237 (16 file) | Đã merge |
| SP-12/batch_delete_result | R9 | #33 (cũ) | +1856 / -519 (90 file) | Đã merge |
| SP-12/refactor_be_rest | R7b | #2 | +25 / -86 (9 file) | Đã merge |
| SP-12/refactor_fe_common | R8c | #3 | +64 / -103 (8 file) | Đã merge |
| SP-12/refactor_fe_components | R8d | #4 | +1779 / -841 (86 file, gồm 3 commit ngoài plan) | Đã merge |
| SP-12/refactor_fe_pages | R8e | #5 | d0ae1b5 +84 / -58 (12 file); chỉnh UI +219 / -201 (73 file) | Đã merge |

PR #4 có thêm 3 commit ngoài plan R8d: `feat(bucket): flag inaccessible and read-only buckets with cheaper access checks`, `docs(test-env): rewrite test profiles as method and field tables`, `chore(agents): run planner on opus and orchestrator on sonnet`.

### File sửa đổi (R8e, commit d0ae1b5)
| File | Nội dung |
|---|---|
| frontend/src/components/modals/connect/connectSchema.ts | gộp `numberInput`, dời hằng, comment tiếng Anh |
| frontend/src/pages/bucket/BucketItem.tsx | style inline thành hằng module |
| frontend/src/pages/bucket/BucketListView.tsx | hằng `PREFETCH_ROWS` |
| frontend/src/pages/object/ObjectListView.tsx | shorthand `connectionId` |
| frontend/src/locales/{en,vi,ja,zh-CN,zh-TW,ru,de}/common.json | -3 key mỗi file (-21 dòng) |

### File thêm mới (R8e, commit d0ae1b5)
| File | Số dòng |
|---|---|
| frontend/src/test/locales/localeParity.test.ts | test cùng tập file, key, placeholder giữa 7 ngôn ngữ |

### R8e: chỉnh UI và tách trang tab (theo yêu cầu người dùng khi test tay, gộp vào R8e)
- Tab thành một page riêng, bucket/object là con của tab:
  - `components/layouts/tab/TabLayout.tsx` → `pages/tab/TabPage.tsx` (đổi tên component).
  - `components/layouts/tab/components/*` → `pages/tab/components/*`.
  - `pages/{bucket,object}` → `pages/tab/{bucket,object}`.
  - Test chuyển theo cây mới (`test/pages/tab/**`, `TabLayout*.test` → `TabPage*.test`), chỉ đổi import/đường dẫn.
  - Locale `components/layouts/tab/*.json` và `pages/{bucket,object}` → `pages/tab/...` cho cả 7 ngôn ngữ, sửa 7 `resource.ts`. Tên namespace `tabLayout` giữ nguyên.
- TabPage có viền ngoài giống LeftNavbar (`Paper withBorder p="4px"`), bỏ lớp viền trong để không bị hai viền. Tab pill cao bằng nút + (`TAB_HEIGHT = rem(34)` trong file mới `pages/tab/components/tabConst.ts`, dùng chung cho `SortableTab` và `TabDragPreview`), căn giữa với nút +, tab đầu thẳng hàng với TabDetail.
- Padding 4px chỉ cho layout của app: pane trong `MainLayout`, header navbar `HeaderButtonGroup`, khung TabPage. Item và modal giữ padding cũ.
- `ConnectModal`: thân modal dùng `maxHeight` thay cho `height`; phương thức xác thực ngắn hơn Access key thì modal co lại, dài hơn mới có thanh cuộn.
- `BucketItem`: phần icon đồng bộ với hàng folder của `ObjectItem` (padding 8px, icon 20px, bỏ `minWidth`).
- Dọn theo tiêu chí R8: bỏ `p="0"` thừa trong `SortableTab`, sửa docblock TabPage cho đúng (nội dung tab mount khi mở lần đầu, giữ bằng `Activity`).
- Kiểm tra: tsc, biome, oxlint, knip sạch; vitest 110 file, 1959 test pass, console sạch. Coverage: `ConnectModal.tsx` 98.95% nhánh; các file còn lại trong phạm vi đổi không hiện trong bảng text (bảng ẩn file đạt 100%).

### Đối chiếu yêu cầu
| Yêu cầu | Trạng thái | Ghi chú |
|---|---|---|
| R5, R6, R4, R1, R2, R3 | Đạt | Đã merge |
| R7a, R7b | Đạt | Đã merge |
| R9 | Đạt | Đã merge (#33) |
| R8c, R8d | Đạt | Đã merge |
| R8e | Đạt | Code đã sạch từ R8c/d nên phần dọn nhỏ: xoá key `common:button.create|update|refresh` x7, dọn nhẹ pages và connectSchema. Không xoá export chết nào (knip thường sạch). Thêm phần chỉnh UI và tách trang tab ở trên |

### Kết quả kiểm tra (R8e, vòng 2)
- go vet / go build / golangci-lint (0 issues) / biome / oxlint / tsc / knip: đạt.
- vitest: 110 file, 1959 test pass, console sạch.

### Coverage frontend (ngưỡng ≥ 95%)
| File | Lines | Branches (C1) | Đạt |
|---|---|---|---|
| connectSchema.ts | 100% | 100% | Có |
| BucketItem.tsx | 100% | 100% | Có |
| BucketListView.tsx | 100% | 98.09% | Có |
| ObjectListView.tsx | 100% | 98.09% | Có |
| ConnectModal.tsx | 100% | 98.95% | Có |

### Vòng review R8e
- Vòng 1: code-reviewer báo thiếu test so sánh key/placeholder giữa ngôn ngữ (medium); đã thêm `localeParity.test.ts`, kèm dọn low (numberInput, style hằng, PREFETCH_ROWS).
- Vòng 2: verifier và code-reviewer đạt.
- Phần chỉnh UI và tách trang tab làm trực tiếp ở session chính, không qua vòng code-reviewer.

### Vấn đề còn lại
- knip `--production` còn báo 9 export chỉ test dùng (`useCredentialExpiring`, `useObjectPaging`, `stringUtils`, `tabPersistence`, `tabUtils`, type `UploadPickerResult`, `isSecureIssuerUrl`); theo CLAUDE.md không coi là code chết, giữ nguyên.
- `BucketItem` vẫn tự gọi `useTranslation` (không dùng pattern `labels` như `ObjectItem`), vì đổi props là ngoài phạm vi dọn.
- Namespace i18n `tabLayout` vẫn mang tên component cũ (nay là `TabPage`); chưa đổi vì không bắt buộc.
- Đề xuất bổ sung `CLAUDE.md`: "Padding layout chính (pane, header navbar, khung trang tab) là `4px`; item và modal giữ padding riêng."
- Skill `wails3-bindings` phần B bước 4 dùng `find -newer frontend/bindings` (so mtime thư mục) nên báo nhầm "bindings cũ". Người dùng có thể sửa skill.
- `plan.md` mục 5-6 còn ghi `origin/master` (lỗi thời; nay tách từ `origin/staging`).
