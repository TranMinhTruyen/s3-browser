import type { ConnectionProfileOutput } from '@wails/S3Browser/models';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE_COLOR } from '@/components/modals/modalColors';
import {
  type ConnectionInfo,
  connectSchema,
  getDefaultAuthConfig,
  getDefaultConnectionInfo,
  isSecureIssuerUrl,
  profileSchema,
  toConnectionInput,
  toFormValues,
} from '@/pages/s3/modals/connect/connectSchema';

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
    authConfig: {
      ...getDefaultAuthConfig('assumeRole'),
      roleArn: 'arn:aws:iam::123456789012:role/Admin',
      ...authConfig,
    },
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
      oidcSessionId: '',
      authType: 'static',
      authConfig: {
        profileName: '',
        configFile: '',
        credentialsFile: '',
        sourceType: 'static',
        roleArn: '',
        externalId: '',
        sessionName: '',
        durationSeconds: '',
        mfaSerial: '',
        policy: '',
        ldapUsername: '',
        clientId: '',
        issuerUrl: '',
        scope: '',
        callbackPort: 48765,
        certFile: '',
        keyFile: '',
        keyEncrypted: false,
        caFile: '',
        buckets: [],
      },
      authSecret: { sessionToken: '', ldapPassword: '', keyPassword: '' },
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
    expect(values.authConfig).toEqual({ ...getDefaultAuthConfig('assumeRole'), roleArn: 'arn:x' });
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
      authSecret: { sessionToken: ' tok ', ldapPassword: '', keyPassword: '' },
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
      authSecret: { sessionToken: 'tok', ldapPassword: '', keyPassword: '' },
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
      { authSecret: { sessionToken: 'tok', ldapPassword: '', keyPassword: '' }, mfaCode: '123456' }
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

const minio = (patch: Patch = {}) => make({ provider: 'minio', endpoint: 'http://m', ...patch });

describe('getDefaultAuthConfig', () => {
  it('defaults the duration of assumeRole to one hour and leaves it empty for the other methods', () => {
    expect(getDefaultAuthConfig('assumeRole').durationSeconds).toBe(3600);
    expect(getDefaultAuthConfig('minioAssumeRole').durationSeconds).toBe('');
    expect(getDefaultAuthConfig('minioLdap')).toMatchObject({ durationSeconds: '', policy: '', buckets: [] });
  });
});

describe('anonymous', () => {
  it('requires at least one bucket, on both providers', () => {
    expect(issues(connectSchema, make({ authType: 'anonymous' }))).toEqual(['authConfig.buckets=V000001']);
    expect(issues(profileSchema, minio({ authType: 'anonymous' }))).toEqual(['authConfig.buckets=V000001']);
  });

  it.each([
    ['connect', connectSchema],
    ['save', profileSchema],
  ])('accepts buckets without keys when it is %s', (_n, schema) => {
    const values = make({ authType: 'anonymous', accessKey: '', secretKey: '', authConfig: { buckets: ['b1'] } });
    expect(issues(schema, values)).toEqual([]);
  });

  it('still requires the endpoint on MinIO', () => {
    const values = minio({ authType: 'anonymous', endpoint: '', authConfig: { buckets: ['b1'] } });
    expect(issues(connectSchema, values)).toEqual(['endpoint=V000001']);
  });
});

describe('minioAssumeRole', () => {
  const sts = (authConfig: Partial<AuthConfig> = {}, rest: Patch = {}) =>
    minio({ authType: 'minioAssumeRole', ...rest, authConfig });

  it('accepts keys with an empty duration and policy', () => {
    expect(issues(connectSchema, sts())).toEqual([]);
  });

  it('needs the access key to save and the secret key to connect', () => {
    expect(issues(profileSchema, sts({}, { accessKey: '', secretKey: '' }))).toEqual(['accessKey=V000001']);
    expect(issues(connectSchema, sts({}, { secretKey: '' }))).toEqual(['secretKey=V000001']);
    expect(issues(profileSchema, sts({}, { secretKey: '' }))).toEqual([]);
  });

  it.each([
    ['{"Version":"2012-10-17"}', []],
    ['', []],
    ['{not json', ['authConfig.policy=V000004']],
  ])('validates the policy %j', (policy, expected) => {
    expect(issues(connectSchema, sts({ policy }))).toEqual(expected);
  });

  it.each([
    [900, []],
    [43200, []],
    [899, ['authConfig.durationSeconds=V000003:900,43200']],
    [43201, ['authConfig.durationSeconds=V000003:900,43200']],
    ['abc', ['authConfig.durationSeconds=V000003:900,43200']],
  ])('validates the duration %j', (durationSeconds, expected) => {
    expect(issues(connectSchema, sts({ durationSeconds: durationSeconds as never }))).toEqual(expected);
  });

  it('reports the policy, the duration and the secret together', () => {
    const values = sts({ policy: '{', durationSeconds: 1 }, { secretKey: '' });
    expect(issues(connectSchema, values).sort()).toEqual(
      ['authConfig.durationSeconds=V000003:900,43200', 'authConfig.policy=V000004', 'secretKey=V000001'].sort()
    );
  });
});

describe('minioLdap', () => {
  const noPassword = { sessionToken: '', ldapPassword: '', keyPassword: '' };
  const ldap = (
    authConfig: Partial<AuthConfig> = {},
    authSecret = { sessionToken: '', ldapPassword: 'pw', keyPassword: '' }
  ) =>
    minio({
      authType: 'minioLdap',
      accessKey: '',
      secretKey: '',
      authSecret,
      authConfig: { ldapUsername: 'u', ...authConfig },
    });

  it('accepts a username and a password', () => {
    expect(issues(connectSchema, ldap())).toEqual([]);
  });

  it('requires the username', () => {
    expect(issues(profileSchema, ldap({ ldapUsername: ' ' }))).toEqual(['authConfig.ldapUsername=V000001']);
  });

  it('requires the password to connect but not to save', () => {
    expect(issues(connectSchema, ldap({}, noPassword))).toEqual(['authSecret.ldapPassword=V000001']);
    expect(issues(profileSchema, ldap({}, noPassword))).toEqual([]);
  });

  it('keeps the spaces of the password', () => {
    const parsed = connectSchema.parse(ldap({}, { sessionToken: '', ldapPassword: ' pw ', keyPassword: '' }));
    expect(parsed.authSecret.ldapPassword).toBe(' pw ');
  });

  it('allows an empty duration and rejects one out of range', () => {
    expect(issues(connectSchema, ldap({ durationSeconds: '' }))).toEqual([]);
    expect(issues(connectSchema, ldap({ durationSeconds: 5 }))).toEqual([
      'authConfig.durationSeconds=V000003:900,43200',
    ]);
  });
});

describe('assumeRole duration default', () => {
  it('rejects the empty duration that getDefaultConnectionInfo leaves for the other methods', () => {
    const values = make({ authType: 'assumeRole', authConfig: { roleArn: 'arn:aws:iam::123456789012:role/Admin' } });
    expect(issues(connectSchema, values)).toEqual(['authConfig.durationSeconds=V000001']);
  });
});

describe('toFormValues for the new methods', () => {
  const defaults = getDefaultConnectionInfo('d');

  it('does not add a duration to a MinIO profile saved without one', () => {
    const profile = {
      authType: 'minioAssumeRole',
      provider: 'minio',
      authConfig: { policy: '{}' },
      savedSecrets: [],
    } as unknown as ConnectionProfileOutput;

    const values = toFormValues(defaults, profile);

    expect(values.authConfig.durationSeconds).toBe('');
    expect(values.authConfig.policy).toBe('{}');
  });

  it('keeps the saved duration and buckets', () => {
    const profile = {
      authType: 'anonymous',
      authConfig: { buckets: ['a', 'b'], durationSeconds: 1000 },
    } as unknown as ConnectionProfileOutput;

    expect(toFormValues(defaults, profile).authConfig).toMatchObject({ buckets: ['a', 'b'], durationSeconds: 1000 });
  });

  it('gives a saved assumeRole profile without duration the one hour default', () => {
    const profile = { authType: 'assumeRole', authConfig: {} } as unknown as ConnectionProfileOutput;
    expect(toFormValues(defaults, profile).authConfig.durationSeconds).toBe(3600);
  });
});

describe('toConnectionInput for the new methods', () => {
  it('sends the trimmed and de-duplicated buckets of anonymous, with no keys or secrets', () => {
    const values = make({
      authType: 'anonymous',
      authSecret: { sessionToken: 'tok', ldapPassword: 'pw', keyPassword: '' },
      authConfig: { buckets: [' a ', 'b', 'a', '  ', 'b'], policy: 'left-over' },
    });

    const input = toConnectionInput(values, 'id', 1);

    expect(input.authConfig).toEqual({ buckets: ['a', 'b'] });
    expect(input).toMatchObject({ accessKey: '', secretKey: '', authSecret: {}, mfaCode: '' });
  });

  it('keeps the keys, the policy and the duration of minioAssumeRole, and drops an empty duration', () => {
    const base = {
      authType: 'minioAssumeRole' as const,
      authSecret: { sessionToken: 't', ldapPassword: 'pw', keyPassword: '' },
    };

    const withDuration = toConnectionInput(
      minio({ ...base, authConfig: { policy: ' {} ', durationSeconds: 900 } }),
      'id',
      1
    );
    const without = toConnectionInput(minio({ ...base, authConfig: { ldapUsername: 'x' } }), 'id', 1);

    expect(withDuration.authConfig).toEqual({ policy: '{}', durationSeconds: 900 });
    expect(withDuration).toMatchObject({ accessKey: 'AK', secretKey: 'SK', authSecret: {} });
    expect(without.authConfig).toEqual({});
  });

  it('sends the LDAP user, the untrimmed password and no keys for minioLdap', () => {
    const values = minio({
      authType: 'minioLdap',
      authSecret: { sessionToken: 'tok', ldapPassword: ' pw ', keyPassword: '' },
      authConfig: { ldapUsername: ' bob ', durationSeconds: 1000, policy: 'left-over' },
    });

    const input = toConnectionInput(values, 'id', 1);

    expect(input.authConfig).toEqual({ ldapUsername: 'bob', durationSeconds: 1000 });
    expect(input).toMatchObject({
      accessKey: '',
      secretKey: '',
      authSecret: { ldapPassword: ' pw ' },
      mfaCode: '',
    });
  });

  it('sends the LDAP password only with minioLdap', () => {
    const others = (['static', 'minioAssumeRole', 'anonymous', 'sso'] as const).map(authType =>
      toConnectionInput(
        make({ authType, authSecret: { sessionToken: '', ldapPassword: 'pw', keyPassword: '' } }),
        'id',
        1
      )
    );
    for (const input of others) expect(input.authSecret).not.toHaveProperty('ldapPassword');
  });
});

describe('minioOidc', () => {
  const oidc = (authConfig: Partial<AuthConfig> = {}, rest: Patch = {}) =>
    minio({
      authType: 'minioOidc',
      accessKey: '',
      secretKey: '',
      oidcSessionId: 'sess',
      ...rest,
      authConfig: { clientId: 'cid', issuerUrl: 'https://idp.example.com/realms/main', ...authConfig },
    });

  it('accepts the provider settings with a sign-in', () => {
    expect(issues(connectSchema, oidc())).toEqual([]);
  });

  it('requires the client id and the issuer URL', () => {
    expect(issues(profileSchema, oidc({ clientId: ' ', issuerUrl: '' }))).toEqual([
      'authConfig.clientId=V000001',
      'authConfig.issuerUrl=V000001',
    ]);
  });

  it.each([
    ['https://idp.example.com', []],
    ['http://localhost:8080/realms/x', []],
    ['HTTPS://IDP.example.com', []],
    ['HTTPS://Idp.com/realm', []],
    ['http://localhost', []],
    ['http://LOCALHOST:8080/x', []],
    ['http://127.0.0.1:9000', []],
    ['http://127.5.5.5', []],
    ['http://[::1]:8080', []],
    ['http://example.com', ['authConfig.issuerUrl=V000004']],
    ['http://192.168.1.1', ['authConfig.issuerUrl=V000004']],
    ['http://localhost.evil.com', ['authConfig.issuerUrl=V000004']],
    ['http://127.0.0.1.evil.com', ['authConfig.issuerUrl=V000004']],
    ['ftp://idp.example.com', ['authConfig.issuerUrl=V000004']],
    ['ftp://x.com', ['authConfig.issuerUrl=V000004']],
    ['idp.example.com', ['authConfig.issuerUrl=V000004']],
    ['abc', ['authConfig.issuerUrl=V000004']],
    ['https://', ['authConfig.issuerUrl=V000004']],
    ['https://a b', ['authConfig.issuerUrl=V000004']],
    ['', ['authConfig.issuerUrl=V000001']],
  ])('validates the issuer URL %j', (issuerUrl, expected) => {
    expect(issues(connectSchema, oidc({ issuerUrl }))).toEqual(expected);
  });

  it.each([
    ['https://idp.example.com', true],
    ['http://[::1]:8080', true],
    ['http://127.5.5.5', true],
    ['http://127.0.0.1:8080', true],
    ['http://user@localhost', true],
    ['http://user:pw@127.0.0.1:9000/x', true],
    ['http://[::1]', true],
    ['http://[::1]/path', true],
    ['http://LOCALHOST', true],
    ['  http://localhost  ', true],
    ['http://localhost\\x', false],
    ['http://localhost\\@evil.com', false],
    ['http://127.0.0.1\\@evil.com', false],
    ['http://127.1', false],
    ['http://127.0.1', false],
    ['http://127.0.0.256', false],
    ['http://127.00.0.1', false],
    ['http://127.0.0.01', false],
    ['http://127.0.0.1.5', false],
    ['http://', false],
    ['http://:8080', false],
    ['http://user@', false],
    ['http://[::2]', false],
    ['ftp://localhost', false],
    ['file://localhost', false],
    ['https://example.com:8443/x', true],
    ['http://example.com', false],
    ['http://localhost.evil.com', false],
    ['https://', false],
    ['abc', false],
    ['', false],
  ])('isSecureIssuerUrl(%j) is %s', (value, expected) => {
    expect(isSecureIssuerUrl(value)).toBe(expected);
  });

  it.each([
    [1024, []],
    [65535, []],
    ['', []],
    [1023, ['authConfig.callbackPort=V000003:1024,65535']],
    [65536, ['authConfig.callbackPort=V000003:1024,65535']],
    ['80a', ['authConfig.callbackPort=V000003:1024,65535']],
  ])('validates the callback port %j', (callbackPort, expected) => {
    expect(issues(connectSchema, oidc({ callbackPort: callbackPort as never }))).toEqual(expected);
  });

  it('requires the sign-in to connect or test, but not to save a profile', () => {
    expect(issues(connectSchema, oidc({}, { oidcSessionId: '' }))).toEqual(['oidcSessionId=V000001']);
    expect(issues(connectSchema, oidc({}, { oidcSessionId: '  ' }))).toEqual(['oidcSessionId=V000001']);
    expect(issues(profileSchema, oidc({}, { oidcSessionId: '' }))).toEqual([]);
  });

  it('still requires the endpoint and the region on MinIO', () => {
    expect(issues(connectSchema, oidc({}, { endpoint: '', region: '' }))).toEqual(
      expect.arrayContaining(['endpoint=V000001', 'region=V000001'])
    );
  });
});

describe('minioCert', () => {
  const secret = (keyPassword: string) => ({ sessionToken: '', ldapPassword: '', keyPassword });
  const cert = (authConfig: Partial<AuthConfig> = {}, authSecret = secret('')) =>
    minio({
      authType: 'minioCert',
      accessKey: '',
      secretKey: '',
      authSecret,
      authConfig: { certFile: '/c.pem', keyFile: '/k.pem', ...authConfig },
    });

  it('accepts the two files without a key password', () => {
    expect(issues(connectSchema, cert())).toEqual([]);
  });

  it('requires the certificate and the key files', () => {
    expect(issues(profileSchema, cert({ certFile: ' ', keyFile: '' }))).toEqual([
      'authConfig.certFile=V000001',
      'authConfig.keyFile=V000001',
    ]);
  });

  it('requires the key password only to connect, when the key has one', () => {
    const encrypted = { keyEncrypted: true };
    expect(issues(connectSchema, cert(encrypted))).toEqual(['authSecret.keyPassword=V000001']);
    expect(issues(profileSchema, cert(encrypted))).toEqual([]);
    expect(issues(connectSchema, cert(encrypted, secret('pw')))).toEqual([]);
    expect(issues(connectSchema, cert({ keyEncrypted: false }))).toEqual([]);
  });

  it('keeps the spaces of the key password', () => {
    const parsed = connectSchema.parse(cert({ keyEncrypted: true }, secret(' pw ')));
    expect(parsed.authSecret.keyPassword).toBe(' pw ');
  });
});

describe('toFormValues for oidc and cert', () => {
  it('restores the saved settings and never a sign-in or a key password', () => {
    const profile = {
      authType: 'minioOidc',
      provider: 'minio',
      authConfig: { clientId: 'cid', issuerUrl: 'https://idp', callbackPort: 50000, caFile: '/ca.pem' },
    } as unknown as ConnectionProfileOutput;

    const values = toFormValues(getDefaultConnectionInfo('d'), profile);

    expect(values.authConfig).toMatchObject({
      clientId: 'cid',
      issuerUrl: 'https://idp',
      callbackPort: 50000,
      caFile: '/ca.pem',
    });
    expect(values.oidcSessionId).toBe('');
    expect(values.authSecret.keyPassword).toBe('');
  });
});

describe('toConnectionInput for oidc and cert', () => {
  const oidcValues = () =>
    minio({
      authType: 'minioOidc',
      oidcSessionId: 'sess',
      authConfig: {
        clientId: ' cid ',
        issuerUrl: ' https://idp ',
        scope: '',
        roleArn: 'arn:x',
        callbackPort: 50000,
        certFile: 'left-over',
        policy: 'left-over',
      },
    });

  it('sends the provider settings without empty ones, no keys, and the sign-in id', () => {
    const input = toConnectionInput(oidcValues(), 'id', 1);

    expect(input.authConfig).toEqual({
      clientId: 'cid',
      issuerUrl: 'https://idp',
      roleArn: 'arn:x',
      callbackPort: 50000,
    });
    expect(input).toMatchObject({ accessKey: '', secretKey: '', authSecret: {}, oidcSessionId: 'sess' });
  });

  it('does not send the sign-in id when saving a profile', () => {
    expect(toConnectionInput(oidcValues(), 'id', 1, false).oidcSessionId).toBe('');
  });

  it('does not send a sign-in id for another method', () => {
    const input = toConnectionInput(minio({ authType: 'minioLdap', oidcSessionId: 'sess' }), 'id', 1);
    expect(input.oidcSessionId).toBe('');
  });

  it('sends the files and the key flag of minioCert with the key password', () => {
    const values = minio({
      authType: 'minioCert',
      authSecret: { sessionToken: '', ldapPassword: '', keyPassword: ' kp ' },
      authConfig: { certFile: ' /c.pem ', keyFile: '/k.pem', keyEncrypted: true, clientId: 'left-over' },
    });

    const input = toConnectionInput(values, 'id', 1);

    expect(input.authConfig).toEqual({ certFile: '/c.pem', keyFile: '/k.pem', keyEncrypted: true });
    expect(input).toMatchObject({ accessKey: '', secretKey: '', authSecret: { keyPassword: ' kp ' } });
  });

  it.each(['static', 'anonymous', 'minioAssumeRole', 'minioLdap', 'minioOidc', 'minioCert'] as const)(
    'sends the CA file of a MinIO profile using %s',
    authType => {
      const input = toConnectionInput(minio({ authType, authConfig: { caFile: ' /ca.pem ' } }), 'id', 1);
      expect(input.authConfig).toMatchObject({ caFile: '/ca.pem' });
    }
  );

  it('never sends the CA file for AWS', () => {
    expect(toConnectionInput(make({ authConfig: { caFile: '/ca.pem' } }), 'id', 1).authConfig).toEqual({});
  });
});
