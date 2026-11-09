// Seeds demo buckets and small fake objects into a local S3-compatible server (MinIO) for the user-guide screenshots.
// Credentials and endpoint come from the environment only; nothing is stored in the repo.
//   S3_ENDPOINT=http://localhost:10030 S3_ACCESS_KEY=... S3_SECRET_KEY=... node docs/seed/seed.mjs
// Existing buckets are never touched; only the demo-* buckets below are created and filled (idempotent).
import { createHash, createHmac } from 'node:crypto';
import { deflateSync } from 'node:zlib';

const { S3_ENDPOINT: endpoint, S3_ACCESS_KEY: accessKey, S3_SECRET_KEY: secretKey } = process.env;
const region = process.env.S3_REGION ?? 'us-east-1';
if (!endpoint || !accessKey || !secretKey) {
  console.error('Set S3_ENDPOINT, S3_ACCESS_KEY and S3_SECRET_KEY.');
  process.exit(1);
}

const sha256 = data => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
const encodePath = path => path.split('/').map(s => encodeURIComponent(s)).join('/');

/** Sends a SigV4-signed request (path-style) and throws on non-2xx. `query` is a single value-less sub-resource such as `policy`. */
async function s3(method, path, body = Buffer.alloc(0), contentType, query = '') {
  const url = new URL(endpoint);
  const canonicalPath = encodePath(path);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const headers = { host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  if (contentType) headers['content-type'] = contentType;
  const names = Object.keys(headers).sort();
  const canonical = [
    method,
    canonicalPath,
    query ? `${query}=` : '',
    ...names.map(n => `${n}:${headers[n]}`),
    '',
    names.join(';'),
    payloadHash,
  ].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const kDate = hmac(`AWS4${secretKey}`, day);
  const key = hmac(hmac(hmac(kDate, region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
  const res = await fetch(`${url.origin}${canonicalPath}${query ? `?${query}` : ''}`, { method, headers, body: method === 'PUT' ? body : undefined });
  if (!res.ok && res.status !== 409) throw new Error(`${method} ${path} -> ${res.status}`);
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = buf => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};

/** A small valid gradient PNG so image previews look real. */
function png(hue) {
  const w = 160;
  const h = 100;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    for (let x = 0; x < w; x++) {
      raw[row + 1 + x * 3] = (x * 255) / w;
      raw[row + 2 + x * 3] = (y * 255) / h;
      raw[row + 3 + x * 3] = hue;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const csv = rows => ['id,name,amount', ...Array.from({ length: rows }, (_, i) => `${i + 1},item-${i + 1},${(i * 7.5).toFixed(2)}`)].join('\n');
const text = s => Buffer.from(s);
const pdf = title =>
  text(`%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R>>\n%% ${title}\n%%EOF\n`);

const types = { png: 'image/png', pdf: 'application/pdf', csv: 'text/csv', txt: 'text/plain', json: 'application/json', zip: 'application/zip' };
const demo = {
  'demo-photos': {
    'beach.png': png(40), 'mountain.png': png(120), 'city-night.png': png(200),
    'travel/2026/paris.png': png(80), 'travel/2026/tokyo.png': png(160), 'travel/2026/hanoi.png': png(220),
    'family/birthday.png': png(60), 'family/picnic.png': png(140),
    'README.txt': text('Demo photos for the S3Browser user guide.\n'),
  },
  'demo-reports': {
    'summary-2026.pdf': pdf('summary'),
    '2026/q1/sales.csv': text(csv(40)), '2026/q1/expenses.csv': text(csv(25)), '2026/q1/report.pdf': pdf('q1'),
    '2026/q2/sales.csv': text(csv(55)), '2026/q2/report.pdf': pdf('q2'),
    'archive/2025-annual.pdf': pdf('2025'), 'archive/2025-sales.csv': text(csv(90)),
    'config.json': text('{"currency":"USD","timezone":"UTC"}\n'),
  },
  'demo-backups': {
    'db/backup-2026-10-01.zip': text('fake backup 1'), 'db/backup-2026-10-15.zip': text('fake backup 2'),
    'db/backup-2026-10-28.zip': text('fake backup 3'),
    'logs/app.log': text('2026-10-28 INFO started\n2026-10-28 WARN slow query\n'),
    'notes.txt': text('Backup notes.\n'),
  },
};

/** Bucket policies so the policy badge shows every type: public read-only, custom, and none (private). */
const publicRead = bucket => ({
  Version: '2012-10-17',
  Statement: [
    { Effect: 'Allow', Principal: '*', Action: ['s3:GetBucketLocation', 's3:ListBucket'], Resource: `arn:aws:s3:::${bucket}` },
    { Effect: 'Allow', Principal: '*', Action: ['s3:GetObject'], Resource: `arn:aws:s3:::${bucket}/*` },
  ],
});
const customPolicy = bucket => ({
  Version: '2012-10-17',
  Statement: [{ Effect: 'Allow', Principal: '*', Action: ['s3:GetObject'], Resource: `arn:aws:s3:::${bucket}/2026/*` }],
});
const policies = { 'demo-photos': publicRead('demo-photos'), 'demo-reports': customPolicy('demo-reports') };

for (const [bucket, files] of Object.entries(demo)) {
  await s3('PUT', `/${bucket}`);
  for (const [key, body] of Object.entries(files)) {
    await s3('PUT', `/${bucket}/${key}`, body, types[key.split('.').pop()]);
  }
  if (policies[bucket]) await s3('PUT', `/${bucket}`, text(JSON.stringify(policies[bucket])), 'application/json', 'policy');
  console.log(`[seed] ${bucket}: ${Object.keys(files).length} objects`);
}
