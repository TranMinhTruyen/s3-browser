# Thư mục sprint

Mỗi sprint là một thư mục `sprint-NN` (NN là số thứ tự 2 chữ số). Agent `planner` đọc yêu cầu từ đây.

```
sprints/
├── README.md
├── _template/
│   └── requirement.md      mẫu viết yêu cầu, copy khi tạo sprint mới
└── sprint-01/
    ├── requirement.md      (người dùng viết) một hoặc nhiều file .md yêu cầu
    ├── upload-folder.md    (tuỳ chọn) có thể tách mỗi tính năng một file
    ├── plan.md             (planner sinh ra) phân tích, câu hỏi, task, rủi ro
    └── report.md           (orchestrator sinh ra) kết quả triển khai
```

## Cách dùng

1. Copy `_template/requirement.md` vào `sprints/sprint-NN/` và viết yêu cầu.
2. Mở terminal ở `App/S3Browser`, chạy `claude --agent orchestrator`. (Chạy `claude` không kèm `--agent` là session bình thường, dùng cho việc sửa nhỏ.)
3. Gõ: `làm sprint-NN`.
4. Trả lời câu hỏi chưa rõ (nếu có), duyệt plan, rồi chờ báo cáo trong `report.md`.

## Lưu ý

- Planner đọc mọi file `.md` trong thư mục sprint, trừ `plan.md` và `report.md`.
- Có thể sửa `requirement.md` rồi yêu cầu orchestrator lập lại plan.
- Không đặt file cấu hình hay secret (access key, endpoint thật) trong thư mục sprint.
- Môi trường test dùng chung (Docker Compose MinIO, LDAP, Floci, Keycloak, MinIO TLS) và danh sách profile/tài khoản test nằm ở `test-env/` (gốc `App/S3Browser`), xem `test-env/README.txt` và `test-env/test-profiles.txt`. Sprint mới cần thêm môi trường thì bổ sung vào đó, không tạo bản riêng trong thư mục sprint.
- Cuối mỗi sprint, orchestrator cập nhật `memory/MEMORY.md` (trạng thái, quyết định, lỗi đã gặp) để session sau tự nhớ. Nên merge PR của sprint trước rồi mới chạy sprint mới, nếu không memory của sprint trước chưa có trên `origin/master`.
