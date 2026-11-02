#!/bin/sh
# Configures the test MinIO. Safe to run again: every step skips what already exists.
set -e

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
# `accesskey info` exits 0 even for a missing key, so look the key up in the list instead
# (the MinIO image has no grep).
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
