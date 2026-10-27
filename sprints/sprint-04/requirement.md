# Sprint 04: Unit test đạt coverage C1 > 95%

## Mục tiêu
Áp dụng luật 8 trong `CLAUDE.md`: viết unit test cho backend Go và frontend sao cho coverage C1 (branch) vượt 95%, và chặn tự động khi coverage tụt dưới ngưỡng.

## Yêu cầu

### R1: Unit test backend Go
- **Mô tả:** Viết unit test cho các file module và submodule trong `internal/modules/**` (`module.go`, `modules.go`, `submodule_*.go` và các file logic đi kèm như `uploader_expand.go`).
- **Nền tảng:** Cả hai (AWS S3 và MinIO)
- **Màn hình liên quan:** Không có (backend)
- **Tiêu chí chấp nhận:**
  - [ ] Coverage của phạm vi trên > 95%. Go không có công cụ đo branch nên đo statement bằng `go test -coverprofile`, kèm rà tay để mỗi nhánh `if`/`switch` có ít nhất một test case.
  - [ ] Có script/lệnh kiểm tra ngưỡng 95%, fail khi tụt dưới ngưỡng.
  - [ ] `go build`, `go vet`, golangci-lint, `go test ./...` đều pass.

### R2: Unit test frontend
- **Mô tả:** Viết unit test bằng Vitest + Testing Library (hạ tầng đã có từ sprint-03, đo bằng `@vitest/coverage-v8`, lệnh `bun run test:coverage`).
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** Toàn bộ `frontend/src`
- **Tiêu chí chấp nhận:**
  - [ ] Branch coverage > 95%.
  - [ ] Đặt `coverage.thresholds` 95% trong `vite.config.ts` (fail khi tụt dưới ngưỡng).
  - [ ] biome, oxlint, tsc, vitest đều pass.

## Ngoài phạm vi
- Code sinh tự động: `internal/pkg/db/sqlc/**`, `frontend/bindings/**`.
- Go ngoài module/submodule: `main.go`, `internal/app.go`, `internal/handlers/**`, `internal/pkg/**`, `models/**`.
- Test e2e, test chạy với S3/MinIO thật.

## Ràng buộc / ghi chú
- **Không sửa code production.** Production đang chạy được, giữ nguyên. Ưu tiên mock data: dùng các seam đã có (ví dụ `s3Header`, `getHeader`, `s3Deleter`), `httptest.Server` giả lập endpoint S3/MinIO, SQLite in-memory, mock module bằng `vi.mock` ở frontend. Chỉ được thêm file `_test.go`, `*.test.ts(x)`, helper test, và cấu hình test/coverage.
- **Quy tắc loại trừ:** file nào thử viết test **quá 3 lần** mà vẫn không đạt ngưỡng (thường do không mock được nếu không sửa production) thì đưa vào danh sách exclude của coverage, kèm lý do ghi trong `report.md`.
- Baseline đo ngày 2026-10-27: Go 31,8% statement (`./internal/...`, `./models/...`), frontend 17,6% branch (49 file, 34 file 0%).

## Câu hỏi đã biết
- ~~Phạm vi frontend~~ — **Đã chốt:** toàn bộ `frontend/src` (store, utils, hooks, components, pages), trừ code sinh tự động.
- Có loại trừ các file chỉ khai báo (ví dụ `events.go`, `commonConst.ts`, `vite-env.d.ts`) ngay từ đầu không?
- Cách chia task: sprint lớn, có nên chia nhiều đợt (Go trước, frontend sau) để không vượt giới hạn 3 vòng B4?
