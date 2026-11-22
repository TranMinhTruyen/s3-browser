#!/bin/sh
# Sinh lại chứng chỉ cho test TLS (rust/src/drivers/tls.rs). Chỉ dùng cho test, khoá không bí mật.
# Chạy trong Git Bash tại thư mục này: sh gen.sh. Hạn dùng 100 năm để test không hết hạn.
# Khoá CA chỉ dùng để ký rồi bỏ (không giữ lại); chỉ server.key được giữ vì test cần ký chữ ký bắt tay.
set -e
export MSYS2_ARG_CONV_EXCL='*'
DAYS=36500
T=.gen-tmp
rm -rf "$T" && mkdir "$T"
trap 'rm -rf "$T"' EXIT

# Hai CA độc lập: ca (tin cậy) và ca_other (CA lạ).
for ca in ca ca_other; do
  openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$T/$ca.key"
  openssl req -x509 -new -key "$T/$ca.key" -subj "/CN=s3b test $ca" -days $DAYS -sha256 \
    -addext 'basicConstraints=critical,CA:TRUE' -addext 'keyUsage=critical,keyCertSign,cRLSign' -out "$ca.pem"
done

# Một khoá server dùng chung cho mọi chứng chỉ lá.
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out server.key
openssl req -new -key server.key -subj "/CN=localhost" -out "$T/server.csr"
printf 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost,DNS:db.test,IP:127.0.0.1\n' > "$T/leaf.ext"

# server.pem: ký bởi ca. server_other_ca.pem: cùng khoá và tên nhưng ký bởi ca_other.
openssl x509 -req -in "$T/server.csr" -CA ca.pem -CAkey "$T/ca.key" -CAcreateserial -CAserial "$T/ca.srl" \
  -days $DAYS -sha256 -extfile "$T/leaf.ext" -out server.pem
openssl x509 -req -in "$T/server.csr" -CA ca_other.pem -CAkey "$T/ca_other.key" -CAcreateserial -CAserial "$T/o.srl" \
  -days $DAYS -sha256 -extfile "$T/leaf.ext" -out server_other_ca.pem

# selfsigned.pem: tự ký, tên other.test (không khớp localhost), cùng khoá server.
openssl req -x509 -new -key server.key -subj "/CN=other.test" -days $DAYS -sha256 -addext 'subjectAltName=DNS:other.test' \
  -addext 'basicConstraints=critical,CA:FALSE' -addext 'keyUsage=critical,digitalSignature' \
  -addext 'extendedKeyUsage=serverAuth' -out selfsigned.pem
