# S3Browser — Quy ước dùng chung

File này được Claude Code tự động load cho session chính và mọi subagent. Đây là **nguồn quy ước duy nhất**: các file agent trong `.claude/agents/` và skill trong `.claude/skills/` không lặp lại nội dung ở đây. Khi convention trong code thay đổi, cập nhật file này trước.

> Mở `claude` ở thư mục gốc repo (hoặc thư mục con) thì file này, các agent và skill mới được load.

Bộ nhớ giữa các session (trạng thái sprint, quyết định, lỗi đã gặp) được import từ file dưới đây, quy tắc ở mục **10. Memory**:

@memory/MEMORY.md

## 1. Suy nghĩ trước khi code

**Đừng đưa ra các giả định. Đừng che giấu sự mơ hồ. Hãy làm rõ các đánh đổi.**
Trước khi bắt tay vào triển khai:

- Nêu rõ các giả định của bạn. Nếu không chắc chắn, hãy đặt câu hỏi.
- Nếu có nhiều cách hiểu khác nhau, hãy trình bày tất cả – đừng tự ý chọn một cách mà không trao đổi.
- Nếu có giải pháp đơn giản hơn, hãy đề xuất. Đừng ngần ngại phản biện khi cần thiết.
- Nếu có điều gì đó chưa rõ ràng, hãy dừng lại. Chỉ ra điểm gây khó hiểu và đặt câu hỏi.

## 2. Ưu tiên sự đơn giản

**Viết lượng code tối thiểu đủ để giải quyết vấn đề. Không thêm thắt những thứ mang tính dự đoán tương lai.**

- Không thêm tính năng ngoài phạm vi yêu cầu.
- Không tạo các lớp trừu tượng (abstraction) cho những đoạn code chỉ dùng một lần.
- Không thêm các tùy chọn "linh hoạt" hay "cấu hình" khi không được yêu cầu.
- Không viết code xử lý lỗi cho những tình huống không bao giờ xảy ra.
- Nếu bạn viết 200 dòng code trong khi chỉ cần 50 dòng là đủ, hãy viết lại.

Hãy tự hỏi: "Liệu một kỹ sư cấp cao có cho rằng cách làm này quá phức tạp không?" Nếu có, hãy đơn giản hóa nó.

## 3. Tổng quan

- App desktop viết bằng **Wails v3** (Go backend + React TS frontend) để duyệt và thao tác bucket/object trên **AWS S3** và **MinIO**.
- Repo: `TranMinhTruyen/s3-browser`, nhánh `staging` (phát triển) và `master` (release). Tách từ monorepo `TranMinhTruyen/kanban-board` (thư mục `App/S3Browser`) ngày 2026-11-03; số PR từ #33 trở về trước thuộc repo cũ.
- Go module tên `S3Browser`, Go 1.27. Wails `v3.1.0`, `@wailsio/runtime`.
- **Wails v3 đã stable**: luôn tra cứu https://v3.wails.io/ trước khi dùng API Wails, không dựa vào kiến thức có sẵn.

## 4. Luật bắt buộc

1. Luôn trả lời bằng **tiếng Việt**; giữ nguyên tên định danh trong code bằng tiếng Anh.
2. **Không bao giờ** chạy `git commit`, `git push`, `git switch`, `git reset`, `git checkout`, `git stash` hay lệnh nào thay đổi branch hoặc lịch sử git. **Ngoại lệ duy nhất**: agent `git-flow`, khi được `orchestrator` gọi trong quy trình sprint, được tạo `SP-NN/release` từ `origin/staging` khi bắt đầu sprint, tách feature `SP-NN/<slug>` từ `origin/SP-NN/release`, commit, rồi tự push feature và tạo PR vào `SP-NN/release`. Feature **không bao giờ** PR vào `staging`; chỉ `SP-NN/release` được PR vào `staging`, và chỉ khi người dùng báo sprint DONE và đồng ý. `master` là branch release: không agent nào được commit hay push vào `master`; code lên `master` chỉ qua PR `staging` → `master` do `git-flow` tạo (chế độ `master`) khi người dùng yêu cầu ra bản stable, người dùng tự merge. Trước đó `git-flow` (chế độ `stable`) được tạo `release/v<version>` từ `origin/staging` chỉ để đổi version và PR vào `staging`. Không agent nào được push thẳng vào `staging` hay `SP-NN/release`, force push hay merge PR. Ngoài quy trình sprint, khi được yêu cầu chỉ soạn commit message cho các thay đổi đã stage (`git diff --cached`) bằng skill `/commit-message`.
3. Không tự ý quyết định phần yêu cầu chưa rõ: ghi lại thành câu hỏi và chờ người dùng trả lời.
4. Không sửa tay code sinh tự động: `internal/pkg/db/sqlc/**`, `frontend/bindings/**`. Các đường dẫn này, cùng `.claude/**`, `CLAUDE.md`, `go.sum`, `.env*`, bị chặn ghi trong `.claude/settings.json`; chỉ được thay đổi qua lệnh sinh code tương ứng hoặc do người dùng tự sửa.
5. Chỉ format/lint frontend bằng **biome** và **oxlint**, không dùng prettier/eslint.
6. Gặp điểm chưa rõ giữa chừng thì **dừng task đó** và báo về, không tự đoán.
7. Nếu thay đổi làm lệch quy ước trong file này, báo cho người dùng để cập nhật `CLAUDE.md` (agent không tự sửa file này).
8. Luôn viết unit test cho frontend, yêu cầu coverage C1 ≥ 95% cho mỗi file đã đổi (xem mục **Testing**). Test do `react-tester` viết. Mọi function đã sửa, ở cả frontend lẫn backend, phải được **test hồi quy** để chắc không làm hỏng hành vi cũ hay sinh bug mới. Backend Go dùng unit test **tạm** do `go-tester` viết: chạy xong thì xoá, không bao giờ commit file `*_test.go`.
9. Luôn cố gắng tối ưu hiệu năng để tăng trải nghiệm người dùng.
10. Code đơn giản, súc tích, dễ hiểu đừng quá dài dòng có comment cho code rõ ràng để dễ maintain sau này.

## 5. Quy trình xử lý một task (B1–B5)

| Bước | Nội dung                                                                                                                                                                                                                                                                                                                                                          | Agent phụ trách                                                                                      |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| B1   | Phân tích yêu cầu, liệt kê câu hỏi chưa rõ                                                                                                                                                                                                                                                                                                                        | `planner`                                                                                            |
| B2   | Lập plan, chia task backend/frontend, liệt kê rủi ro                                                                                                                                                                                                                                                                                                              | `planner`                                                                                            |
| B3   | Hỏi người dùng có triển khai không; chưa được đồng ý thì dừng                                                                                                                                                                                                                                                                                                     | `orchestrator`                                                                                       |
| B3.5 | Tạo `SP-NN/release` từ `origin/staging` (push lên remote). Mỗi yêu cầu một branch `SP-NN/<slug>` tách từ `origin/SP-NN/release` khi tới lượt (trừ khi plan gộp), không chờ PR trước merge                                                                                                                                                                         | `git-flow`                                                                                           |
| B4   | Làm **lần lượt từng branch**. Trong mỗi branch, **tuần tự**: Go → skill `wails3-bindings` (`go tool wails3 generate bindings -clean=true -ts`) → Go test hồi quy (tạm, xoá sau khi chạy) → Frontend → FE test → verify → review. Lặp lại **tối đa 3 vòng**; quá 3 vòng thì dừng và hỏi người dùng. Đạt thì commit, push và tạo PR vào `SP-NN/release` (không hỏi) | `go-backend`, `go-tester`, `react-frontend`, `react-tester`, `verifier`, `code-reviewer`, `git-flow` |
| B5   | Báo cáo: số dòng thêm/xoá, file sửa, file mới, phần chưa làm được; cập nhật `memory/MEMORY.md`                                                                                                                                                                                                                                                                    | `orchestrator`                                                                                       |
| B6   | Người dùng merge PR feature, test trên `SP-NN/release` rồi báo DONE. Khi đó: hỏi người dùng version beta và sửa `build/config.yml`, branch `SP-NN/sprint_docs` (requirement, plan, report, memory, `build/config.yml`) PR vào `SP-NN/release`, và PR `SP-NN/release` → `staging` để ra bản beta (người dùng tự merge)                                                                                                                        | `orchestrator`, `git-flow`                                                                           |
- **Version** nằm ở `info.version` trong `build/config.yml`; workflow bỏ qua nếu tag `v<version>` đã có, nên mỗi lần ra bản phải đổi version và **luôn hỏi người dùng**, không tự đặt:
  - Beta (PR `SP-NN/release` → `staging`, B6): `n.n.n-beta.<số sprint>`, `n.n.n` do người dùng chọn, số sprint không có số 0 đứng đầu (sprint-07 → `beta.7`), ví dụ `0.1.0-beta.16`. Commit cùng `SP-NN/sprint_docs`.
  - Stable (PR `staging` → `master`, B7): `n.n.n` không hậu tố, ví dụ `1.0.0`, `1.0.1`. Commit trên `release/v<version>` tách từ `origin/staging`, PR vào `staging`; người dùng merge xong mới tạo PR `staging` → `master`.
  - Version mới phải lớn hơn version hiện tại và chưa có tag (`git ls-remote --tags origin v<version>` rỗng).
- B7 (ra bản stable, khi người dùng yêu cầu): chạy `claude --agent orchestrator` rồi gõ `ra bản stable`; orchestrator hỏi version, sửa `build/config.yml`, gọi `git-flow` chế độ `stable` rồi `master`.
- Yêu cầu lấy từ thư mục `sprints/sprint-NN/` (xem `sprints/README.md`), tạo bằng skill `/new-sprint <tên>`.
- Làm theo sprint: chạy `claude --agent orchestrator`. Orchestrator **không** phải agent mặc định.
- Sửa nhỏ: mở `claude` bình thường và gọi thẳng `go-backend` hoặc `react-frontend`.
- Viết bù test cho code cũ: mở `claude` bình thường và gọi thẳng `react-tester` kèm thư mục cần test (ví dụ `dùng react-tester viết test cho frontend/src/pages/bucket`).
- Kiểm hồi quy backend sau khi sửa nhỏ: gọi thẳng `go-tester` kèm file/function Go đã sửa (test tạm, tự xoá sau khi chạy).
- Không bao giờ chạy hai agent viết code song song.
- Tạo PR cần `gh` CLI đã cài và đăng nhập (`gh auth login`) trên máy.

## 6. Skill

Skill nằm trong `.claude/skills/<name>/SKILL.md` (bị chặn ghi, chỉ người dùng sửa).

| Skill             | Ai gọi                                                                                            | Việc làm                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `wails3-bindings` | Agent tự gọi. `go-backend` chạy cả phần sinh lẫn phần kiểm tra; `verifier` chỉ chạy phần kiểm tra | Sinh lại bindings TS, liệt kê binding thay đổi, tìm chỗ frontend import/gọi sai, chạy `tsc --noEmit` |
| `new-sprint`      | Chỉ người dùng: `/new-sprint <tên>`                                                               | Tạo `sprints/sprint-NN/requirement.md` từ `_template` với số NN kế tiếp                              |
| `commit-message`  | Chỉ người dùng: `/commit-message [gợi ý]`                                                         | Soạn message tiếng Anh theo Conventional Commits từ `git diff --cached`, không commit/push           |

## 7. Backend (Go)

### Cấu trúc

- `main.go` đăng ký các handler làm Wails service; `internal/app.go` khởi tạo module rồi truyền vào handler.
- Phân lớp: `internal/handlers/*_handler.go` (mỏng, chỉ gọi xuống module) → `internal/modules/<name>/module.go` (API public, có doc comment) → `submodule_<x>_mng.go`.
- Submodule: struct unexported `submoduleXxxMng`, constructor `newSubmoduleXxxMng`, method dạng `xxxAction` hoặc chữ thường.
- `internal/modules/global` giữ container kết nối dùng chung (map + `sync.RWMutex`, `S3Conn{Client, Presign, MinioAdmin, Transport}`). Các hàm `Remove*` trả về connection để bên gọi đóng **bên ngoài lock**.

### Output và message

- Mọi handler trả về `models.Output[T]` (`Result`, `MessageList`, `Body`). Tạo bằng `models.NewOutput[T]()`, dùng `output.AddMessage(...)`, `output.ThrowError(...)`.
- Lỗi luôn trả về bằng `return output.ThrowError(msg)` (đặt `Result=false` và thêm message); không tự gán `Result=false` rồi `AddMessage`. Cảnh báo dùng `cnst.MessageTypeWarn`, không dùng `MessageTypeError`.
- Message: `models.NewMessage` / `models.NewParamsMessage(cnst.MessageTypeX, cnst.<Module>, CODE, errorDetail, params)`.
- Mã message khai báo dạng `var` ở đầu `module.go`, comment là nội dung message. Format `<PREFIX><S|E|W><NNN>` (ví dụ `S3S001`, `S3E006`, `PFE001`, `MTE001`).
- Mỗi mã mới **phải có key** trong `frontend/src/locales/{en,vi,ja,zh-CN,zh-TW,ru,de}/messages/ipcMessage.json`.

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

### Xác thực và kết nối

- Phiên đăng nhập OIDC chỉ nằm trong RAM ở backend; frontend chỉ giữ `sessionId`, không bao giờ lưu token.
- URL lấy từ IdP (issuer, endpoint discovery) phải qua `utils.IsSecureUrl`: chỉ `https`, hoặc `http` với host loopback.
- `newHTTPClient` luôn đặt `TLSClientConfig` (ít nhất `&tls.Config{}`), vì minio-go ghi thẳng vào đó khi dùng mTLS.

### Database

- SQLite (modernc) + goose migration trong `internal/pkg/db/schemas/NNNNNN_name.sql`.
- sqlc: query trong `internal/pkg/db/queries/<domain>/<snake_name>.sql`, chú thích `-- name: PascalName :one|many|exec`, code sinh ra ở `internal/pkg/db/sqlc`.
- SQL viết kiểu dấu phẩy đứng đầu dòng (leading commas).

### Lệnh

Tất cả tool Go được khai báo trong `tool (...)` của `go.mod` (wails3, sqlc, golangci-lint), luôn gọi qua `go tool`, không cần cài riêng:

- Format/lint: `go tool golangci-lint run ./...` theo `.golangci.yml` (errcheck, govet, staticcheck, lll 120, goimports, golines 120).
- Kiểm tra: `go vet ./...`, `go build ./...` (chạy ở gốc repo).
- Sinh bindings: `go tool wails3 generate bindings -clean=true -ts` (chạy qua skill `wails3-bindings` để có luôn bước kiểm tra frontend).
- Sinh sqlc: `go tool sqlc generate`.
- Chạy dev: `go tool wails3 task dev`.

## 8. Rust native (DB client)

### Cấu trúc

- Thư viện `s3b_db.dll` (Cargo workspace ở `rust/`, `crate-type = ["cdylib"]`), chỉ build Windows `x86_64-pc-windows-msvc`. Do agent `rust-native` viết.
- Go load DLL **không dùng cgo** (`golang.org/x/sys/windows`, `CGO_ENABLED=0`), bằng đường dẫn tuyệt đối cạnh exe (`LOAD_LIBRARY_SEARCH_APPLICATION_DIR`). Lớp gọi DLL nằm trong `internal/modules/db`, do `go-backend` viết.
- Luồng: React → `callIPC` → binding Go → `modules/db` → `s3b_call` (JSON) → Rust. Frontend không biết Rust tồn tại.
- Phân lớp Rust: `ffi.rs` (chỉ hàm export) → `dispatch.rs` (theo `method`) → `drivers/<db>.rs`; kiểu JSON trong `protocol`.

### Hợp đồng FFI

- 4 hàm export: `s3b_init`, `s3b_call(req_ptr, req_len, out_ptr*, out_len*)`, `s3b_cancel(id)`, `s3b_free(ptr, len)`. Payload JSON, field camelCase.
- Mọi hàm export bọc `catch_unwind`; Cargo profile `panic = "unwind"`. Không `unwrap`/`expect` ngoài test.
- Buffer do Rust cấp chỉ giải phóng qua `s3b_free`; Rust không giữ con trỏ của Go sau khi hàm trả về.
- ctx Go bị huỷ → `s3b_cancel`; Rust trả mã `cancelled` → Go trả `Result=false` im lặng.
- Lỗi từ Rust có mã ổn định; Go map sang message code dạng `DBE<NNN>` trong `modules/db/module.go`, đủ key 7 ngôn ngữ trong `ipcMessage.json`.

### Driver

- PostgreSQL: `sqlx` (hoặc `tokio-postgres`); SQLite: `sqlx` với libsqlite3 bundled; MongoDB: `mongodb`. Runtime `tokio`.
- Mỗi tab một connection riêng; kết quả trả theo trang qua `cursorId`, không đọc cả kết quả vào RAM; export ghi thẳng ra file.
- Không log secret hay dữ liệu truy vấn. SQLite của app (profile, setting) vẫn ở Go `modernc.org/sqlite`.

### Lệnh (chạy trong `rust/`)

- Format: `cargo fmt --check`. Lint: `cargo clippy --target x86_64-pc-windows-msvc --all-targets -- -D warnings`.
- Build: `cargo build --release --target x86_64-pc-windows-msvc` (task `build:native` chạy trước build Go, copy DLL cạnh exe, vào bản portable và NSIS).
- Test: <chốt: không viết unit test như Go | `cargo test` cho protocol/dispatch>.

## 9. Frontend (React 19 + TS)

### Stack

Mantine 9, zustand 5 + immer qua `createAppStore(creator, name)`, NiceModal qua `createMantineModal`, i18next (en/vi/ja/zh-CN/zh-TW/ru/de), sonner (toast), `@tanstack/react-virtual`, lucide-react, zod, dayjs. Package manager: **bun**.

Alias: `@/` → `src`, `@components/`, `@common/`, `@wails/` → bindings.

### IPC

- Mọi lời gọi backend đi qua `callIPC(binding, args, {scope, signal, showMessage, resolveAction, rejectAction})` trong `frontend/src/common/utils/ipcUtils.ts`.
- `callIPC` trả về `body` hoặc `null`. Huỷ bằng `AbortController` signal.

### Store (zustand)

- Interface `State` + `Action`, hằng `SCOPE`.
- `set(..., undefined, \`${SCOPE}/actionName\`)`; `reset()`gọi`invalidateLoads(SCOPE)`.
- Selector hẹp hoặc `useShallow`; **không bao giờ** select nguyên object.

### Component

- Function component, `type XxxProps`, `export default`.
- Hàm xử lý event đặt tên `on` + sự kiện + đối tượng (ví dụ `onClickConnect`).
- **Mọi hàm** khai báo trong component phải bọc `useCallback`.
- Danh sách lớn phải virtualize.
- Component Mantine được bọc lại trong `components/buttons|inputs|modals`.
- Button: luôn dùng wrapper `components/buttons/Button` (không import thẳng `Button` từ `@mantine/core`). Wrapper tự co theo container, cắt chữ bằng ellipsis và hiện tooltip khi chữ bị cắt; không bọc thêm `Tooltip` chứa đúng label của nút, không ép width cố định.
- ActionIcon: luôn dùng wrapper `components/buttons/ActionIcon` (không import thẳng `ActionIcon` từ `@mantine/core`), bắt buộc truyền prop `tooltip` (chuỗi đã dịch); wrapper tự bọc `Tooltip` và đặt `aria-label`, không bọc thêm `Tooltip` bên ngoài. Nút luôn nằm trong một span `inline-flex`: margin props (`m`, `ml`, `mr`...) và `style` áp lên span, các prop khác (kể cả `className`, `ref`) áp lên nút; tooltip tự tắt khi `aria-expanded` (ví dụ nút là `Menu.Target` đang mở).
- Component mới luôn đặt trong folder con của `components/` (`buttons`, `inputs`, `modals`, `layouts`, `display`...), không để file thẳng trong `components/`. Component chỉ hiển thị (chữ, icon) vào `display/`. Không có folder phù hợp thì hỏi người dùng.
- Chữ một dòng có thể bị cắt: dùng `components/display/TruncatedText` (ellipsis, tooltip khi bị cắt, `label`/`alwaysTip` khi tooltip cần nội dung khác) thay cho `Text truncate`.
- Màu: dùng biến theme `var(--mantine-color-*)` và `light-dark(<light>, <dark>)` để hỗ trợ cả light/dark theme; không hard-code hex/rgb/tên màu (ngoại lệ: màu lưu như dữ liệu, ví dụ màu profile do user chọn; prop `color="red"` của nút Huỷ trong footer modal). Component variant `light` (Badge, Button...) truyền màu gốc `var(--mantine-color-<c>-6)`; biến `-light-color` chỉ dùng cho chữ/viền.
- **Console sạch**: code không được sinh warning hay error trong console của React (thiếu `key`, setState sau unmount, controlled/uncontrolled, DOM lồng sai, prop không hợp lệ truyền xuống DOM, i18next thiếu key, cảnh báo của Mantine...). Không để `console.log`/`console.warn`/`console.error` trong code production; lỗi cần báo cho người dùng thì đi qua `callIPC`/toast, cần ghi log thì đi qua backend.
- Modal: footer đặt nút Huỷ (`color="red"`) bên **trái**, các nút hành động (Reset, Apply, Save, OK, Upload, ...) bên **phải**, dùng `<Group p="8px" justify="space-between" wrap="nowrap">` để không nhảy layout khi đổi ngôn ngữ/font. Phần thân modal có form/nội dung chính thì bọc trong `<Paper withBorder>` giống `UploadPickerModal`.

### i18n

- Không hard-code chuỗi UI.
- Hỗ trợ **7 ngôn ngữ**: `en`, `vi`, `ja`, `zh-CN` (giản thể), `zh-TW` (phồn thể, từ vựng Đài Loan), `ru`, `de`. Danh sách ngôn ngữ nằm trong code (`LANGUAGES` ở `common/cnst/settingConst.ts` và `languages` ở `internal/modules/setting/submodule_setting_mng.go`), không đưa vào DB; ngôn ngữ đã chọn lưu trong `settings.json`.
- Namespace theo component/page trong `frontend/src/locales/<lang>/...`, đăng ký trong `resource.ts` của **cả 7 ngôn ngữ**. Mọi file JSON phải có đúng tập key và placeholder `{{x}}`/`{x}` như bản `en`.
- Thuật ngữ dịch theo AWS console đã bản địa hoá (ví dụ zh-TW: credentials/certificate → 憑證; ru: endpoint → «конечная точка»). "Path style" giữ nguyên tiếng Anh (trừ `ja`).
- Thêm ngôn ngữ mới: thêm mã vào cả 2 danh sách trên, tạo thư mục locale + `resource.ts`, thêm loader `import()` động vào `RESOURCE_LOADERS` trong `locales/i18n.ts` (chỉ `en` import tĩnh, ngôn ngữ khác nạp qua `loadLanguage` trước khi `changeLanguage`); ngôn ngữ CJK cần fallback font riêng trong `getFontFamily`.

### Lệnh (chạy trong `frontend/`)

- Format/check: Windows `node_modules/.bin/biome.exe check <paths>`, macOS/Linux `node_modules/.bin/biome check <paths>`. Không dùng `npx biome` (resolve nhầm sang package `biome@0.3.3`). File luôn lưu LF (theo `.gitattributes` và `biome.json`).
- Quy tắc format biome: (2 spaces, single quotes, semicolons, width 120, trailingCommas es5, arrowParens asNeeded, import groups).
- Lint: `npx oxlint <paths>` (theo `.oxlintrc.json`).
- Tìm code chết: Windows `node_modules/.bin/knip.exe`, macOS/Linux `node_modules/.bin/knip` (theo `knip.json`). Thêm `--production` để tìm export chỉ có test dùng; export vẫn được dùng trong chính file của nó và chỉ export cho test thì không coi là code chết.
- Type-check: Windows `node_modules/.bin/tsc.exe --noEmit`, macOS/Linux `node_modules/.bin/tsc --noEmit`. Không dùng `npx tsc` (không resolve được ở đây).

## 10. Testing

### Chung

- Ngưỡng (frontend): mỗi file production đã đổi trong sprint (hoặc trong phạm vi viết bù) đạt **C1 ≥ 95%**. Áp dụng cho cả file, kể cả code cũ trong file đó.
- Loại trừ: `frontend/src/test/**`, code sinh tự động (`frontend/bindings/**`), `frontend/src/main.tsx`, file locale, file chỉ khai báo type/hằng (`*.d.ts`).
- Test FE do `react-tester` viết, test Go do `go-tester` viết; tester chỉ sửa file test, agent code không sửa test của tester để cho qua. Nhánh không test được phải ghi rõ lý do.
- Unit test không gọi mạng hay Wails runtime thật (Go được dùng `httptest.Server` trên loopback để giả S3).

### Test hồi quy

- Phạm vi: mọi function đã sửa (không chỉ function mới) **và** nơi gọi tới nó. Tìm nơi gọi bằng `graphify query`/grep: Go từ submodule lên module, handler; FE từ util/store/hook lên component dùng nó.
- Test hồi quy assert **hành vi cũ vẫn đúng** (input cũ cho output cũ, nhánh lỗi cũ vẫn trả message cũ) cùng hành vi mới theo plan.
- Test cũ đang có bị fail là lỗi hồi quy: báo về agent code để sửa code, **không** sửa assert của test cũ để cho qua. Chỉ sửa test cũ khi plan đã duyệt chủ ý đổi hành vi đó, và phải ghi rõ trong báo cáo.

### Backend (Go, test tạm)

- Test Go chỉ để kiểm hồi quy trong lúc làm, **không commit**. `go-tester` tạo file tên `<file>_regression_test.go` cạnh file cần test (cùng package để test được hàm unexported), chạy rồi **xoá hết file đã tạo trước khi trả kết quả**. Working tree khi tới `verifier`, `code-reviewer`, `git-flow` không được còn file `*_test.go`.
- Chỉ dùng thư viện chuẩn (`testing`, `net/http/httptest`), table-driven, không thêm dependency, không sửa `go.mod`/`go.sum`.
- Chạy ở gốc repo: `go test -count=1 -race -cover ./internal/<package>/...` (bỏ `-race` nếu máy không có cgo). Không đặt ngưỡng coverage cho Go; báo lại % coverage của package đã chạy.

### Frontend

- vitest + Testing Library (agent kiểm tra nếu thiếu có thể hỏi người dùng để cài đặt các lib cần thiết không được phép tự ý cài đặt lib). File `Xxx.test.tsx` / `xxx.test.ts` đặt trong `frontend/src/test/` theo đúng cây thư mục của `frontend/src` (ví dụ `src/pages/bucket/BucketPage.tsx` → `src/test/pages/bucket/BucketPage.test.tsx`), import code qua alias `@/...`. Helper dùng chung (`renderWithProviders`, mock binding) trong `frontend/src/test/_helpers/`. `@wailsio/runtime` đã được mock toàn cục trong `frontend/src/test/setup.ts`, test chỉ override khi cần.
- Import `describe/it/expect/vi` từ `'vitest'`. Mock `@wails/...`, `callIPC` và `@wailsio/runtime` bằng `vi.mock`. Truy vấn DOM theo role/label/text. Không snapshot thay cho assert, không timer thật.
- Đo coverage (chạy trong `frontend/`; Windows dùng `node_modules/.bin/vitest.exe`, không dùng `npx vitest`):
  `node_modules/.bin/vitest run --coverage.enabled --coverage.provider=v8 --coverage.reporter=text --coverage.include=<file> --coverage.thresholds.branches=95 --coverage.thresholds.lines=95 --coverage.thresholds.perFile`
- Ngưỡng FE: **Branches (C1) ≥ 95%** và **Lines ≥ 95%** cho từng file.
- Hồi quy FE: ngoài test của file đã đổi, luôn chạy **toàn bộ** `vitest run`; test của file khác bị fail sau thay đổi là lỗi hồi quy.
- **Console sạch khi chạy test**: output của `vitest run` không được có warning/error từ React hoặc thư viện (`Warning: ...`, `act(...)`, `console.error`, `console.warn`, `stderr |`). Test cố ý đi vào nhánh có ghi lỗi thì phải `vi.spyOn(console, 'error').mockImplementation(() => {})` và assert spy đã được gọi đúng, không để lọt ra output.

## 11. Memory

- File `memory/MEMORY.md` lưu những gì session sau cần biết mà không suy ra được từ code: trạng thái sprint đang dở, quyết định đã chốt kèm lý do, lỗi và bẫy đã gặp. File được import ở đầu `CLAUDE.md` nên mọi session và subagent đều tự đọc.
- **Chỉ `orchestrator` ghi**, ở B5 của mỗi sprint (và khi sprint dừng giữa chừng), commit trên branch `SP-NN/sprint_docs` khi sprint DONE. Agent khác và session thường chỉ đọc; thấy điều cần nhớ thì ghi vào kết quả trả về để orchestrator đưa vào memory.
- Tối đa **250 dòng**. Vượt thì gộp các mục cũ nhất của mục 2 và 3 thành dòng ngắn ở mục 4 "Tóm tắt cũ" cho tới khi còn khoảng 220 dòng. Quyết định bị thay thế thì xoá dòng cũ, ghi dòng mới.
- Không ghi secret, access key, endpoint thật hay đường dẫn máy cá nhân. Không chép lại nội dung đã có trong `CLAUDE.md` hay `report.md`.
- Memory có thể lỗi thời: khi mâu thuẫn với code hoặc `CLAUDE.md` thì tin code và `CLAUDE.md`, rồi báo để sửa memory.

## 12. graphify

Project có knowledge graph ở `graphify-out/`, gồm các node trung tâm (god node), cấu trúc cụm (community) và quan hệ giữa các file.

Quy tắc:

- Khi đã có `graphify-out/graph.json`: với câu hỏi về codebase, chạy `graphify query "<câu hỏi>"` trước lần grep, tìm kiếm hay đọc file nguồn đầu tiên, và ghi quy tắc này vào prompt của mọi subagent có duyệt code. Chỉ đọc file gốc ở những dòng mà graph hoặc lần đọc trước đã chỉ ra. Dùng `graphify path "<A>" "<B>"` để xem quan hệ giữa hai thành phần và `graphify explain "<khái niệm>"` cho một khái niệm cụ thể. Các lệnh này trả về subgraph thu hẹp, thường nhỏ hơn nhiều so với `GRAPH_REPORT.md` hay output grep thô.
- Nếu có `graphify-out/wiki/index.md` thì dùng nó để định hướng tổng quát thay vì duyệt source thô.
- Chỉ đọc `graphify-out/GRAPH_REPORT.md` khi cần review kiến trúc tổng thể hoặc khi query/path/explain không cho đủ ngữ cảnh.
- Sau khi sửa code, chạy `graphify update .` để graph luôn mới (chỉ phân tích AST, không tốn phí API).
- `graphify-out/graph.json` đã commit bị ghi lại toàn bộ mỗi lần build, nên diff lớn ở file này trong PR là bình thường. Không coi đó là thay đổi thừa, không đề xuất bỏ bước build lại graph hay hook của nó.
