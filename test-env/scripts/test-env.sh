#!/bin/sh
# One script for the test environment (test-env/README.txt). POSIX sh: it also runs inside the MinIO image
# (sh + mc, no grep) and the aws-cli image. Every step is safe to run again.
#
#   sh scripts/test-env.sh up      on the host: everything in one command (certs if missing, then every container:
#                                  S3 servers + 6 databases; returns when all are healthy and initialised)
#   sh scripts/test-env.sh certs   on the host (Git Bash, macOS, Linux; needs openssl): TLS certificates in certs/
#   test-env.sh minio              in the minio-init container: LDAP, policies, access keys, buckets
#   test-env.sh minio-tls          in the minio-tls-init container: bucket for the OIDC / Certificate profiles
#   test-env.sh floci              in the floci-init container: IAM users/roles, buckets, AWS CLI profiles in /out
# Test values only.
set -e

# ---------------------------------------------------------------------------------------------------- up
up() {
  cd "$(dirname "$0")/.."
  # Subshell: certs changes directory. Certificates are kept when they exist (making new ones means recreating
  # the running containers, see certs below).
  [ -f certs/ca.pem ] && [ -f certs/db/server.pem ] || (certs)
  # First run pulls ~7 GB of images; SQL Server needs >= 2 GB RAM free for Docker.
  docker compose up -d --wait
  echo "Test environment is up: docker compose ps (in test-env). Profiles to create in the app: test-profiles.txt"
}

# ---------------------------------------------------------------------------------------------------- certs
# certs/ca.pem, ca.key            self-signed CA (pick ca.pem as "CA certificate file" in S3Browser)
# certs/minio/                    server cert for MinIO TLS: public.crt, private.key, CAs/ca.pem
# certs/client/client.crt         client cert, CN=readwrite (MinIO maps the CN to a policy), EKU clientAuth
# certs/client/client.key         its key, PKCS#8, no password
# certs/client/client-enc.key     the same key, PKCS#8 encrypted with KEY_PASSWORD
# certs/client/client-legacy.key  the same key in the old PEM encryption (Proc-Type), must be rejected (S3E043)
# certs/db/                       server cert shared by the 6 test databases: server.crt, server.key (RSA 2048),
#                                 server.pem (key + cert, for MongoDB), ca.pem (copy).
#                                 SAN: localhost, 127.0.0.1, ::1 and the service names.
# Run again to replace everything (running containers keep the old files: `docker compose up -d --force-recreate`).
certs() {
  export MSYS_NO_PATHCONV=1 # Git Bash would turn the "/CN=..." subjects into Windows paths
  KEY_PASSWORD='ClientKey#2026'
  DAYS=825

  OUT="$(cd "$(dirname "$0")/.." && pwd)/certs"
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
  # RSA because SQL Server on Linux does not take EC keys.
  sign dbserver "/CN=localhost" "subjectAltName=DNS:localhost,DNS:mysql,DNS:mariadb,DNS:postgres,DNS:mssql,DNS:mongo,DNS:redis,IP:127.0.0.1,IP:::1
extendedKeyUsage=serverAuth" rsa
  mv dbserver.crt db/server.crt
  mv dbserver.key db/server.key
  cp ca.pem db/ca.pem # for clients run inside the PostgreSQL / SQL Server containers
  cat db/server.key db/server.crt >db/server.pem

  rm -f ca.srl
  # The containers read the keys as other users (PostgreSQL copies its key and sets 0600 itself).
  chmod 644 minio/private.key client/*.key db/*

  echo "Done: $OUT"
  echo "Key password of client-enc.key and client-legacy.key: $KEY_PASSWORD"
}

# sign <name> <subject> <extensions> [rsa]: key (EC by default) + certificate signed by the CA.
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

  # LDAP takes a few seconds on its first start; MinIO checks the connection when the config is set.
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
  # --json: without a TTY the restart progress UI fails.
  mc admin service restart local --json >/dev/null
  until mc ready local >/dev/null 2>&1; do sleep 1; done

  echo "Attaching policies..."
  mc idp ldap policy attach local readwrite --group="cn=s3-writers,ou=groups,$LDAP_BASE" >/dev/null 2>&1 || true
  mc idp ldap policy attach local readonly --user="uid=ldap-ro,ou=users,$LDAP_BASE" >/dev/null 2>&1 || true

  echo "Creating access keys..."
  # `accesskey info` exits 0 even for a missing key, so look the key up in the list instead (no grep here).
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

  echo "MinIO test environment is ready."
}

# ---------------------------------------------------------------------------------------------------- minio-tls
minio_tls() {
  # --insecure: this only talks to the test MinIO inside the Docker network.
  mc --insecure alias set local https://minio-tls:10000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
  mc --insecure mb --ignore-existing local/s3b-tls >/dev/null
  echo "hello tls" | mc --insecure pipe local/s3b-tls/docs/readme.txt >/dev/null
  echo "MinIO TLS test environment is ready."
}

# ---------------------------------------------------------------------------------------------------- floci
# Writes floci-config / floci-credentials to /out (./generated). Access keys are only created when
# /out/floci-credentials does not exist yet.
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

  # Managed AWS policies in Floci are "Allow *" stubs, so only inline policies are used.
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
  # Floci >= 2.5 turns on Block Public Access for new buckets (like real AWS), which rejects the public policy.
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
  minio) minio ;;
  minio-tls) minio_tls ;;
  floci) floci ;;
  *)
    echo "Usage: sh scripts/test-env.sh up | certs | minio | minio-tls | floci" >&2
    exit 2
    ;;
esac
