import type { ConnectionProfileOutput } from '@wails/S3Browser/models';
import { describe, expect, it } from 'vitest';
import {
  type ConnectionInfo,
  connectSchema,
  getDefaultConnectionInfo,
  profileSchema,
  toConnectionInput,
  toFormValues,
} from '@/components/modals/connect/connectSchema';
import { DEFAULT_PROFILE_COLOR } from '@/components/modals/modalColors';

type AuthConfig = ConnectionInfo['authConfig'];
type Patch = Partial<Omit<ConnectionInfo, 'authConfig'>> & { authConfig?: Partial<AuthConfig> };

/** Valid static AWS values; tests override what they check. */
const make = (patch: Patch = {}) => {
  const base = getDefaultConnectionInfo('p');
  const { authConfig, ...rest } = patch;
  return {
    ...base,
    region: 'us-east-1',
    accessKey: 'AK',
    secretKey: 'SK',
    ...rest,
    authConfig: { ...base.authConfig, ...authConfig },
  } as ConnectionInfo;
};

const assumeRole = (authConfig: Partial<AuthConfig> = {}, rest: Patch = {}) =>
  make({
    authType: 'assumeRole',
    ...rest,
    authConfig: { roleArn: 'arn:aws:iam::123456789012:role/Admin', ...authConfig },
  });

/** First message per field, the one the form shows. */
const issues = (schema: typeof connectSchema, values: unknown) => {
  const r = schema.safeParse(values);
  const first = new Map<string, string>();
  for (const i of r.success ? [] : r.error.issues) {
    const path = i.path.join('.');
    if (!first.has(path)) first.set(path, i.message);
  }
  return [...first].map(([path, message]) => `${path}=${message}`);
};

describe('getDefaultConnectionInfo', () => {
  it('builds empty static AWS values with the given name', () => {
    expect(getDefaultConnectionInfo('My profile')).toEqual({
      name: 'My profile',
      color: DEFAULT_PROFILE_COLOR,
      provider: 'aws',
      endpoint: '',
      region: '',
      accessKey: '',
      secretKey: '',
      pathStyle: false,
      savePassword: false,
      autoConnect: false,
      mfaCode: '',
      authType: 'static',
      authConfig: {
        profileName: '',
        configFile: '',
        credentialsFile: '',
        sourceType: 'static',
        roleArn: '',
        externalId: '',
        sessionName: '',
        durationSeconds: 3600,
        mfaSerial: '',
      },
      authSecret: { sessionToken: '' },
    });
  });
});

describe('static', () => {
  it('accepts complete values and trims strings', () => {
    const r = connectSchema.parse(make({ endpoint: '  https://s3  ', accessKey: ' AK ' }));
    expect(r.endpoint).toBe('https://s3');
    expect(r.accessKey).toBe('AK');
  });

  it('only needs the access key and region to save a profile', () => {
    expect(issues(profileSchema, make({ secretKey: '' }))).toEqual([]);
  });

  it('needs the secret key to connect', () => {
    expect(issues(connectSchema, make({ secretKey: '  ' }))).toEqual(['secretKey=V000001']);
  });

  it.each([
    ['profile', profileSchema],
    ['connect', connectSchema],
  ])('requires the access key and the region when it is %s', (_n, schema) => {
    expect(issues(schema, make({ accessKey: '', region: '' }))).toEqual(
      expect.arrayContaining(['accessKey=V000001', 'region=V000001'])
    );
  });

  it('requires the endpoint for MinIO only', () => {
    expect(issues(connectSchema, make({ endpoint: '' }))).toEqual([]);
    expect(issues(connectSchema, make({ provider: 'minio', endpoint: '' }))).toEqual(['endpoint=V000001']);
    expect(issues(connectSchema, make({ provider: 'minio', endpoint: 'http://m', region: '' }))).toEqual([
      'region=V000001',
    ]);
  });
});

describe.each(['sharedProfile', 'sso'] as const)('%s', authType => {
  it('requires the profile name', () => {
    expect(issues(connectSchema, make({ authType, region: '' }))).toEqual(['authConfig.profileName=V000001']);
  });

  it('accepts a profile name without keys or region on AWS', () => {
    const values = make({ authType, region: '', accessKey: '', secretKey: '', authConfig: { profileName: 'dev' } });
    expect(issues(connectSchema, values)).toEqual([]);
  });

  it('still requires a region on MinIO', () => {
    const values = make({
      authType,
      provider: 'minio',
      endpoint: 'http://m',
      region: '',
      authConfig: { profileName: 'dev' },
    });
    expect(issues(connectSchema, values)).toEqual(['region=V000001']);
  });
});

describe('defaultChain', () => {
  it('needs nothing on AWS', () => {
    const values = make({ authType: 'defaultChain', region: '', accessKey: '', secretKey: '' });
    expect(issues(connectSchema, values)).toEqual([]);
  });
});

describe('assumeRole', () => {
  it('accepts a role with access keys', () => {
    expect(issues(connectSchema, assumeRole())).toEqual([]);
  });

  it.each([
    ['', 'V000001'],
    ['   ', 'V000001'],
    ['not-an-arn', 'V000004'],
    ['arn:aws:iam::123:role/x', 'V000004'],
  ])('rejects the role ARN %j with %s', (roleArn, message) => {
    expect(issues(connectSchema, assumeRole({ roleArn }))).toEqual([`authConfig.roleArn=${message}`]);
  });

  it.each(['arn:aws:iam::123456789012:role/Admin', 'arn:aws-cn:iam::123456789012:role/path/Admin'])(
    'accepts the role ARN %s',
    roleArn => {
      expect(issues(connectSchema, assumeRole({ roleArn }))).toEqual([]);
    }
  );

  it.each([899, 43201])('rejects the duration %s', durationSeconds => {
    expect(issues(connectSchema, assumeRole({ durationSeconds }))).toEqual([
      'authConfig.durationSeconds=V000003:900,43200',
    ]);
  });

  it.each([900, 43200])('accepts the duration %s', durationSeconds => {
    expect(issues(connectSchema, assumeRole({ durationSeconds }))).toEqual([]);
  });

  it('requires the duration when it is empty', () => {
    expect(issues(connectSchema, assumeRole({ durationSeconds: '' as never }))).toEqual([
      'authConfig.durationSeconds=V000001',
    ]);
  });

  it.each(['3600', 'abc'])('rejects the non numeric duration %j as out of range', durationSeconds => {
    expect(issues(connectSchema, assumeRole({ durationSeconds: durationSeconds as never }))).toEqual([
      'authConfig.durationSeconds=V000003:900,43200',
    ]);
  });

  it('reports every problem in one pass, including the duration', () => {
    const values = assumeRole(
      { roleArn: 'nope', durationSeconds: '' as never, mfaSerial: 'arn:mfa', sourceType: 'static' },
      { region: '', accessKey: '', secretKey: '' }
    );

    expect(issues(connectSchema, values).sort()).toEqual(
      [
        'accessKey=V000001',
        'authConfig.durationSeconds=V000001',
        'authConfig.roleArn=V000004',
        'mfaCode=V000001',
        'region=V000001',
        'secretKey=V000001',
      ].sort()
    );
  });

  it('reports the missing profile name together with the duration', () => {
    const values = assumeRole({ sourceType: 'profile', durationSeconds: 10 }, { region: '' });

    expect(issues(connectSchema, values).sort()).toEqual(
      ['authConfig.durationSeconds=V000003:900,43200', 'authConfig.profileName=V000001', 'region=V000001'].sort()
    );
  });

  it('with access keys, needs the access key to save and the secret key to connect', () => {
    expect(issues(profileSchema, assumeRole({}, { accessKey: '', secretKey: '' }))).toEqual(['accessKey=V000001']);
    expect(issues(connectSchema, assumeRole({}, { secretKey: '' }))).toEqual(['secretKey=V000001']);
  });

  it('with an AWS CLI profile, needs the profile name instead of keys', () => {
    const keys = { accessKey: '', secretKey: '' };
    expect(issues(connectSchema, assumeRole({ sourceType: 'profile' }, keys))).toEqual([
      'authConfig.profileName=V000001',
    ]);
    expect(issues(connectSchema, assumeRole({ sourceType: 'profile', profileName: 'dev' }, keys))).toEqual([]);
  });

  it('needs the MFA code to connect but not to save, and only with an MFA device', () => {
    const withMfa = { mfaSerial: 'arn:aws:iam::123456789012:mfa/me' };
    expect(issues(connectSchema, assumeRole(withMfa))).toEqual(['mfaCode=V000001']);
    expect(issues(connectSchema, assumeRole(withMfa, { mfaCode: '123456' }))).toEqual([]);
    expect(issues(profileSchema, assumeRole(withMfa))).toEqual([]);
    expect(issues(connectSchema, assumeRole())).toEqual([]);
  });
});

describe('toFormValues', () => {
  const defaults = getDefaultConnectionInfo('default name');

  it('falls back to the defaults for a nearly empty profile', () => {
    expect(
      toFormValues(defaults, { pathStyle: false, autoConnect: false } as unknown as ConnectionProfileOutput)
    ).toEqual(defaults);
  });

  it('copies the saved fields, never the secrets, and keeps the defaults of the unsaved config', () => {
    const profile = {
      name: 'saved',
      color: '#ff0000',
      provider: 'minio',
      endpoint: 'http://m',
      region: 'r',
      accessKey: 'AK',
      pathStyle: true,
      autoConnect: true,
      savedSecrets: ['secretKey'],
      authType: 'assumeRole',
      authConfig: { roleArn: 'arn:x', externalId: undefined, profileName: null } as never,
    } as unknown as ConnectionProfileOutput;

    const values = toFormValues(defaults, profile);

    expect(values).toMatchObject({
      name: 'saved',
      color: '#ff0000',
      provider: 'minio',
      endpoint: 'http://m',
      region: 'r',
      accessKey: 'AK',
      secretKey: '',
      pathStyle: true,
      autoConnect: true,
      savePassword: true,
      authType: 'assumeRole',
    });
    expect(values.authConfig).toEqual({ ...defaults.authConfig, roleArn: 'arn:x' });
  });

  it('turns savePassword off without saved secrets and treats an empty authType as static', () => {
    const values = toFormValues(defaults, { authType: '', savedSecrets: [] } as unknown as ConnectionProfileOutput);
    expect(values.savePassword).toBe(false);
    expect(values.authType).toBe('static');
  });
});

describe('toConnectionInput', () => {
  it('keeps the keys and the trimmed session token of a static profile, and drops the config', () => {
    const values = make({
      endpoint: 'http://e',
      mfaCode: '123456',
      authSecret: { sessionToken: ' tok ' },
      authConfig: { profileName: 'left-over', roleArn: 'left-over' },
    });

    const input = toConnectionInput(values, 'id1', 4);

    expect(input).toMatchObject({
      id: 'id1',
      version: 4,
      name: 'p',
      endpoint: 'http://e',
      region: 'us-east-1',
      accessKey: 'AK',
      secretKey: 'SK',
      authType: 'static',
      authConfig: {},
      authSecret: { sessionToken: 'tok' },
      mfaCode: '',
    });
  });

  it('keeps only the sharedProfile config fields, trimmed and without empty ones, and no keys or token', () => {
    const values = make({
      authType: 'sharedProfile',
      authSecret: { sessionToken: 'tok' },
      authConfig: { profileName: ' dev ', configFile: ' c ', credentialsFile: '', roleArn: 'x' },
    });

    const input = toConnectionInput(values, 'id', 1);

    expect(input.authConfig).toEqual({ profileName: 'dev', configFile: 'c' });
    expect(input).toMatchObject({ accessKey: '', secretKey: '', authSecret: {}, mfaCode: '' });
  });

  it('does not send the credentials file for sso', () => {
    const values = make({
      authType: 'sso',
      authConfig: { profileName: 'dev', configFile: '', credentialsFile: 'cred' },
    });

    expect(toConnectionInput(values, 'id', 1).authConfig).toEqual({ profileName: 'dev' });
  });

  it('sends nothing but the common fields for the default chain', () => {
    const input = toConnectionInput(make({ authType: 'defaultChain', mfaCode: '1' }), 'id', 1);
    expect(input).toMatchObject({ authConfig: {}, accessKey: '', secretKey: '', authSecret: {}, mfaCode: '' });
  });

  it('keeps the role config and the keys of an assume role profile with access keys, without a session token', () => {
    const values = assumeRole(
      { externalId: ' ext ', sessionName: '', durationSeconds: 1800, mfaSerial: '', profileName: 'ignored' },
      { authSecret: { sessionToken: 'tok' }, mfaCode: '123456' }
    );

    const input = toConnectionInput(values, 'id', 1);

    expect(input.authConfig).toEqual({
      sourceType: 'static',
      roleArn: 'arn:aws:iam::123456789012:role/Admin',
      externalId: 'ext',
      durationSeconds: 1800,
    });
    expect(input).toMatchObject({ accessKey: 'AK', secretKey: 'SK', authSecret: {}, mfaCode: '' });
  });

  it('adds the profile name and drops the keys when the role is assumed from an AWS CLI profile', () => {
    const input = toConnectionInput(assumeRole({ sourceType: 'profile', profileName: 'dev' }), 'id', 1);

    expect(input.authConfig).toMatchObject({ sourceType: 'profile', profileName: 'dev' });
    expect(input).toMatchObject({ accessKey: '', secretKey: '' });
  });

  it('never sends the MFA code when saving a profile', () => {
    const withMfa = assumeRole({ mfaSerial: 'arn:mfa' }, { mfaCode: '123456' });
    expect(toConnectionInput(withMfa, 'id', 1, false).mfaCode).toBe('');
  });

  it('sends the MFA code only when an MFA device is set', () => {
    const withMfa = assumeRole({ mfaSerial: 'arn:mfa' }, { mfaCode: '123456' });
    expect(toConnectionInput(withMfa, 'id', 1)).toMatchObject({
      mfaCode: '123456',
      authConfig: expect.objectContaining({ mfaSerial: 'arn:mfa' }),
    });
  });
});
