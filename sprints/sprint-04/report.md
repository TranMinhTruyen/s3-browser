# Báo cáo sprint-04

Ngày 2026-10-27. Kết quả: **R1 và R2 hoàn thành**. Coverage Go đạt 95,2% statement, frontend đạt 98,59% branch. Ngưỡng 95% được kiểm tra tự động. Không có file nào phải đưa vào exclude.

## Số liệu

Không tính các thay đổi còn chưa commit từ sprint-03 và các thay đổi người dùng tự làm (`CLAUDE.md`, `.claude/**`). Số dòng file test là con số ước lượng, đếm bằng `wc -l` trên các file chưa track.

| | File | Dòng |
|---|---|---|
| Go test mới (`*_test.go`, `scripts/checkcoverage`) | 16 | +2372 |
| Go test sửa | 5 | +216 / −1 |
| Frontend test (`src/test/**`, đã gồm helper chuyển chỗ) | 46 | +5145 |
| Cấu hình (`Taskfile.yml`, `frontend/package.json`, `frontend/vite.config.ts`) | 3 | +37 / −6 |

### File mới / sửa chính
- **Go:**
  - `_test.go` cho `internal/modules/{bucket,global,master,profile}`.
  - Script `scripts/checkcoverage/main.go` (+ `main_test.go`), thay cho script `.ps1` cũ.
  - Task `test:go:coverage` trong `Taskfile.yml`.
- **Frontend:**
  - Toàn bộ test nằm trong `src/test/<cây thư mục giống src>`. Helper `src/test/setup.ts` và `src/test/renderWithProviders.tsx` giữ nguyên chỗ.
  - Test của sprint-03 đã chuyển từ cạnh file nguồn sang `src/test/`.
  - `vite.config.ts`: `mockReset: true`; `coverage.thresholds` = 95 cho cả 4 chỉ số.

## R1: Go

- Phạm vi đo: `internal/modules/**`.
- **Coverage tổng: 95,2% (1443/1516 statement).** Cần ít nhất 1441 statement.
- Kiểm tra ngưỡng: `go run ./scripts/checkcoverage` hoặc `task test:go:coverage`. Lệnh fail khi tổng dưới 95%.
- `go build`, `go vet`, `golangci-lint` (0 issue), `go test ./...` đều pass.
- Không chạy được `go test -race` vì máy dùng `CGO_ENABLED=0`.
- Tận dụng các seam có sẵn, gồm `s3Header`, `getHeader`, `s3Deleter`, `statFile`, `httptest.Server`, SQLite in-memory.
- Test mở file explorer dùng fake opener, bật qua biến môi trường `S3BROWSER_TEST_INTERNAL_FAKE_OPENER_ARGS_FILE`.

### Phần chưa phủ (tính vào 5% được phép thiếu)

| File | Phần thiếu | Lý do |
|---|---|---|
| `submodule_downloader_mng.go` | 57,2% (91/159) | Code mở hộp thoại chọn thư mục của hệ điều hành. Không mock được nếu không sửa production. |
| `submodule_s3_upload.go:77-78` | Lỗi `os.Open` | Gây lỗi được nhưng phụ thuộc OS và quyền file, dễ flaky. |
| `submodule_uploader_mng.go:323` | Nhánh `WindowEvent` | Không tạo được context `WindowEvent` của Wails trong test. |

**Lưu ý:** script chỉ kiểm tra **tổng** 95%. Tính theo từng file thì `submodule_downloader_mng.go` không đạt 95%. Các file còn lại đều ≥ 97%.

## R2: Frontend

- Phạm vi đo: toàn bộ `frontend/src`, trừ file test, `src/test/**`, `*.d.ts`, json và `main.tsx`.
- 44 file test, 391 test, tất cả pass.
- biome, oxlint, tsc đều sạch. Mọi file test lưu LF.

### Coverage theo wave

| Mốc | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| Baseline | – | 17,6% | – | – |
| Hết F3 | 84,57% | 80,07% | 85,26% | 85,91% |
| **Hết F4** | **99,01%** | **98,59%** | **98,21%** | **99,35%** |

Ngưỡng ở `vite.config.ts` được nâng dần theo từng wave và chốt ở mức 95 tại F4.

### Nhánh chưa phủ (không xảy ra được qua UI, tính vào 5%)

| File (branch) | Dòng | Lý do |
|---|---|---|
| `TabDetail.tsx` (95,71%) | 77 | Nút Connect đã bị disable khi profile đang kết nối. |
| | 150 | Mọi breadcrumb đều có `data-prefix`. |
| | 178 | Ref luôn được gán khi đang ở view object. |
| `BucketListView.tsx` (95,23%) | 65 | `if (!nextCursor) return`. Effect đã chặn trước. |
| | 101 | `listRef.current?.offsetTop ?? 0`. Ref luôn được gán. |
| `ObjectListView.tsx` (96,15%) | 139 | Cùng trường hợp với `BucketListView` dòng 65. |
| | 226 | Không có kết nối thì danh sách rỗng, không có folder để xoá. |
| | 228 | Nút đang loading và menu đã đóng. |
| | 366 | Cùng trường hợp với `BucketListView` dòng 101. |
| `ObjectDetailDrawer.tsx` | 102 | Nút Retry chỉ hiện khi đã có item. |

## Thay đổi production (người dùng yêu cầu riêng, ngoài ràng buộc "không sửa production")

1. **Trả `Result=false` khi có lỗi.**
   - `submodule_connection_mng.go`: `testAction` và `connectAction` trả `Result=false` khi probe lỗi.
   - `submodule_object_mng.go`: `deleteObject` trả `Result=false` khi có ít nhất một object xoá lỗi. Mỗi key vẫn báo kết quả riêng: `S3S005` là xoá được, `S3E013` là lỗi.
   - `ObjectListView.tsx`: đóng drawer theo danh sách `S3S005`, cả khi kết quả thành công lẫn thất bại. Như vậy đã sửa điểm tồn đọng của sprint-03: trước đây drawer vẫn mở khi xoá thất bại một phần.
2. **Thêm `aria-label` cho các nút chỉ có icon.**
   - File sửa:
     - `HeaderButtonGroup`, `MainLayout`, `TabDetail`, `TabLayout`
     - `DownloaderWindow`, `UploaderWindow`, `DownloaderItem`, `UploaderItem`
     - `ObjectItem`
     - `Modal.CloseButton` của `ConfirmModal`, `ConnectModal`, `HistoryModal`, `UploadLimitModal`
   - Key i18n mới (en/vi/ja):
     - `common:button.close`
     - `tabLayout:tooltip.addTab`
     - `downloaderWindow` / `uploaderWindow`: `action.close`, `action.cancel`
     - `object:page.tooltip.moreActions`

## Các vòng B4

- **G1–G3 (Go):** ĐẠT. G3 kèm thay đổi `Result=false` ở trên.
- **F1:** 2 vòng. Test hồi quy cho bộ lọc `S3S005` chưa bắt được lỗi khi xoá bộ lọc. Đã viết lại bằng `it.each` và kiểm chứng bằng mutation test.
- **F2:** 1 vòng.
- **F3:** 2 vòng. Test chặn disconnect khi đang kết nối được viết lại, kiểm chứng bằng mutation test.
- **F4:** 2 vòng. Vòng 1: verify ĐẠT, review ĐẠT kèm 4 minor (assert yếu, import thừa, chọn nút theo thứ tự trong DOM, kiểu props của stub). Vòng 2: sửa xong 4 minor, đồng thời phủ thêm nhánh của `ObjectListView`.

## Phần chưa làm / lưu ý

- `DownloaderItem` đọc `item.total` mà không kiểm tra null. Rủi ro thấp vì store không xoá item đơn lẻ. Chưa sửa vì đây là code production.
- Combobox chọn profile trong `TabDetail` chưa có `aria-label`. Test đang tìm nó qua `aria-haspopup="listbox"`.
- `BucketListView.test` và `ObjectListView.test` mỗi file tự mock `@tanstack/react-virtual`, hai đoạn mock gần giống nhau. Chưa gộp thành helper `src/test/mockVirtual.ts` như plan đề xuất.
- `checkcoverage` chỉ kiểm tra tổng, chưa kiểm tra từng file.
- **Người dùng cần tự cập nhật** (agent bị chặn ghi):
  - `.gitignore`: thêm `frontend/coverage/`.
  - `CLAUDE.md`:
    - Thêm lệnh test: `bun run test`, `bun run test:coverage`, `go test ./...`, `go run ./scripts/checkcoverage` / `task test:go:coverage`.
    - Thêm Vitest và Testing Library vào Stack.
    - Ghi quy ước: test frontend đặt trong `src/test/<cây thư mục giống src>`, helper đặt ở `src/test/`, `globals: true`, ngưỡng 95.
    - Ghi chú không chạy 2 tiến trình vitest coverage song song.
    - Sửa chỗ markdown hỏng ở dòng `` `reset()`gọi`invalidateLoads` ``.
    - Có thể nhắc tới agent `go-tester` / `react-tester`.
