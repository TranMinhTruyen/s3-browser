S3Browser - Sprint 11: dựng môi trường test bằng Docker Compose
================================================================

Thư mục này dựng sẵn MinIO + LDAP và Floci (AWS giả lập) để test các phương thức đăng nhập.
Danh sách profile cần tạo trong app và kết quả mong đợi: ../test-profiles.txt.

Yêu cầu: Docker Desktop (hoặc Docker Engine + compose plugin). Không cần cài AWS CLI hay mc.


1. Nội dung
-----------

  docker-compose-minio.yml   MinIO + OpenLDAP + container init (PHẦN A của test-profiles.txt)
  docker-compose-floci.yml   Floci có bật kiểm tra quyền + container init (PHẦN B)
  ldap/s3browser.ldif        User và group LDAP, nạp khi OpenLDAP khởi động lần đầu
  scripts/minio-init.sh      Bật LDAP cho MinIO, gắn policy, tạo access key và bucket
  scripts/floci-init.sh      Tạo IAM user/role/policy, bucket và file profile AWS CLI
  generated/                 (sinh ra khi chạy Floci) floci-config, floci-credentials.
                             Đã nằm trong .gitignore, không commit.

Hai stack độc lập, chạy một hoặc cả hai đều được. Container init chạy một lần rồi dừng;
script chạy lại nhiều lần cũng không lỗi.


2. Dựng MinIO + LDAP
--------------------

Mở terminal trong thư mục này:

  docker compose -f docker-compose-minio.yml -p s3b-minio-test up -d
  docker logs -f s3b-test-minio-init      # chờ dòng "MinIO test environment is ready."

  Thành phần       Container            Cổng trên máy
  ---------------  -------------------  ------------------------------------------
  MinIO S3 API     s3b-test-minio       localhost:10010  <- Endpoint nhập vào app
  MinIO Console    s3b-test-minio       localhost:10011  (web, đăng nhập admin)
  OpenLDAP         s3b-test-openldap    localhost:10389

  Root MinIO: admin / MinioRoot#2026. Các tài khoản còn lại: test-profiles.txt mục 2.

  Lưu ý: lệnh ở test-profiles.txt PHẦN A dùng tên container minio_s3_browser_test.
  Với môi trường dựng bằng compose này thì thay bằng s3b-test-minio, và alias "local"
  trong container phải khai báo trước:
    docker exec s3b-test-minio mc alias set local http://127.0.0.1:10000 admin 'MinioRoot#2026'


3. Dựng Floci
-------------

  docker compose -f docker-compose-floci.yml -p s3b-floci-test up -d
  docker logs -f s3b-test-floci-init      # chờ dòng "Floci test environment is ready."

  Endpoint: http://localhost:4566, region ap-southeast-1. Key quản trị: test / test.

  Access key của các IAM user do Floci sinh ngẫu nhiên và được ghi vào generated/:
    generated/floci-config        profile floci-rw, floci-ro, floci-assumer, floci-role-rw, floci-role-ro
    generated/floci-credentials   access key / secret key

  Copy 2 file này vào thư mục ~/.aws của máy test (KHÔNG ghi đè config/credentials mặc định):
    Windows (PowerShell):
      Copy-Item generated\floci-config, generated\floci-credentials "$HOME\.aws\"
    macOS/Linux:
      mkdir -p ~/.aws && cp generated/floci-* ~/.aws/
  Sau đó tạo profile trong app theo test-profiles.txt mục 10.


4. Đổi cổng khi bị trùng
------------------------

Cổng mặc định có thể đổi bằng biến môi trường khi chạy `up`:

  MINIO_API_PORT (10010), MINIO_CONSOLE_PORT (10011), LDAP_PORT (10389), FLOCI_PORT (4566)

  PowerShell:  $env:FLOCI_PORT = "24566"; docker compose -f docker-compose-floci.yml -p s3b-floci-test up -d
  Bash:        FLOCI_PORT=24566 docker compose -f docker-compose-floci.yml -p s3b-floci-test up -d

Đổi FLOCI_PORT thì endpoint_url trong generated/floci-config cũng đổi theo. Nhớ dùng cổng
mới làm Endpoint trong app.


5. Chạy lại, dừng và xoá
------------------------

  Chạy lại bước cấu hình (ví dụ sau khi lỡ xoá bucket):
    docker start -a s3b-test-minio-init
    docker start -a s3b-test-floci-init

  Dừng nhưng giữ dữ liệu:
    docker compose -f docker-compose-minio.yml -p s3b-minio-test stop
    docker compose -f docker-compose-floci.yml -p s3b-floci-test stop

  Xoá hết (container, network, dữ liệu):
    docker compose -f docker-compose-minio.yml -p s3b-minio-test down -v
    docker compose -f docker-compose-floci.yml -p s3b-floci-test down -v
  Xoá thêm thư mục generated/ và 2 file ~/.aws/floci-* nếu đã copy. Lần dựng sau Floci sẽ
  sinh access key mới.


6. Xử lý sự cố
--------------

  - "port is already allocated": cổng đang bị dùng (ví dụ đã có Floci khác ở 4566).
    Đổi cổng theo mục 4, hoặc dừng container đang chiếm cổng.
  - Init dừng ở "LDAP is not reachable" hoặc "Floci is not reachable": xem log của
    s3b-test-openldap / s3b-test-floci, rồi chạy lại init theo mục 5.
  - App báo lỗi "... but have <html>": Endpoint đang trỏ vào cổng Console (10011),
    hãy dùng cổng S3 API (10010).
  - Đổi nội dung ldap/s3browser.ldif không có tác dụng: LDIF chỉ được nạp lần đầu. Chạy
    `down -v` rồi `up -d` lại.
