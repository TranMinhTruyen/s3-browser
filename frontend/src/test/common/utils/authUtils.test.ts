import { describe, expect, it } from 'vitest';
import { canAutoConnect, getAuthType, getRequiredSecrets, needsManualInput, needsMfa } from '@/common/utils/authUtils';

const mfa = { mfaSerial: 'arn:mfa' };

describe('authUtils', () => {
  it.each([
    [{}, 'static'],
    [{ authType: '' }, 'static'],
    [{ authType: 'sso' }, 'sso'],
  ])('getAuthType(%j) is %s', (profile, expected) => {
    expect(getAuthType(profile)).toBe(expected);
  });

  it.each([
    [{ authType: 'assumeRole', authConfig: mfa }, true],
    [{ authType: 'assumeRole', authConfig: { mfaSerial: '' } }, false],
    [{ authType: 'assumeRole' }, false],
    [{ authType: 'static', authConfig: mfa }, false],
  ])('needsMfa(%j) is %s', (profile, expected) => {
    expect(needsMfa(profile)).toBe(expected);
  });

  it.each([
    [{}, ['secretKey']],
    [{ authType: 'static' }, ['secretKey']],
    [{ authType: 'assumeRole', authConfig: { sourceType: 'static' } }, ['secretKey']],
    [{ authType: 'assumeRole' }, ['secretKey']],
    [{ authType: 'assumeRole', authConfig: { sourceType: 'profile' } }, []],
    [{ authType: 'sharedProfile' }, []],
    [{ authType: 'defaultChain' }, []],
    [{ authType: 'anonymous' }, []],
    [{ authType: 'minioAssumeRole' }, ['secretKey']],
    [{ authType: 'minioLdap' }, ['ldapPassword']],
  ])('getRequiredSecrets(%j) is %j', (profile, expected) => {
    expect(getRequiredSecrets(profile as never)).toEqual(expected);
  });

  it.each([
    [{ authType: 'static' }, true],
    [{ authType: 'sso' }, true],
    [{ authType: 'assumeRole', authConfig: { sourceType: 'static' } }, true],
    [{ authType: 'assumeRole', authConfig: { sourceType: 'static', mfaSerial: 'arn:mfa' } }, false],
    [{ authType: 'minioOidc' }, false],
    [{ authType: 'anonymous' }, true],
    [{ authType: 'minioAssumeRole' }, true],
    [{ authType: 'minioLdap' }, true],
    [{ authType: 'unknown' }, false],
  ])('canAutoConnect(%j) is %s', (profile, expected) => {
    expect(canAutoConnect(profile as never)).toBe(expected);
  });

  it.each([
    ['everything saved', { accessKey: 'AK', savedSecrets: ['secretKey'] }, false],
    ['secret not saved', { accessKey: 'AK', savedSecrets: [] }, true],
    ['savedSecrets missing', { accessKey: 'AK' }, true],
    ['access key missing', { accessKey: '', savedSecrets: ['secretKey'] }, true],
    ['MFA device', { authType: 'assumeRole', authConfig: mfa, accessKey: 'AK', savedSecrets: ['secretKey'] }, true],
    ['AWS CLI profile needs nothing', { authType: 'sharedProfile' }, false],
    [
      'assume role from a profile needs nothing',
      { authType: 'assumeRole', authConfig: { sourceType: 'profile' } },
      false,
    ],
    ['anonymous needs nothing', { authType: 'anonymous' }, false],
    [
      'minioAssumeRole needs the saved secret key',
      { authType: 'minioAssumeRole', accessKey: 'AK', savedSecrets: [] },
      true,
    ],
    [
      'minioAssumeRole with everything saved',
      { authType: 'minioAssumeRole', accessKey: 'AK', savedSecrets: ['secretKey'] },
      false,
    ],
    ['minioLdap with the password saved', { authType: 'minioLdap', savedSecrets: ['ldapPassword'] }, false],
    ['minioLdap without the password saved', { authType: 'minioLdap', savedSecrets: [] }, true],
    ['minioLdap with unrelated secrets', { authType: 'minioLdap', savedSecrets: ['secretKey'] }, true],
    ['minioLdap with no savedSecrets', { authType: 'minioLdap' }, true],
  ])('needsManualInput: %s -> %s', (_name, profile, expected) => {
    expect(needsManualInput(profile as never)).toBe(expected);
  });
});
