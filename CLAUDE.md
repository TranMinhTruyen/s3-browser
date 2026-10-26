# S3Browser — Quy ước dùng chung

File này được Claude Code tự động load cho session chính và mọi subagent. Đây là **nguồn quy ước duy nhất**: các file agent trong `.claude/agents/` không lặp lại nội dung ở đây. Khi convention trong code thay đổi, cập nhật file này trước.

> Mở `claude` trong thư mục `App/S3Browser` (hoặc thư mục con) thì file này mới được load, vì git root của repo là `kanban-board/`.

## 1. Tổng quan

- App desktop viết bằng **Wails v3** (Go backend + React TS frontend) để duyệt và thao tác bucket/object trên **AWS S3** và **MinIO**.
- Repo: `TranMinhTruyen/kanban-board`, thư mục `App/S3Browser`, nhánh `master`.
- Go module tên `S3Browser`, Go 1.27. Wails `v3.0.0-beta.34`, `@wailsio/runtime` beta.34.
- **Wails v3 còn beta, API thay đổi liên tục**: luôn tra cứu https://v3.wails.io/ trước khi dùng API Wails, không dựa vào kiến thức có sẵn.

## 2. Luật bắt buộc

1. Luôn trả lời bằng **tiếng Việt**; giữ nguyên tên định danh trong code bằng tiếng Anh.
2. **Không bao giờ** chạy `git commit`, `git push`, `git reset`, `git checkout`, `git stash` hay lệnh nào thay đổi lịch sử git. Khi được yêu cầu, chỉ soạn commit message cho các thay đổi đã stage (`git diff --cached`).
3. Không tự ý quyết định phần yêu cầu chưa rõ: ghi lại thành câu hỏi và chờ người dùng trả lời.
4. Không sửa tay code sinh tự động: `internal/pkg/db/sqlc/**`, `frontend/bindings/**`. Các đường dẫn này, cùng `.claude/**`, `CLAUDE.md`, `go.sum`, `.env*`, bị chặn ghi trong `.claude/settings.json`; chỉ được thay đổi qua lệnh sinh code tương ứng hoặc do người dùng tự sửa.
5. Chỉ format/lint frontend bằng **biome** và **oxlint**, không dùng prettier/eslint.
6. Gặp điểm chưa rõ giữa chừng thì **dừng task đó** và báo về, không tự đoán.
7. Nếu thay đổi làm lệch quy ước trong file này, báo cho người dùng để cập nhật `CLAUDE.md` (agent không tự sửa file này).

## 3. Quy trình xử lý một task (B1–B5)

| Bước | Nội dung | Agent phụ trách |
|---|---|---|
| B1 | Phân tích yêu cầu, liệt kê câu hỏi chưa rõ | `planner` |
| B2 | Lập plan, chia task backend/frontend, liệt kê rủi ro | `planner` |
| B3 | Hỏi người dùng có triển khai không; chưa được đồng ý thì dừng | `orchestrator` |
| B4 | **Tuần tự**: Go → `go tool wails3 generate bindings -clean=true -ts` → Frontend → verify → review. Lặp lại **tối đa 3 vòng**; quá 3 vòng thì dừng và hỏi người dùng | `go-backend`, `react-frontend`, `verifier`, `code-reviewer` |
| B5 | Báo cáo: số dòng thêm/xoá, file sửa, file mới, phần chưa làm được | `orchestrator` |

- Yêu cầu lấy từ thư mục `sprints/sprint-NN/` (xem `sprints/README.md`).
- Làm theo sprint: chạy `claude --agent orchestrator`. Orchestrator **không** phải agent mặc định.
- Sửa nhỏ: mở `claude` bình thường và gọi thẳng `go-backend` hoặc `react-frontend`.
- Không bao giờ chạy hai agent viết code song song.

## 4. Backend (Go)

### Cấu trúc
- `main.go` đăng ký các handler làm Wails service; `internal/app.go` khởi tạo module rồi truyền vào handler.
- Phân lớp: `internal/handlers/*_handler.go` (mỏng, chỉ gọi xuống module) → `internal/modules/<name>/module.go` (API public, có doc comment) → `submodule_<x>_mng.go`.
- Submodule: struct unexported `submoduleXxxMng`, constructor `newSubmoduleXxxMng`, method dạng `xxxAction` hoặc chữ thường.
- `internal/modules/global` giữ container kết nối dùng chung (map + `sync.RWMutex`, `S3Conn{Client, Presign, MinioAdmin, Transport}`). Các hàm `Remove*` trả về connection để bên gọi đóng **bên ngoài lock**.

### Output và message
- Mọi handler trả về `models.Output[T]` (`Result`, `MessageList`, `Body`). Tạo bằng `models.NewOutput[T]()`, dùng `output.AddMessage(...)`, `output.ThrowError(...)`.
- Message: `models.NewMessage` / `models.NewParamsMessage(cnst.MessageTypeX, cnst.<Module>, CODE, errorDetail, params)`.
- Mã message khai báo dạng `var` ở đầu `module.go`, comment là nội dung message. Format `<PREFIX><S|E|W><NNN>` (ví dụ `S3S001`, `S3E006`, `PFE001`, `MTE001`).
- Mỗi mã mới **phải có key** trong `frontend/src/locales/{en,vi,ja}/messages/ipcMessage.json`.

### Model
- `models/<domain>/<name>_input.go` | `<name>_output.go`, json tag dạng camelCase.
- Mọi model mới phải được re-export trong `models/alias.go`.

### Context, event, log
- Handler nhận `ctx` thì truyền Wails call ctx xuống. Submodule bọc `context.WithTimeout(ctx, …)` và `context.AfterFunc(m.app.Context(), cancel)`.
- Context bị huỷ thì trả `Result=false` im lặng (không hiện lỗi).
- Field optional của AWS đọc qua `aws.ToX`.
- Event: hằng trong `modules/<x>/events.go`, tên dạng `domain:kebab-name`, đăng ký bằng `application.RegisterEvent[T]` trong `init()`.
- Logger: `slog`, `logger.With("component"|"submodules", name)`, attribute dạng key-value.
- Concurrency dùng `errgroup` với `SetLimit`. Secret mã hoá qua `utils.KeyManager`.

### Database
- SQLite (modernc) + goose migration trong `internal/pkg/db/schemas/NNNNNN_name.sql`.
- sqlc: query trong `internal/pkg/db/queries/<domain>/<snake_name>.sql`, chú thích `-- name: PascalName :one|many|exec`, code sinh ra ở `internal/pkg/db/sqlc`.
- SQL viết kiểu dấu phẩy đứng đầu dòng (leading commas).

### Lệnh
Tất cả tool Go được khai báo trong `tool (...)` của `go.mod` (wails3, sqlc, golangci-lint), luôn gọi qua `go tool`, không cần cài riêng:
- Format/lint: `go tool golangci-lint run ./...` theo `.golangci.yml` (errcheck, govet, staticcheck, lll 120, goimports, golines 120).
- Kiểm tra: `go vet ./...`, `go build ./...` (chạy ở `App/S3Browser`).
- Sinh bindings: `go tool wails3 generate bindings -clean=true -ts`.
- Sinh sqlc: `go tool sqlc generate`.
- Chạy dev: `go tool wails3 task dev`.

## 5. Frontend (React 19 + TS)

### Stack
Mantine 9, zustand 5 + immer qua `createAppStore(creator, name)`, NiceModal qua `createMantineModal`, i18next (en/vi/ja), sonner (toast), `@tanstack/react-virtual`, lucide-react, zod, dayjs. Package manager: **bun**.

Alias: `@/` → `src`, `@components/`, `@common/`, `@wails/` → bindings.

### IPC
- Mọi lời gọi backend đi qua `callIPC(binding, args, {scope, signal, showMessage, resolveAction, rejectAction})` trong `frontend/src/common/utils/ipcUtils.ts`.
- `callIPC` trả về `body` hoặc `null`. Huỷ bằng `AbortController` signal.

### Store (zustand)
- Interface `State` + `Action`, hằng `SCOPE`.
- `set(..., undefined, \`${SCOPE}/actionName\`)`; `reset()` gọi `invalidateLoads(SCOPE)`.
- Selector hẹp hoặc `useShallow`; **không bao giờ** select nguyên object.

### Component
- Function component, `type XxxProps`, `export default`.
- Hàm xử lý event đặt tên `on` + sự kiện + đối tượng (ví dụ `onClickConnect`).
- **Mọi hàm** khai báo trong component phải bọc `useCallback`.
- Danh sách lớn phải virtualize.
- Component Mantine được bọc lại trong `components/buttons|inputs|modals`.

### i18n
- Không hard-code chuỗi UI.
- Namespace theo component/page trong `frontend/src/locales/<lang>/...`, đăng ký trong `resource.ts` của **cả 3 ngôn ngữ** (en, vi, ja).

### Lệnh (chạy trong `frontend/`)
- Format: biome (2 spaces, single quotes, semicolons, width 120, trailingCommas es5, arrowParens asNeeded, import groups).
- Lint: `npx oxlint <paths>` (theo `.oxlintrc.json`).
- Type-check: Windows `node_modules/.bin/tsc.exe --noEmit`, macOS/Linux `node_modules/.bin/tsc --noEmit`. Không dùng `npx tsc` (không resolve được ở đây).
