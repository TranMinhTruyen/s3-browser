const MIN_LENGTH = 3;
const MAX_LENGTH = 63;
const RESERVED_PREFIXES = ['xn--', 'sthree-', 'amzn-s3-demo-'];
const RESERVED_SUFFIXES = ['-s3alias', '--ol-s3', '.mrap', '--x-s3', '--table-s3'];
const IP_ADDRESS = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Validates a bucket name against the S3 naming rules; returns a `validateMessage` code (see `FieldInput`) or null. */
export function validateBucketName(name: string): string | null {
  if (!name) return 'V000001';
  if (name.length < MIN_LENGTH || name.length > MAX_LENGTH) return `V000003:${MIN_LENGTH},${MAX_LENGTH}`;
  if (!/^[a-z0-9.-]+$/.test(name)) return 'V000005';
  if (!/^[a-z0-9].*[a-z0-9]$/.test(name)) return 'V000006';
  if (name.includes('..')) return 'V000007';
  if (IP_ADDRESS.test(name)) return 'V000008';
  if (RESERVED_PREFIXES.some(prefix => name.startsWith(prefix))) return 'V000009';
  if (RESERVED_SUFFIXES.some(suffix => name.endsWith(suffix))) return 'V000010';
  return null;
}
