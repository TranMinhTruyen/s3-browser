---
name: new-sprint
description: Tạo thư mục sprint mới sprints/sprint-NN cho S3Browser từ sprints/_template/requirement.md, tự lấy số thứ tự kế tiếp và điền tiêu đề. Người dùng gọi bằng /new-sprint <tên sprint>.
argument-hint: <tên sprint>
disable-model-invocation: true
allowed-tools: Read, Glob, Write
---

# Tạo sprint mới

Tên sprint người dùng truyền vào: `$ARGUMENTS`

Mọi đường dẫn tính từ gốc repo. Skill này chỉ được tạo **một** file mới là `sprints/sprint-NN/requirement.md`. Không sửa file nào khác, không chạy lệnh git.

## Các bước

1. Nếu `$ARGUMENTS` trống, hỏi người dùng tên sprint rồi dừng, chờ trả lời.
2. Glob `sprints/sprint-*/` và chỉ tính các thư mục khớp đúng dạng `sprint-` + **2 chữ số** (bỏ qua `_template` và tên khác). Lấy số lớn nhất rồi cộng 1. Chưa có sprint nào thì dùng `01`. Luôn viết 2 chữ số (`01`, `09`, `10`). Nếu số vượt `99`, dừng và hỏi người dùng.
3. Nếu `sprints/sprint-NN/` đã tồn tại (ví dụ có thư mục trống), dừng và báo người dùng, **không ghi đè**.
4. Đọc `sprints/_template/requirement.md`. Không có file template thì dừng và báo lỗi, không tự viết mẫu khác.
5. Ghi `sprints/sprint-NN/requirement.md` với nội dung giống hệt template, **chỉ** thay dòng tiêu đề đầu tiên:
   - `# Sprint NN: <Tên sprint>` → `# Sprint NN: $ARGUMENTS` (NN là số vừa tính).
   Giữ nguyên mọi placeholder khác (`<Một đến hai câu...>`, `R1`, `R2`...). Không tự điền mục tiêu, yêu cầu hay tiêu chí chấp nhận, vì đó là phần người dùng viết.
6. Báo lại cho người dùng:

```markdown
Đã tạo `sprints/sprint-NN/requirement.md` (Sprint NN: <tên>).

Bước tiếp theo:
1. Viết yêu cầu vào file trên (có thể tách mỗi tính năng một file `.md` trong cùng thư mục).
2. Chạy `claude --agent orchestrator` ở gốc repo và gõ: `làm sprint-NN`.
```
