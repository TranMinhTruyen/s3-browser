import { describe, expect, it } from 'vitest';
import { validateBucketName } from '@/common/utils/bucketUtils';

describe('validateBucketName', () => {
  it.each([
    ['abc'],
    ['my-bucket'],
    ['my.bucket.name'],
    ['a1b'],
    ['a'.repeat(63)],
    ['1.2.3'],
    ['1.2.3.a'],
    ['256x.1.1.1'],
  ])('accepts %s', name => {
    expect(validateBucketName(name)).toBeNull();
  });

  it.each([
    ['', 'V000001'],
    ['a', 'V000003:3,63'],
    ['ab', 'V000003:3,63'],
    ['a'.repeat(64), 'V000003:3,63'],
    ['MyBucket', 'V000005'],
    ['my_bucket', 'V000005'],
    ['my bucket', 'V000005'],
    ['-abc', 'V000006'],
    ['abc-', 'V000006'],
    ['.abc', 'V000006'],
    ['abc.', 'V000006'],
    ['a..bc', 'V000007'],
    ['192.168.0.1', 'V000008'],
    ['xn--abc', 'V000009'],
    ['sthree-abc', 'V000009'],
    ['amzn-s3-demo-abc', 'V000009'],
    ['abc-s3alias', 'V000010'],
    ['abc--ol-s3', 'V000010'],
    ['abc.mrap', 'V000010'],
    ['abc--x-s3', 'V000010'],
    ['abc--table-s3', 'V000010'],
  ])('rejects %j with %s', (name, code) => {
    expect(validateBucketName(name)).toBe(code);
  });
});
