#!/bin/sh
# Generates the test certificates in ../certs (Git Bash on Windows, macOS, Linux; needs openssl).
#   certs/ca.pem, ca.key            self-signed CA (pick ca.pem as "CA certificate file" in S3Browser)
#   certs/minio/                    server cert for MinIO TLS: public.crt, private.key, CAs/ca.pem
#   certs/client/client.crt         client cert, CN=readwrite (MinIO maps the CN to a policy), EKU clientAuth
#   certs/client/client.key         its key, PKCS#8, no password
#   certs/client/client-enc.key     the same key, PKCS#8 encrypted with the password below
#   certs/client/client-legacy.key  the same key in the old PEM encryption (Proc-Type), must be rejected (S3E043)
#   certs/db/                       server cert shared by the 6 test databases (docker-compose-db.yml):
#                                   server.crt, server.key (RSA 2048), server.pem (key + cert, for MongoDB), ca.pem (copy).
#                                   SAN: localhost, 127.0.0.1, ::1 and the service names.
# Test values only. Run again to replace everything.
set -e
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
