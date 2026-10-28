import { describe, expect, it } from 'vitest';
import { connectSchema, getDefaultConnectionInfo, profileSchema } from '@/components/modals/connectSchema';
import { INFO_BG_COLOR } from '@/components/modals/modalColors';

const valid = {
  name: 'p',
  color: '#fff',
  provider: 'aws',
  endpoint: 'https://s3',
  region: 'us-east-1',
  accessKey: 'AK',
  secretKey: 'SK',
  pathStyle: false,
  savePassword: false,
  autoConnect: false,
};

describe('getDefaultConnectionInfo', () => {
  it('builds empty values with the given name', () => {
    expect(getDefaultConnectionInfo('My profile')).toEqual({
      name: 'My profile',
      color: INFO_BG_COLOR,
      provider: 'aws',
      endpoint: '',
      region: '',
      accessKey: '',
      secretKey: '',
      pathStyle: false,
      savePassword: false,
      autoConnect: false,
    });
  });
});

describe('profileSchema', () => {
  it('accepts a profile without a secret key', () => {
    expect(profileSchema.safeParse({ ...valid, secretKey: '' }).success).toBe(true);
  });

  it('trims string fields', () => {
    const r = profileSchema.parse({ ...valid, endpoint: '  https://s3  ' });
    expect(r.endpoint).toBe('https://s3');
  });

  it.each(['endpoint', 'region', 'accessKey'])('rejects an empty or blank %s', field => {
    for (const v of ['', '   ']) {
      const r = profileSchema.safeParse({ ...valid, [field]: v });
      expect(r.success).toBe(false);
      expect(r.error?.issues[0]).toMatchObject({ path: [field], message: 'V000001' });
    }
  });
});

describe('connectSchema', () => {
  it('accepts a complete connection', () => {
    expect(connectSchema.safeParse(valid).success).toBe(true);
  });

  it('requires the secret key', () => {
    const r = connectSchema.safeParse({ ...valid, secretKey: '  ' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]).toMatchObject({ path: ['secretKey'], message: 'V000001' });
  });
});
