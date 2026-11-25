// Minimal S3 client (SigV4, path style, only node:crypto) for seeding and checking the test bucket.
// Endpoint and keys come from the environment only; nothing is stored in the repo.
import { createHash, createHmac } from 'node:crypto';

export const s3Env = {
  endpoint: process.env.E2E_S3_ENDPOINT ?? '',
  accessKey: process.env.E2E_S3_ACCESS_KEY ?? '',
  secretKey: process.env.E2E_S3_SECRET_KEY ?? '',
  region: process.env.E2E_S3_REGION ?? 'us-east-1',
};
export const hasS3 = Boolean(s3Env.endpoint && s3Env.accessKey && s3Env.secretKey);

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest();

/** Sends a signed request and returns the HTTP status. */
export async function s3(method: 'PUT' | 'DELETE' | 'HEAD', path: string, body = Buffer.alloc(0)) {
  const url = new URL(s3Env.endpoint);
  const canonicalPath = path
    .split('/')
    .map(part => encodeURIComponent(part))
    .join('/');
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  const names = Object.keys(headers).sort();
  const canonical = [
    method,
    canonicalPath,
    '',
    ...names.map(n => `${n}:${headers[n]}`),
    '',
    names.join(';'),
    payloadHash,
  ];
  const scope = `${day}/${s3Env.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical.join('\n'))].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${s3Env.secretKey}`, day), s3Env.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${s3Env.accessKey}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
  const init: RequestInit = { method, headers };
  if (method === 'PUT') init.body = new Uint8Array(body);
  const res = await fetch(`${url.origin}${canonicalPath}`, init);
  await res.arrayBuffer();
  return res.status;
}

/** Creates the bucket and puts every object (key → text content). */
export async function seedBucket(bucket: string, objects: Record<string, string>) {
  const status = await s3('PUT', `/${bucket}`);
  if (status >= 300) throw new Error(`Create bucket ${bucket} -> ${status}`);
  for (const [key, content] of Object.entries(objects)) {
    const put = await s3('PUT', `/${bucket}/${key}`, Buffer.from(content));
    if (put >= 300) throw new Error(`Put ${key} -> ${put}`);
  }
}

/** Deletes the given objects (missing ones are fine) and then the bucket. */
export async function dropBucket(bucket: string, keys: string[]) {
  for (const key of keys) await s3('DELETE', `/${bucket}/${key}`);
  await s3('DELETE', `/${bucket}`);
}
