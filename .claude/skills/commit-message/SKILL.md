---
name: commit-message
description: Soạn commit message tiếng Anh theo Conventional Commits cho các thay đổi đã stage (git diff --cached) trong S3Browser. Chỉ soạn và in ra, không bao giờ chạy git commit hay git push. Người dùng gọi bằng /commit-message.
argument-hint: "[gợi ý thêm, ví dụ: scope hoặc mã sprint]"
disable-model-invocation: true
allowed-tools: Bash(git diff *), Bash(git status *), Bash(git log *), Read, Grep
---

# Soạn commit message

Gợi ý thêm từ người dùng (có thể trống): `$ARGUMENTS`

**Tuyệt đối không** chạy `git commit`, `git push`, `git add`, `git reset`, `git restore` hay lệnh nào thay đổi index, working tree hoặc lịch sử git. Skill chỉ đọc phần đã stage và in message ra cho người dùng tự commit.

## Các bước

1. Lấy phần đã stage:
   ```bash
   git diff --cached --stat
   git diff --cached
   ```
   Nếu không có gì được stage, báo "Chưa có thay đổi nào được stage, hãy `git add` trước" và dừng. Không tự `git add`.
2. Nếu có file chưa stage (`git status --porcelain`, cột thứ hai khác trống hoặc `??`), **không** đưa chúng vào message, nhưng nhắc người dùng một dòng rằng các file đó chưa được stage.
3. Xem vài commit gần nhất để giữ giọng văn và scope nhất quán:
   ```bash
   git log --oneline -15 -- .
   ```
4. Đọc diff đủ để hiểu **mục đích** thay đổi, không chỉ liệt kê file. Nếu có `sprints/sprint-NN/plan.md` hoặc `report.md` liên quan (hoặc người dùng nhắc tới sprint trong `$ARGUMENTS`), đọc để lấy ngữ cảnh.
5. Soạn message theo quy tắc bên dưới và in ra trong một code block.

## Quy tắc message

Toàn bộ message (tiêu đề và body) viết **tiếng Anh**, theo [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<body>

<footer>
```

- **type**: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `style`, `build`, `ci`, `chore`, `revert`.
- **scope** (tuỳ chọn nhưng nên có): tên module/khu vực bị ảnh hưởng, chữ thường, ví dụ `bucket`, `object`, `connection`, `profile`, `bindings`, `db`, `i18n`, `ui`, `agents`. Thay đổi trải dài nhiều khu vực thì chọn khu vực chính hoặc bỏ scope.
- **subject**: thể mệnh lệnh (`add`, `fix`, không phải `added`/`fixes`), chữ thường ở đầu, không dấu chấm cuối, tối đa 72 ký tự cho cả dòng tiêu đề.
- **body**: cách tiêu đề một dòng trống, ngắt dòng ở 72 ký tự. Giải thích **cái gì và tại sao**, không kể lại diff từng dòng. Dùng gạch đầu dòng `- ` khi có nhiều ý. Có thể nhắc riêng: bindings đã sinh lại, migration mới, message code mới, key i18n mới.
- **footer**: `BREAKING CHANGE: <mô tả>` nếu thay đổi signature binding, schema DB hoặc hành vi mà frontend/người dùng phải biết; thêm `!` sau type/scope (ví dụ `feat(bucket)!:`). Thêm `Refs: sprint-NN` nếu thay đổi thuộc một sprint.
- Nếu phần đã stage gồm nhiều thay đổi không liên quan, vẫn soạn một message nhưng **gợi ý người dùng tách commit** và liệt kê nhóm file nên tách.

## Kết quả trả về

Trả lời người dùng bằng tiếng Việt, message giữ tiếng Anh:

````markdown
Commit message cho N file đã stage (+X / -Y dòng):

```
feat(bucket): add folder upload with progress events

- Add UploadFolder handler and bucket module API
- Emit upload:progress events for each finished object
- Regenerate Wails bindings and add en/vi/ja keys for S3S012

Refs: sprint-03
```

(Ghi chú nếu có: file chưa stage, nên tách commit...)
````
