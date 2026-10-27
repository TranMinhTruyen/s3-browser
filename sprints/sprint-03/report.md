# Báo cáo sprint-03

Ngày 2026-10-27. Kết quả: **R1 hoàn thành** (tiêu chí 1–4). Qua verify và review, kết luận ĐẠT ở vòng 3/3. **Luật 8 (coverage C1) chưa đạt**, chuyển sang sprint-04.

## Số liệu

Không tính các thay đổi người dùng tự làm trong lúc chạy sprint: `go.mod`/`go.sum` (nâng Wails `v3.0.0`, `transfermanager` `v0.5.0`), version `@wailsio/runtime`/`@tanstack/react-virtual`/`postcss` trong `frontend/package.json`, `CLAUDE.md`, dời file `pages/bucket/**` và `pages/object/**` ra khỏi `components/`. Hai file `ObjectItem.tsx`, `ObjectListView.tsx` tính theo diff so với bản cũ trước khi dời. Không tính `frontend/bindings/**` (sinh tự động).

| | File | Dòng |
|---|---|---|
| Sửa | 20 | +170 / −94 |
| Tạo mới | 14 | +1127 |

Ngoài ra `frontend/package.json` thêm script `test`, `test:watch`, `test:coverage` và devDependencies `vitest`, `@vitest/coverage-v8`, `jsdom`, `@testing-library/{react,dom,jest-dom,user-event}`.

### File tạo mới
- **Go:** `models/bucket/object_detail_input.go`, `models/bucket/object_detail_output.go`, `internal/modules/bucket/submodule_object_detail.go`, `internal/modules/bucket/submodule_object_detail_test.go`
- **Frontend:**
  - `components/layouts/tab/components/ObjectDetailDrawer.tsx` (+ `.test.tsx`)
  - `pages/object/ObjectItem.test.tsx`, `pages/object/ObjectListView.test.tsx`
  - `test/setup.ts`, `test/renderWithProviders.tsx` (+ `.test.tsx`)
  - `locales/{en,vi,ja}/components/objectDetailDrawer.json`

### File sửa
- **Go:** `models/alias.go`, `internal/handlers/bucket_handler.go`, `internal/modules/bucket/module.go`, `internal/modules/bucket/submodule_object_mng.go`
- **Frontend:** `common/stores/tabListStore.ts`, `components/layouts/tab/components/TabDetail.tsx`, `pages/object/ObjectItem.tsx`, `pages/object/ObjectListView.tsx`, `pages/object/page.module.css`, `vite.config.ts`, `tsconfig.json`
- **Locale (en/vi/ja):** `resource.ts`, `messages/ipcMessage.json`, `pages/object/page.json`

## R1: drawer chi tiết object
- Backend `GetObjectDetail` gọi `HeadObject`, trả `contentType`, `storageClass` (rỗng nếu provider không trả), `metadata` (không bao giờ null). Mã mới: `S3E024` (HeadObject lỗi), `S3E025` (key rỗng hoặc là folder). Ctx huỷ thì `Result=false` im lặng.
- `ObjectItem` bỏ size/lastModified. Click thân card mở drawer, checkbox và menu không mở drawer.
- `ObjectDetailDrawer` là panel rộng 320px nằm bên phải, trong tab, không overlay. Hiện ngay name, key, size (kèm số byte), lastModified, etag. Sau đó tải contentType, storageClass, bảng metadata sắp theo key. Có loading, lỗi kèm thử lại, nút copy key/etag. Giá trị rỗng hiện "-".
- Mỗi tab giữ `detailItem` riêng trong `tabListStore`. Drawer đóng khi đổi view, prefix, profile, hoặc khi chính object đó (hoặc folder chứa nó) bị xoá **thành công**. Download, xoá object khác, refresh không đóng drawer.
- Hạ tầng test frontend mới: Vitest + jsdom + Testing Library. 34 test pass.

## Các vòng B4
1. Vòng 1: review báo `clearSelectItem` đóng nhầm drawer, chuỗi "bytes" hard-code, đóng drawer khi object ngoài trang đầu, flash dữ liệu cũ khi đổi item.
2. Vòng 2: sửa các lỗi trên. Review báo drawer đóng cả khi xoá thất bại, mở lại cùng key hiện dữ liệu cũ.
3. Vòng 3: sửa xong. Verify và review ĐẠT.

## Phần chưa làm / lưu ý
- **Luật 8 coverage C1 chưa đạt.** Baseline: Go 31,8% statement (`./internal/...`, `./models/...`), frontend 17,6% branch (34/49 file 0%). Chuyển sang sprint-04.
- Xoá folder thất bại một phần (`result=false`) thì drawer vẫn mở dù object đang xem có thể đã bị xoá.
- Thả file lên vùng drawer không upload (drop zone chỉ phủ danh sách).
- Card object chưa mở được bằng bàn phím (a11y).
- Timeout `HeadObject` 5 phút theo pattern `listObject`, có thể giảm.
- Chưa chạy app thật để xem giao diện.
- `frontend/coverage/` chưa được gitignore (`.gitignore` gốc chỉ có `/coverage`).
- Cần người dùng cập nhật `CLAUDE.md`: lệnh test (`bun run test`, `bun run test:coverage`, `go test ./...`), thêm Vitest/Testing Library vào Stack, sửa chỗ markdown hỏng ở dòng `reset()`gọi`invalidateLoads`.
