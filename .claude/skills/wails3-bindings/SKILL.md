---
name: wails3-bindings
description: Sinh lại Wails v3 bindings TypeScript cho S3Browser bằng `go tool wails3 generate bindings -clean=true -ts`, rồi kiểm tra frontend còn import và gọi binding đúng không. Dùng ngay sau khi sửa handler, model hay event Go, hoặc khi cần xác nhận frontend/bindings khớp với code Go.
allowed-tools: Bash(go tool wails3 generate bindings *), Bash(go build *), Bash(git status *), Bash(cp -r frontend/bindings *), Bash(rm -rf "${TMPDIR:-/tmp}/s3browser-bindings-before"), Bash(diff *), Bash(find *), Bash(node_modules/.bin/tsc *), Bash(node_modules/.bin/tsc.exe *), Read, Grep, Glob
---

# Sinh và kiểm tra Wails v3 bindings

Skill có hai phần. **Phần A** (sinh bindings) chỉ `go-backend` hoặc session chính được chạy. **Phần B** (kiểm tra) thì `verifier` cũng được chạy, nhưng **không được chạy Phần A**: nếu Phần B phát hiện bindings cũ, báo lại để `go-backend` sinh lại.

Mọi lệnh chạy ở thư mục `App/S3Browser` (trừ `tsc` chạy trong `frontend/`). Không bao giờ sửa tay `frontend/bindings/**`.

> `frontend/bindings` nằm trong `.gitignore`, nên **không dùng `git status`/`git diff` để xem binding thay đổi**: git không thấy thư mục này. Skill so sánh với bản chụp tạm (snapshot) trước khi sinh.

## Phần A: Sinh bindings

1. Đảm bảo code Go build được trước, vì generator cần parse được package:
   ```bash
   go build ./...
   ```
   Lỗi build thì dừng, sửa lỗi Go trước.
2. Chụp lại bindings hiện tại để so sánh sau (bỏ qua nếu `frontend/bindings` chưa tồn tại, khi đó mọi file sinh ra đều là "mới"):
   ```bash
   rm -rf "${TMPDIR:-/tmp}/s3browser-bindings-before"
   cp -r frontend/bindings "${TMPDIR:-/tmp}/s3browser-bindings-before"
   ```
3. Sinh bindings (luôn chạy, kể cả khi nghĩ signature không đổi):
   ```bash
   go tool wails3 generate bindings -clean=true -ts
   ```
   - `-ts`: sinh file `.ts`. `-clean=true`: xoá bindings cũ trước khi sinh, để binding của service/method đã xoá không còn sót lại.
   - Output: `frontend/bindings/S3Browser/<go package path>/<file>.ts`, frontend import qua alias `@wails/...` (ví dụ `@wails/S3Browser/internal/handlers/buckethandler`, `@wails/S3Browser/models/bucket`).
4. Nếu lệnh lỗi vì flag không còn hợp lệ (Wails v3 còn thay đổi), chạy `go tool wails3 generate bindings -help`, đối chiếu với https://v3.wails.io/reference/cli/ và báo lại cho người dùng flag đã đổi. **Không tự đổi sang flag khác** mà chưa báo, vì lệnh này được ghi trong `CLAUDE.md`.

## Phần B: Kiểm tra frontend còn khớp

1. **Binding thay đổi** (chỉ khi có snapshot từ Phần A):
   ```bash
   diff -rq "${TMPDIR:-/tmp}/s3browser-bindings-before" frontend/bindings
   ```
   Phân loại: `Only in frontend/bindings` là file **mới**, `Only in .../s3browser-bindings-before` là file **bị xoá**, `Files ... differ` là file **sửa**. Với file sửa, chạy `diff -u <snapshot>/<file> frontend/bindings/<file>` để biết hàm/model nào đổi tên, đổi tham số hay đổi kiểu trả về. Xong thì xoá snapshot bằng lệnh `rm -rf` ở Phần A bước 2.
   Không có snapshot (ví dụ `verifier` chạy riêng Phần B) thì bỏ qua bước này, ghi "không có snapshot".
2. **Import trỏ tới binding không tồn tại**: grep mọi đường dẫn `@wails/...` trong `frontend/src` (pattern `from '@wails/[^']+'`), rồi kiểm tra từng đường dẫn có file `frontend/bindings/<path>.ts` hoặc thư mục `frontend/bindings/<path>/` tương ứng (dùng Glob). Đường dẫn không có là lỗi.
3. **Type-check** toàn bộ frontend (chạy trong `frontend/`):
   - Windows: `node_modules/.bin/tsc.exe --noEmit`
   - macOS/Linux: `node_modules/.bin/tsc --noEmit`
   Không dùng `npx tsc`. Lỗi trong `bindings/` hoặc lỗi kiểu ở chỗ gọi binding là dấu hiệu Go và frontend lệch nhau.
4. **Bindings có thể đã cũ**: nếu `frontend/bindings` không tồn tại, hoặc có file Go trong `main.go`, `internal/handlers`, `internal/modules`, `models` mới hơn bindings, khả năng cao Phần A chưa được chạy:
   ```bash
   find main.go internal/handlers internal/modules models -name '*.go' -newer frontend/bindings
   ```
   Có kết quả thì ghi "bindings có thể đã cũ" và liệt kê file.

## Giới hạn

Phần B chỉ bắt được lỗi import và lỗi kiểu. Nó **không** bắt được thay đổi về ý nghĩa (ví dụ field cùng kiểu nhưng đổi nghĩa, message code mới chưa xử lý ở frontend). Phần đó vẫn do `code-reviewer` kiểm tra.

## Kết quả trả về

```markdown
## Wails bindings
- Lệnh sinh: `go tool wails3 generate bindings -clean=true -ts`: THÀNH CÔNG | LỖI | KHÔNG CHẠY (chỉ kiểm tra)
- tsc --noEmit: PASS | FAIL | BỎ QUA (lý do)
- Bindings cũ: KHÔNG | CÓ THỂ (danh sách file Go mới hơn)

### Binding thay đổi
| File | Loại (mới/xoá/sửa) | Hàm / model thay đổi |
|---|---|---|

### Chỗ frontend cần sửa
- [file.tsx:42](frontend/src/.../file.tsx#L42): nguyên văn lỗi tsc hoặc import tới binding đã mất. Agent nên sửa: react-frontend | go-backend
```

Không có thay đổi và tsc PASS thì ghi ngắn: "Bindings khớp, frontend không cần sửa."
