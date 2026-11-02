#!/bin/sh
# Creates the bucket and an object for the OIDC / Certificate test profiles. Safe to run again.
set -e

# --insecure: this script only talks to the test MinIO inside the Docker network.
mc --insecure alias set local https://minio-tls:10000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
mc --insecure mb --ignore-existing local/s3b-tls >/dev/null
echo "hello tls" | mc --insecure pipe local/s3b-tls/docs/readme.txt >/dev/null
echo "MinIO TLS test environment is ready."
