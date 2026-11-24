S3Browser - môi trường test dùng chung (dựng ở sprint-11), dựng bằng Docker Compose
=====================================================================================

Thư mục này dựng sẵn MinIO + LDAP, Floci (AWS giả lập), Keycloak và MinIO bật TLS (OIDC, mTLS) để test
các phương thức đăng nhập.
Danh sách profile cần tạo trong app và kết quả mong đợi: test-profiles.txt.

Yêu cầu: Docker Desktop (hoặc Docker Engine + compose plugin). Không cần cài AWS CLI hay mc.


1. Nội dung
-----------

  docker-compose-minio.yml   MinIO + OpenLDAP + container init (test-profiles.txt mục 1)
  docker-compose-floci.yml   Floci có bật kiểm tra quyền + container init (test-profiles.txt mục 2)
  ldap/s3browser.ldif        User và group LDAP, nạp khi OpenLDAP khởi động lần đầu
  scripts/minio-init.sh      Bật LDAP cho MinIO, gắn policy, tạo access key và bucket
  scripts/floci-init.sh      Tạo IAM user/role/policy, bucket và file profile AWS CLI
  docker-compose-keycloak.yml    Keycloak (http, localhost) cho OIDC (test-profiles.txt mục 3)
  docker-compose-minio-tls.yml    MinIO bật TLS + identity_openid + identity_tls (test-profiles.txt mục 3)
  keycloak/s3browser-realm.json   Realm s3browser: client public s3browser (PKCE), user mẫu, claim policy
  scripts/gen-certs.sh            Sinh CA, cert server và cert client vào certs/ (cần openssl)
  scripts/minio-tls-init.sh       Tạo bucket s3b-tls cho MinIO TLS
  docker-compose-db.yml           6 DB cho driver Rust: MySQL, MariaDB, PostgreSQL, SQL Server, MongoDB, Redis (mục 10)
  db/db.env                       Cổng, user, mật khẩu test của 6 DB (dùng chung cho compose, test, bench)
  db/mssql.conf                   Bật TLS tuỳ chọn cho SQL Server
  certs/                          (sinh ra bởi gen-certs.sh) Đã nằm trong .gitignore, không commit.
  generated/                 (sinh ra khi chạy Floci) floci-config, floci-credentials.
                             Đã nằm trong .gitignore, không commit.

Các stack độc lập, chạy stack nào cũng được (riêng MinIO TLS cần Keycloak chạy trước, mục 7). Container init chạy một lần rồi dừng;
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

  Root MinIO: admin / MinioRoot#2026. Các tài khoản còn lại: test-profiles.txt mục 1.


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
  Sau đó tạo profile trong app theo test-profiles.txt mục 2.


4. Đổi cổng khi bị trùng
------------------------

Cổng mặc định có thể đổi bằng biến môi trường khi chạy `up`:

  MINIO_API_PORT (10010), MINIO_CONSOLE_PORT (10011), LDAP_PORT (10389), FLOCI_PORT (4566),
  KEYCLOAK_PORT (8180), MINIO_TLS_API_PORT (10020), MINIO_TLS_CONSOLE_PORT (10021)
  DB (mục 10): MYSQL_PORT (10030), MARIADB_PORT (10031), POSTGRES_PORT (10032), MSSQL_PORT (10033),
  MONGO_PORT (10034), REDIS_PORT (10035), REDIS_TLS_PORT (10036) - đặt trong db/db.env.
  Đổi KEYCLOAK_PORT thì Issuer URL trong app đổi theo (http://localhost:<port>/realms/s3browser).

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


7. Dựng MinIO TLS, Keycloak (OIDC) và mTLS
------------------------------------------

Chạy trong thư mục này, theo đúng thứ tự.

  (a) Sinh chứng chỉ vào certs/ (Git Bash trên Windows, hoặc terminal macOS/Linux, cần openssl):
        sh scripts/gen-certs.sh
      Kết quả: certs/ca.pem (CA tự ký, chọn làm "CA certificate file"), certs/client/client.crt,
      client.key (không mật khẩu, PKCS#8), client-enc.key (PKCS#8 có mật khẩu), client-legacy.key (PEM
      mã hoá kiểu cũ, app phải từ chối). Mật khẩu của hai key mã hoá: ClientKey#2026.
      CN của cert client là "readwrite": MinIO lấy CN làm tên policy.

  (b) Keycloak (chờ vài chục giây đến khi mở được http://localhost:8180/realms/s3browser):
        docker compose -f docker-compose-keycloak.yml -p s3b-keycloak-test up -d

  (c) MinIO TLS:
        docker compose -f docker-compose-minio-tls.yml -p s3b-minio-tls-test up -d
        docker logs -f s3b-test-minio-tls-init     # chờ "MinIO TLS test environment is ready."

      Nếu MinIO khởi động khi Keycloak chưa sẵn sàng thì nó báo "Unable to initialize OpenID" và chờ:
      chạy `docker restart s3b-test-minio-tls` sau khi Keycloak đã chạy.

  Thành phần       Container            Địa chỉ trên máy
  ---------------  -------------------  ------------------------------------------
  MinIO TLS        s3b-test-minio-tls   https://localhost:10020  <- Endpoint nhập vào app
  MinIO Console    s3b-test-minio-tls   https://localhost:10021
  Keycloak         s3b-test-keycloak    http://localhost:8180

  Tài khoản (chỉ để test):
    MinIO root         admin / MinioRoot#2026
    Keycloak admin     admin / KeycloakAdmin#2026
    Keycloak user      oidc-user / OidcUser#2026   (realm s3browser)

  Cấu hình OIDC trong app: Issuer URL = http://localhost:8180/realms/s3browser, Client ID = s3browser,
  Callback port = 48765 (redirect http://127.0.0.1:48765/callback đã khai báo trong realm). Keycloak chạy
  http vì app không áp CA cho IdP. Claim "policy" luôn là readwrite (hardcoded claim mapper).

  Profile cần tạo và kết quả mong đợi: test-profiles.txt mục 3.

  Đã kiểm khi viết: Keycloak lên, MinIO nạp được identity_openid, và app kết nối mTLS thành công với
  client.crt + client.key / client-enc.key + CA. Luồng OIDC đầy đủ (cần trình duyệt) chưa được kiểm.


8. Dừng và xoá MinIO TLS, Keycloak
----------------------------------

    docker compose -f docker-compose-minio-tls.yml -p s3b-minio-tls-test down -v
    docker compose -f docker-compose-keycloak.yml -p s3b-keycloak-test down -v
    rm -rf certs        # PowerShell: Remove-Item -Recurse certs


9. Xử lý sự cố
--------------

  - "port is already allocated": cổng đang bị dùng (ví dụ đã có Floci khác ở 4566).
    Đổi cổng theo mục 4, hoặc dừng container đang chiếm cổng.
  - Init dừng ở "LDAP is not reachable" hoặc "Floci is not reachable": xem log của
    s3b-test-openldap / s3b-test-floci, rồi chạy lại init theo mục 5.
  - App báo lỗi "... but have <html>": Endpoint đang trỏ vào cổng Console (10011),
    hãy dùng cổng S3 API (10010).
  - Đổi nội dung ldap/s3browser.ldif không có tác dụng: LDIF chỉ được nạp lần đầu. Chạy
    `down -v` rồi `up -d` lại.


10. Dựng 6 DB cho driver Rust (MySQL, MariaDB, PostgreSQL, SQL Server, MongoDB, Redis)
--------------------------------------------------------------------------------------

Dùng cho test tích hợp và bài đo hiệu năng của driver Rust (rust/). Image ghim tag patch để số đo lặp lại được:
mysql:8.4.13, mariadb:11.4.13, postgres:17.12, mssql/server:2022-CU28-ubuntu-22.04, mongo:8.0.38, redis:7.4.12.

  (a) Sinh chứng chỉ (Git Bash, cần openssl). Cert server dùng chung nằm ở certs/db/ (SAN: localhost, 127.0.0.1,
      ::1, tên service), CA là certs/ca.pem:
        sh scripts/gen-certs.sh
      Chạy lại script sinh CA mới và xoá certs/: container đang chạy giữ file cũ, phải tạo lại bằng
      `up -d --wait --force-recreate` (và MinIO TLS cũng vậy nếu đang chạy).

  (b) Dựng (chạy trong thư mục này; lần đầu kéo ~6 GB image, mất vài phút):
        docker compose -f docker-compose-db.yml --env-file db/db.env -p s3b-db-test up -d --wait
      Chỉ một DB: thêm tên service ở cuối (mysql, mariadb, postgres, mssql, mongo, redis).

  (c) Dừng giữ dữ liệu / xoá hết (named volume):
        docker compose -f docker-compose-db.yml --env-file db/db.env -p s3b-db-test stop
        docker compose -f docker-compose-db.yml --env-file db/db.env -p s3b-db-test down -v

  Các cổng DB chỉ mở trên loopback (127.0.0.1), máy khác trong mạng không kết nối được.

  DB          Container           Cổng máy   Tài khoản (mật khẩu chung DB_PASSWORD trong db/db.env)
  ----------  ------------------  ---------  -----------------------------------------------------
  MySQL       s3b-test-mysql      10030      root, database s3b
  MariaDB     s3b-test-mariadb    10031      root, database s3b
  PostgreSQL  s3b-test-postgres   10032      postgres, database s3b
  SQL Server  s3b-test-mssql      10033      sa (tạo database khi cần)
  MongoDB     s3b-test-mongo      10034      root, authSource admin
  Redis       s3b-test-redis      10035      chỉ mật khẩu (requirepass), DEBUG command bật
  Redis TLS   s3b-test-redis      10036      cổng TLS, cùng mật khẩu

  TLS bật tuỳ chọn trên cả 6 DB: client không TLS vẫn nối được, client TLS kiểm bằng certs/ca.pem
  (hostname localhost hoặc 127.0.0.1). PostgreSQL copy key vào container và chmod 0600 khi khởi động;
  SQL Server dùng cert qua db/mssql.conf (forceencryption=0); MongoDB `allowTLS` không đòi cert client;
  Redis chạy cổng thường 6379 và cổng TLS 6380 song song.

  Yêu cầu: SQL Server cần >= 2 GB RAM trống cho Docker (đã giới hạn MSSQL_MEMORY_LIMIT_MB=2048, thực đo ~0,7 GB
  khi rảnh); image chỉ có x86_64. Cả 6 DB rảnh dùng khoảng 1,4 GB RAM.

  Test Rust (trong rust/): sau khi (a)+(b), `cargo test --target x86_64-pc-windows-msvc` tự nối vào các cổng trên;
  DB không chạy hoặc chưa sinh cert thì test in `SKIP ...` rồi bỏ qua.

  (d) Chạy lại bài đo hiệu năng (PowerShell, trong thư mục này; bản release, không chạy dưới debugger, không chạy
      cùng lúc với cargo test):
        .\db-bench.ps1
      Script tự `docker compose up -d --wait` các DB cần, build DLL release, chạy rust/examples/db_bench (feature
      bench-timing) rồi in đường dẫn db/report/db_bench_<ngày>_<giờ>.xlsx (thư mục report đã gitignore). Sheet Summary
      có SQLite + 6 DB x 1.000/10.000/100.000 dòng (min/trung vị/p95/max của elapsedMs và callMs, trung vị từng pha,
      đạt < 40 ms / nhắm < 20 ms cho 10.000 dòng), sheet Runs có mọi lần đo, sheet Env có máy, phiên bản DB/crate/image.
      Mất vài phút (nạp tới 100.000 dòng mỗi DB). Dữ liệu bench (bảng/collection/list tiền tố s3b_bench_) tự dọn sau khi đo.
      Rút gọn: -Dbs sqlite,postgres  -Rows 10000  -Runs 5  -Warmup 1  -NoDocker (DB đã chạy sẵn).
      DB nào không tới được thì ghi SKIP trong báo cáo, bài đo vẫn ra file.
      Lưu ý: Docker Desktop (WSL2) có sàn mạng ~24 ms cho 2,5 MB, nên mục tiêu 40 ms chỉ công bằng cho DB cài trực
      tiếp trên máy host; số đo qua Docker dùng để so sánh các driver với nhau và theo dõi hồi quy.

  Thử tay trong container (ví dụ):
    docker exec -e PGPASSWORD=S3bTest2026 s3b-test-postgres psql "host=localhost user=postgres dbname=s3b sslmode=verify-full sslrootcert=/certs/ca.pem"
    docker exec s3b-test-redis redis-cli -p 6380 --tls --cacert /certs/ca.pem --sni localhost ping


11. Đo RAM (mem-bench.ps1)
--------------------------

Đo Private Working Set của cả cây process (app Go + msedgewebview2.exe), tách Go runtime/heap (probe), DLL Rust,
WebView2 và JS heap, theo kịch bản a-f và i1-i4 (sprints/sprint-20/plan.md). Kết quả ghi vào mem/report/<ngày>_<giờ>/
(đã gitignore): summary.md, samples.csv, timings.csv, probe-*.jsonl.

Một lệnh, chạy từ đầu tới cuối (ở gốc repo, cần Docker Desktop đang chạy và không có S3Browser.exe nào đang mở):

  powershell -ExecutionPolicy Bypass -File test-env/mem-bench-all.ps1 -Runs 3

  Script làm lần lượt: kiểm Docker -> bật MinIO (docker compose -f docker-compose-minio.yml -p s3b-minio-test up -d,
  chờ healthy) -> lấy khoá admin từ container vào env S3B_BENCH_* của process script (không in, không ghi file;
  đã đặt sẵn env thì giữ nguyên) -> tạo bucket s3b-mem-10k đủ 10.000 object -> build bản release và bản đo (devtools,
  kiểm tag) -> mem-bench.ps1 -> dọn prefix a*-g* trong bucket. Lỗi một bước ghi FAIL rồi chạy tiếp bước độc lập;
  exit code 1 nếu có FAIL. Tham số: -Runs (mặc định 3), -Scenario (a-f, i4, all; mặc định all), -OutDir (mặc định
  test-env/mem/report/<ngày>_<giờ>), -SkipBuild (dùng bản build sẵn). Chỉ cần đọc <OutDir>/summary.md; cuối lệnh in
  đường dẫn summary.md, samples.csv, timings.csv và danh sách FAIL. Các bước (a)-(d) dưới đây là cách làm từng bước tay.

Từng bước tay, chạy trong thư mục này:

  (a) Build hai bản (ở gốc repo; tắt app đang chạy trước):
        go tool wails3 task windows:build
        go tool wails3 task windows:build EXTRA_TAGS=devtools OUT_DIR=build/bin/bench
      Bản đầu (build/bin/S3Browser.exe) là bản release thuần; bản sau (build/bin/bench/S3Browser.exe) có tag devtools,
      cần cho cổng CDP của kịch bản b-f.
      Cổng CDP do script mở bằng env `S3B_BENCH_CDP_PORT` (chỉ bản đo đọc, qua `Options.Windows.AdditionalBrowserArgs`,
      file `main_devtools.go`); bản release bỏ qua env này. `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` không dùng được vì
      Wails xoá nó trong process app.
      Cách truyền biến KEY=value qua `wails3 task` chưa kiểm chứng; không được thì
      chạy `task` trực tiếp hoặc đặt biến môi trường EXTRA_TAGS và OUT_DIR.
  (b) Cài thư viện cho script UI (một lần): `bun install --cwd docs` (playwright đã có trong docs/package.json).
  (c) Dữ liệu cho b, c, e-s3: chạy MinIO (mục 1/docker-compose-minio.yml), rồi
        $env:S3B_BENCH_ACCESS_KEY='admin'; $env:S3B_BENCH_SECRET_KEY='<mật khẩu admin của docker-compose-minio.yml>'
        $env:S3B_BENCH_ENDPOINT='http://localhost:10010'      # mặc định
        .\mem-bench.ps1 -PrepareData
      tạo bucket s3b-mem-10k với 10.000 object (obj-00001.bin ... obj-10000.bin). Kịch bản d không cần MinIO (SQLite).
      Secret của MinIO test-env không được chứa dấu cách hay ký tự glob (*, ?, [): script trong container không bọc nháy
      (PowerShell 5.1 nuốt dấu nháy kép trong đối số lệnh native).
  (d) Chạy đo (không mở S3Browser khác, không chạy dưới debugger, máy rảnh):
        .\mem-bench.ps1 -Scenario a -Runs 1 -NoCdp      # chỉ a-release, không cần node/MinIO (cũng là việc CI làm)
        .\mem-bench.ps1 -Scenario d -Runs 1             # SQLite, không cần Docker
        .\mem-bench.ps1 -Scenario all -Runs 3           # đủ a-f, i1-i4: khoảng 4,7 giờ
      Script tự mở app với APPDATA riêng (không đụng dữ liệu thật), thao tác UI qua docs/scripts/mem-ui.mjs, rồi đóng app.
      Download của kịch bản c cần điền hộp thoại chọn thư mục native bằng UI Automation; lỗi thì c chỉ còn số upload
      (ghi trong summary.md), phiên vẫn chạy tiếp.
  (e) App so sánh (A5:SQL Mk-2, Navicat), bán tự động (a, d, e-sql, f; b, c không áp dụng):
        .\mem-bench.ps1 -ProcessName Navicat -Scenario d    # đang chạy sẵn; hoặc thêm -CompareExe <đường dẫn> để tự mở
      Script in hướng dẫn từng bước rồi chờ Enter; d dùng cùng file SQLite với S3Browser (-SqliteFile).
  (f) Số đo trước/sau tối ưu luôn so cùng cách đo (bản đo + CDP). Sai số build và CDP nằm trong summary.md.
      Công thức các cột Go (cũng ghi trong summary.md): go_runtime = probe.total - probe.heapReleased; go_private = PrivateBytes
      của process Go; native_other = go_private - go_runtime (DLL Rust, tokio, native khác; âm = probe lớn hơn PrivateBytes).
      Các cột còn lại là Private WS từng loại process. Nối CDP rồi ngắt trước mỗi mẫu.

  Probe Go (không phải bước chuẩn bị riêng): đặt S3B_MEMPROBE=<file> khi chạy app thì mỗi 2 giây app ghi một dòng JSON
  (total, heapObjects, heapReleased, heapStacks, gcGoal, dllLoaded); không đặt thì app không làm gì thêm.
