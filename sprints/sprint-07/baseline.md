# Baseline sprint 07a (Đợt 0, commit eb9064f, trước refactor)

| Kiểm tra | Kết quả | Thời gian |
| --- | --- | --- |
| `go build ./...` | PASS | 13s |
| `go vet ./...` | PASS | 5s |
| `go tool golangci-lint run ./...` | PASS, 0 issues | 7s |
| `biome check src` | PASS, 164 file | 1s |
| `oxlint src` | PASS, 0 cảnh báo | 1s |
| `tsc --noEmit` | PASS | 1s |
| vitest + coverage v8 | 48 file test, 580 test pass | 43s |

Coverage tổng: Statements 99.08%, Branches 98.64%, Functions 98.48%, Lines 99.47%. Không file production nào (có test import) dưới 95% branches/lines.

## Bundle (`bun run build`, frontend/dist/assets)

| File | Raw (byte) | Gzip (byte) |
| --- | --- | --- |
| index-*.js | 1,036,353 | 320,874 |
| index-*.css | 248,911 | 36,186 |
| TabLayout-*.js | 62,005 | 18,042 |
| TabLayout-*.css | 1,218 | 477 |
| **Tổng** | **1,348,487** | **375,579** |

Vite cảnh báo chunk > 500 kB.

## Dependency

- `redux`: 0 import trong `src`.
- `lodash`: 1 import (`common/utils/stringUtils.ts`: `isEmpty`, `isNil`).
- `uuid`: 1 import (`common/utils/stringUtils.ts`: `v7`).

## Thời gian list object theo page size

Script tạm (scratchpad, không nằm trong repo) gọi `ListObjectsV2` giống `listObject` của app: Delimiter `/`, `MaxKeys` = page size, đi hết theo `ContinuationToken`. Bucket `s3browser-bench`: 1.000 file ở gốc và 20 folder (1.020 mục ở gốc). Mỗi page size chạy 7 lần, lấy median.

| Page size | Số lần gọi | MinIO `minio_s3_browser_test`: trang đầu | MinIO: list hết | Floci `local-aws-floci-1`: trang đầu | Floci: list hết |
| --- | --- | --- | --- | --- | --- |
| 10 (hiện tại) | 102 | 81 ms | 5,96 s | 1,1 ms | 129 ms |
| 20 | 51 | 130 ms | 5,16 s | 1,1 ms | 73 ms |
| 30 | 34 | 157 ms | 4,86 s | 1,5 ms | 52 ms |
| 50 | 21 | 255 ms | 4,74 s | 1,3 ms | 34 ms |
| 100 | 11 | 462 ms | 4,48 s | 1,8 ms | 20 ms |

Nhận xét: trên MinIO (erasure 4 ổ mount từ ổ đĩa Windows), thời gian mỗi trang tăng gần tuyến tính theo số key. Page 50 làm trang đầu chậm hơn khoảng 3 lần nhưng list hết chỉ nhanh hơn khoảng 20%. Trên Floci, chi phí chủ yếu là số lần gọi, nên page lớn có lợi rõ.

Chưa đo: search, vì cách tìm kiếm không phụ thuộc `OBJECT_PAGE_SIZE`.

## Số đo sau từng đợt

| Sau đợt | Test | Bundle raw (byte) | Bundle gzip (byte) | Ghi chú |
| --- | --- | --- | --- | --- |
| Baseline | 580 | 1,348,487 | 375,579 | |
| F0 | 574 | 1,275,336 (-5.4%) | 349,745 (-6.9%) | Bỏ `lodash`, `uuid` khỏi `stringUtils.ts`; xoá test của code chết |
| F1 | 587 | 1,275,427 | 349,843 | Gom hook/component dùng chung; bundle gần như không đổi |
| F2 | 600 | 1,278,675 | 355,570 | Tách chunk `ConnectModal` (204,200 / 62,975) và `HistoryModal`; `index-*.js` còn 437,898 / 133,336. Tổng gzip tăng nhẹ do chia chunk. Chỉ tính js + css như baseline (bỏ favicon, font) |
| F3 | 665 | 1,280,865 | 357,939 | `TabDetail` hết import tĩnh `ConnectModal`: chunk này còn 112,152 / 33,963 (phần dùng chung tách ra `CheckBoxInput-*`, `ConfirmModal-*`); `index-*.js` 400,742 / 121,943. `OBJECT_PAGE_SIZE` = 20 |
| F4 | 680 | 1,280,102 | 357,841 | Gộp `FileRow`/danh sách virtualize của 2 modal upload vào `UploadFileList.tsx`; bundle gần như không đổi. Không còn file production nào dưới 95% (kể cả Functions) |
