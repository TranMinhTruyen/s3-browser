#!/bin/sh
# Một script cho môi trường test (test-env/README.txt). Dùng POSIX sh để chạy được trong image MinIO
# (sh + mc, không có grep) và image aws-cli. Có thể chạy lại an toàn từng bước.
#
#   sh scripts/test-env.sh up      trên máy chủ: chạy mọi thứ bằng một lệnh (tạo cert nếu thiếu, rồi chạy mọi container:
#                                  máy chủ S3 và 6 database; kết thúc khi tất cả đều khỏe và đã khởi tạo)
#   sh scripts/test-env.sh certs   trên máy chủ (Git Bash, macOS, Linux; cần openssl): tạo chứng chỉ TLS trong certs/
#   sh scripts/test-env.sh seed    trên máy chủ: nạp database mẫu "demo" vào các container database đang chạy (db/seed/)
#   test-env.sh minio              trong container minio-init: LDAP, policy, access key và bucket
#   test-env.sh minio-tls          trong container minio-tls-init: bucket cho profile OIDC / Certificate
#   test-env.sh floci              trong container floci-init: user/role IAM, bucket, file profile AWS CLI trong /out
# Chỉ dùng cho dữ liệu test.
set -e
# Lấy đường dẫn tuyệt đối tới test-env/ bất kể thư mục hiện tại (trong container là /, không dùng tại đó).
ENV_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# ---------------------------------------------------------------------------------------------------- up
up() {
  cd "$ENV_DIR"
  # Dùng subshell vì lệnh tạo cert đổi thư mục. Giữ chứng chỉ nếu đã có (tạo lại sẽ cần dựng lại
  # các container đang chạy, xem phần certs bên dưới).
  [ -f certs/ca.pem ] && [ -f certs/db/server.pem ] || (certs)
  # Lần chạy đầu tải khoảng 7 GB image; SQL Server cần Docker còn trống ít nhất 2 GB RAM.
  docker compose up -d --wait
  seed
  echo "Test environment is up: docker compose ps (in test-env). Profiles to create in the app: test-profiles.txt"
}

# ---------------------------------------------------------------------------------------------------- seed
# Dữ liệu mẫu để thử chế độ SQL: database "demo" (customers, products, orders, order_items, events với
# 10.000 hàng, view v_order_summary), Redis db 1 với key demo:*. Test Rust dùng database s3b, không dùng demo.
# Bỏ qua database chưa chạy hoặc đã có demo (giữ lại thay đổi thực hiện trong ứng dụng); nếu nạp lỗi thì xóa demo
# để lần sau nạp lại. Redis không lưu dữ liệu xuống đĩa (--save ""), vì vậy sẽ nạp lại sau mỗi lần khởi động container.
running() { [ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = true ]; }

# seed_db <label> <container> <seed file> <check: in ra nội dung nếu demo tồn tại> <load: đọc stdin> <drop>
seed_db() {
  if ! running "$2"; then echo "  $1: not running, skipped"; return 0; fi
  if [ -n "$(docker exec "$2" sh -c "$4" </dev/null)" ]; then echo "  $1: demo already loaded"; return 0; fi
  echo "  $1: loading demo..."
  if docker exec -i "$2" sh -c "$5" <"$3" >/dev/null && [ -n "$(docker exec "$2" sh -c "$4" </dev/null)" ]; then
    return 0
  fi
  echo "  $1: loading failed, demo dropped (run 'sh scripts/test-env.sh seed' again)" >&2
  docker exec "$2" sh -c "$6" </dev/null >/dev/null 2>&1 || true
  return 1
}

seed() {
  cd "$ENV_DIR/db/seed"
  export MSYS_NO_PATHCONV=1 # Git Bash would turn /opt/... in the commands into Windows paths
  echo "Loading sample data (database demo)..."
  # Mật khẩu được đọc từ biến môi trường bên trong từng container, không đọc trên máy chủ này.
  ok=0
  my='MYSQL_PWD=$MYSQL_ROOT_PASSWORD mysql -uroot'
  seed_db MySQL s3b-test-mysql mysql.sql "$my -N -e \"SHOW DATABASES LIKE 'demo'\"" "$my"     "$my -e 'DROP DATABASE IF EXISTS demo'" || ok=1
  my='MYSQL_PWD=$MARIADB_ROOT_PASSWORD mariadb -uroot'
  seed_db MariaDB s3b-test-mariadb mysql.sql "$my -N -e \"SHOW DATABASES LIKE 'demo'\"" "$my"     "$my -e 'DROP DATABASE IF EXISTS demo'" || ok=1
  seed_db PostgreSQL s3b-test-postgres postgres.sql     "psql -U postgres -tAc \"SELECT 1 FROM pg_database WHERE datname = 'demo'\""     'createdb -U postgres demo && psql -U postgres -d demo -q -v ON_ERROR_STOP=1 -1'     'dropdb -U postgres --if-exists demo' || ok=1
  sq='/opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -b'
  seed_db "SQL Server" s3b-test-mssql mssql.sql     "$sq -h -1 -W -Q \"SET NOCOUNT ON; SELECT name FROM sys.databases WHERE name = 'demo'\"" "$sq -I"     "$sq -Q 'DROP DATABASE IF EXISTS demo'" || ok=1
  mg='mongosh --quiet -u root -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin'
  seed_db MongoDB s3b-test-mongo mongo.js     "$mg --eval \"if (db.getSiblingDB('demo').getCollectionNames().length) print('yes')\"" "$mg"     "$mg --eval \"db.getSiblingDB('demo').dropDatabase()\"" || ok=1
  seed_db Redis s3b-test-redis redis.txt 'redis-cli -n 1 GET demo:greeting' 'redis-cli -n 1'     "redis-cli -n 1 EVAL \"for _, k in ipairs(redis.call('KEYS', 'demo:*')) do redis.call('DEL', k) end\" 0" || ok=1
  return $ok
}

# ---------------------------------------------------------------------------------------------------- certs
# certs/ca.pem, ca.key            CA tự ký (chọn ca.pem làm "CA certificate file" trong S3Browser)
# certs/minio/                    chứng chỉ máy chủ MinIO TLS: public.crt, private.key, CAs/ca.pem
# certs/client/client.crt         chứng chỉ client, CN=readwrite (MinIO ánh xạ CN thành policy), EKU clientAuth
# certs/client/client.key         key tương ứng, PKCS#8, không có mật khẩu
# certs/client/client-enc.key     cùng key đó, PKCS#8 được mã hóa bằng KEY_PASSWORD
# certs/client/client-legacy.key  cùng key ở định dạng mã hóa PEM cũ (Proc-Type), phải bị từ chối (S3E043)
# certs/db/                       chứng chỉ máy chủ dùng chung cho 6 database test: server.crt, server.key (RSA 2048),
#                                 server.pem (key + cert, dùng cho MongoDB), ca.pem (bản sao).
#                                 SAN: localhost, 127.0.0.1, ::1 và tên các service.
# Chạy lại để thay toàn bộ file (container đang chạy vẫn giữ file cũ: `docker compose up -d --force-recreate`).
certs() {
  export MSYS_NO_PATHCONV=1 # Git Bash would turn the "/CN=..." subjects into Windows paths
  KEY_PASSWORD='ClientKey#2026'
  DAYS=825

  OUT="$ENV_DIR/certs"
  rm -rf "$OUT"
  mkdir -p "$OUT/minio/CAs" "$OUT/client" "$OUT/db"
  cd "$OUT"

  echo "CA..."
  openssl ecparam -name prime256v1 -genkey -noout -out ca.key
  openssl req -x509 -new -key ca.key -sha256 -days "$DAYS" -subj "/CN=S3Browser Test CA" -out ca.pem \
    -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign"

  echo "MinIO server certificate..."
  sign server "/CN=localhost" "subjectAltName=DNS:localhost,DNS:minio,DNS:minio-tls,IP:127.0.0.1
extendedKeyUsage=serverAuth"
  mv server.crt minio/public.crt
  mv server.key minio/private.key
  cp ca.pem minio/CAs/ca.pem # MinIO verifies client certificates against this directory

  echo "Client certificate..."
  sign client "/CN=readwrite" "extendedKeyUsage=clientAuth"
  mv client.crt client.key client/
  openssl pkcs8 -topk8 -in client/client.key -v2 aes-256-cbc -passout "pass:$KEY_PASSWORD" -out client/client-enc.key
  openssl ec -in client/client.key -aes256 -passout "pass:$KEY_PASSWORD" -out client/client-legacy.key >/dev/null 2>&1

  echo "Database server certificate..."
  # Dùng RSA vì SQL Server trên Linux không chấp nhận key EC.
  sign dbserver "/CN=localhost" "subjectAltName=DNS:localhost,DNS:mysql,DNS:mariadb,DNS:postgres,DNS:mssql,DNS:mongo,DNS:redis,IP:127.0.0.1,IP:::1
extendedKeyUsage=serverAuth" rsa
  mv dbserver.crt db/server.crt
  mv dbserver.key db/server.key
  cp ca.pem db/ca.pem # for clients run inside the PostgreSQL / SQL Server containers
  cat db/server.key db/server.crt >db/server.pem

  rm -f ca.srl
  # Container đọc key bằng user khác (PostgreSQL tự sao chép key và đặt quyền 0600).
  chmod 644 minio/private.key client/*.key db/*

  echo "Done: $OUT"
  echo "Key password of client-enc.key and client-legacy.key: $KEY_PASSWORD"
}

# sign <name> <subject> <extensions> [rsa]: tạo key (mặc định EC) và chứng chỉ do CA ký.
sign() {
  if [ "$4" = rsa ]; then
    openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$1.key"
  else
    openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:prime256v1 -out "$1.key"
  fi
  openssl req -new -key "$1.key" -subj "$2" -out "$1.csr"
  printf '%s\n' "$3" >"$1.ext"
  openssl x509 -req -in "$1.csr" -CA ca.pem -CAkey ca.key -CAcreateserial -sha256 -days "$DAYS" \
    -extfile "$1.ext" -out "$1.crt"
  rm "$1.csr" "$1.ext"
}

# ---------------------------------------------------------------------------------------------------- minio
minio() {
  LDAP_BASE="dc=s3browser,dc=local"
  mc alias set local http://minio:10000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null

  # LDAP mất vài giây để khởi động lần đầu; MinIO kiểm tra kết nối ngay khi đặt cấu hình.
  echo "Configuring LDAP..."
  i=0
  until mc admin config set local identity_ldap \
    server_addr=openldap:389 server_insecure=on \
    lookup_bind_dn="cn=admin,$LDAP_BASE" lookup_bind_password='LdapAdmin#2026' \
    user_dn_search_base_dn="ou=users,$LDAP_BASE" user_dn_search_filter='(uid=%s)' \
    group_search_base_dn="ou=groups,$LDAP_BASE" \
    group_search_filter='(&(objectclass=groupOfNames)(member=%d))' >/dev/null 2>&1; do
    i=$((i + 1))
    [ "$i" -ge 30 ] && { echo "LDAP is not reachable"; exit 1; }
    sleep 2
  done
  # --json: giao diện tiến độ restart lỗi khi không có TTY.
  mc admin service restart local --json >/dev/null
  until mc ready local >/dev/null 2>&1; do sleep 1; done

  echo "Attaching policies..."
  mc idp ldap policy attach local readwrite --group="cn=s3-writers,ou=groups,$LDAP_BASE" >/dev/null 2>&1 || true
  mc idp ldap policy attach local readonly --user="uid=ldap-ro,ou=users,$LDAP_BASE" >/dev/null 2>&1 || true

  echo "Creating access keys..."
  # `accesskey info` trả mã 0 kể cả khi không có key nên tìm key trong danh sách (ở đây không có grep).
  keys=$(mc idp ldap accesskey ls local)
  case "$keys" in *s3b-rw-key*) ;; *)
    mc idp ldap accesskey create local ldap-rw --access-key s3b-rw-key --secret-key 'S3bRwKey#2026' \
      --name s3browser-test-rw >/dev/null ;;
  esac
  case "$keys" in *s3b-ro-key*) ;; *)
    mc idp ldap accesskey create local ldap-ro --access-key s3b-ro-key --secret-key 'S3bRoKey#2026' \
      --name s3browser-test-ro >/dev/null ;;
  esac

  echo "Creating buckets..."
  for b in anon-public-read anon-public-rw demo-photos; do mc mb --ignore-existing "local/$b" >/dev/null; done
  mc anonymous set download local/anon-public-read >/dev/null
  mc anonymous set public local/anon-public-rw >/dev/null
  echo "hello anonymous" >/tmp/hello.txt
  for b in anon-public-read anon-public-rw demo-photos; do
    mc cp -q /tmp/hello.txt "local/$b/hello.txt" >/dev/null
    mc cp -q /tmp/hello.txt "local/$b/docs/readme.txt" >/dev/null
  done

  # Dữ liệu cho test-env/mem-bench-all.ps1: 10.000 object nhỏ (cùng tên với mem-bench.ps1 -PrepareData).
  # Bỏ qua nếu bucket đã có các object này để khởi động lại stack nhanh hơn.
  echo "Creating bucket s3b-mem-10k (10,000 objects for the memory benchmark)..."
  mc mb --ignore-existing local/s3b-mem-10k >/dev/null
  n=$(mc ls local/s3b-mem-10k | wc -l)
  if [ "$n" -lt 10000 ]; then
    rm -rf /tmp/seed && mkdir -p /tmp/seed
    i=1
    while [ "$i" -le 10000 ]; do echo "$i" >"/tmp/seed/obj-$(printf %05d "$i").bin"; i=$((i + 1)); done
    mc cp -q --recursive /tmp/seed/ local/s3b-mem-10k/ >/dev/null
    rm -rf /tmp/seed
  fi

  echo "MinIO test environment is ready."
}

# ---------------------------------------------------------------------------------------------------- minio-tls
minio_tls() {
  # --insecure: lệnh này chỉ kết nối MinIO test bên trong mạng Docker.
  mc --insecure alias set local https://minio-tls:10000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
  mc --insecure mb --ignore-existing local/s3b-tls >/dev/null
  echo "hello tls" | mc --insecure pipe local/s3b-tls/docs/readme.txt >/dev/null
  echo "MinIO TLS test environment is ready."
}

# ---------------------------------------------------------------------------------------------------- floci
# Ghi floci-config / floci-credentials vào /out (./generated). Chỉ tạo access key khi
# /out/floci-credentials chưa tồn tại.
floci() {
  E="--endpoint-url http://floci:4566 --region ap-southeast-1"
  RW='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"s3:*","Resource":"*"}]}'
  RO='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:Get*","s3:List*"],"Resource":"*"}]}'
  ASSUME='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"sts:AssumeRole","Resource":"arn:aws:iam::000000000000:role/s3b-*"}]}'
  TRUST='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"AWS":"arn:aws:iam::000000000000:user/s3b-assumer"},"Action":"sts:AssumeRole"}]}'
  PUBLIC='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":"*","Action":["s3:GetObject","s3:ListBucket"],"Resource":["arn:aws:s3:::s3b-public-read","arn:aws:s3:::s3b-public-read/*"]}]}'

  echo "Waiting for Floci..."
  i=0
  until aws s3api list-buckets $E >/dev/null 2>&1; do
    i=$((i + 1))
    [ "$i" -ge 60 ] && { echo "Floci is not reachable"; exit 1; }
    sleep 2
  done

  # Policy AWS quản lý trong Floci chỉ là stub "Allow *" nên chỉ dùng inline policy.
  echo "Creating IAM users and roles..."
  for u in s3b-rw s3b-ro s3b-assumer; do
    aws iam get-user --user-name $u $E >/dev/null 2>&1 || aws iam create-user --user-name $u $E >/dev/null
  done
  aws iam put-user-policy --user-name s3b-rw --policy-name s3-rw --policy-document "$RW" $E
  aws iam put-user-policy --user-name s3b-ro --policy-name s3-ro --policy-document "$RO" $E
  aws iam put-user-policy --user-name s3b-assumer --policy-name allow-assume --policy-document "$ASSUME" $E
  for r in rw ro; do
    aws iam get-role --role-name s3b-role-$r $E >/dev/null 2>&1 ||
      aws iam create-role --role-name s3b-role-$r --assume-role-policy-document "$TRUST" $E >/dev/null
  done
  aws iam put-role-policy --role-name s3b-role-rw --policy-name s3-rw --policy-document "$RW" $E
  aws iam put-role-policy --role-name s3b-role-ro --policy-name s3-ro --policy-document "$RO" $E

  echo "Creating buckets..."
  for b in s3b-private s3b-public-read; do
    aws s3api head-bucket --bucket $b $E >/dev/null 2>&1 ||
      aws s3api create-bucket --bucket $b --create-bucket-configuration LocationConstraint=ap-southeast-1 $E >/dev/null
    echo "hello floci" | aws s3 cp - s3://$b/hello.txt $E >/dev/null
    echo "hello floci" | aws s3 cp - s3://$b/docs/readme.txt $E >/dev/null
  done
  # Floci >= 2.5 bật Block Public Access cho bucket mới (giống AWS thật), khiến public policy bị từ chối.
  aws s3api delete-public-access-block --bucket s3b-public-read $E >/dev/null 2>&1 || true
  aws s3api put-bucket-policy --bucket s3b-public-read --policy "$PUBLIC" $E

  echo "Writing AWS CLI profiles to ./generated..."
  if [ -e /out/floci-credentials ]; then
    echo "  floci-credentials already exists, keeping its access keys"
  else
    for u in rw ro assumer; do
      aws iam create-access-key --user-name s3b-$u $E \
        --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text |
        { read -r ak sk; printf '[floci-%s]\naws_access_key_id = %s\naws_secret_access_key = %s\n\n' $u "$ak" "$sk"; }
    done >/out/floci-credentials
  fi

  endpoint="http://localhost:${FLOCI_PORT:-4566}"
  {
    echo "# Profiles for testing S3Browser against Floci ($endpoint). Not real AWS."
    for p in rw ro assumer; do
      printf '[profile floci-%s]\nregion = ap-southeast-1\nendpoint_url = %s\n\n' $p "$endpoint"
    done
    for p in rw ro; do
      printf '[profile floci-role-%s]\nregion = ap-southeast-1\nendpoint_url = %s\n' $p "$endpoint"
      printf 'role_arn = arn:aws:iam::000000000000:role/s3b-role-%s\nsource_profile = floci-assumer\n\n' $p
    done
  } >/out/floci-config

  echo "Floci test environment is ready."
}

case "$1" in
  up) up ;;
  certs) certs ;;
  seed) seed ;;
  minio) minio ;;
  minio-tls) minio_tls ;;
  floci) floci ;;
  *)
    echo "Usage: sh scripts/test-env.sh up | certs | seed | minio | minio-tls | floci" >&2
    exit 2
    ;;
esac
