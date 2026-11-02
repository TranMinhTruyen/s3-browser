#!/bin/bash
# Configures the test Floci and writes floci-config / floci-credentials to /out.
# Safe to run again: existing users, roles and buckets are kept, and access keys are only
# created when /out/floci-credentials does not exist yet.
set -e

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
aws s3api put-bucket-policy --bucket s3b-public-read --policy "$PUBLIC" $E

echo "Writing AWS CLI profiles to ./generated..."
if [ -e /out/floci-credentials ]; then
  echo "  floci-credentials already exists, keeping its access keys"
else
  for u in rw ro assumer; do
    read -r ak sk < <(aws iam create-access-key --user-name s3b-$u $E \
      --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text)
    printf '[floci-%s]\naws_access_key_id = %s\naws_secret_access_key = %s\n\n' $u "$ak" "$sk"
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
