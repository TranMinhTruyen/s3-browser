# Hướng dẫn Codex cho repository

`CLAUDE.md` là nguồn hướng dẫn chuẩn cho kiến trúc, quy ước lập trình, kiểm thử, quy trình sprint, phạm vi thao tác Git và quy tắc ghi nhớ của repository. Hãy đọc file này trước khi sửa đổi hoặc rà soát mã nguồn. Nếu công việc phụ thuộc vào quyết định hoặc trạng thái của sprint trước, hãy tham khảo `memory/MEMORY.md`.

Skill của Codex nằm trong `.agents/skills/`; skill của Claude nằm trong `.claude/skills/`. Hai bộ được duy trì riêng vì có thể dùng công cụ, metadata và quy trình đặc thù của từng môi trường. Khi sửa skill, hãy cập nhật bộ tương ứng; không đồng bộ hoặc ghi đè nội dung giữa hai thư mục.

Các custom agent của Codex trong dự án nằm trong `.codex/agents/`; định nghĩa agent của Claude nằm trong `.claude/agents/`. Đây là các file riêng theo từng môi trường. File TOML của custom agent Codex chỉ cung cấp hướng dẫn, không tạo sandbox công cụ hay quyền riêng.

## Giới hạn Git và kết nối của Codex

- Codex không được commit, push, fetch, pull, clone hoặc truy cập repository qua `gh`, GitHub app hay MCP. Không thực hiện các thao tác này kể cả khi `CLAUDE.md` mô tả quy trình Git dành cho Claude.
- Codex chỉ được dùng các lệnh Git đọc trạng thái local như `git status`, `git diff` và `git log`. Khi tác vụ cần thao tác bị cấm, hãy để người dùng tự thực hiện.
- `.codex/config.toml` và `.codex/rules/default.rules` đặt giới hạn sandbox, mạng và lệnh cho Codex. Các cài đặt project-level chỉ được Codex nạp khi repository được đánh dấu trusted.
