import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callIPC } from '@/common/utils/ipcUtils';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn() },
}));
// Labels and the message template are translated; everything else echoes its key.
vi.mock('@/locales/i18n', () => ({
  default: {
    t: (key: string) =>
      ({
        'ipcMessage:bucket.S3E046': '{secret} is required for {name}',
        'connectModal:form.label.mfaCode': 'MFA code',
        'connectModal:form.label.secretKey': 'Secret key',
        'connectModal:form.label.ldapPassword': 'LDAP password',
        'connectModal:form.label.keyPassword': 'Private key password',
        'connectModal:form.label.oidcSession': 'Sign-in',
      })[key] ?? key,
  },
}));

const show = async (params: unknown, moduleName = 'bucket', messageCode: string | null = 'S3E046') => {
  const output = {
    result: true,
    body: 1,
    messageList: [{ messageType: 'E', moduleName, messageCode, params }],
  } as never;
  await callIPC(vi.fn().mockResolvedValue(output), [] as never);
  return vi.mocked(toast.error).mock.calls.at(-1)?.[0];
};

describe('callIPC message params', () => {
  beforeEach(() => {
    vi.mocked(toast.error).mockClear();
  });

  it.each([
    ['mfaCode', 'MFA code is required for Prod'],
    ['secretKey', 'Secret key is required for Prod'],
    ['ldapPassword', 'LDAP password is required for Prod'],
    ['keyPassword', 'Private key password is required for Prod'],
    ['oidcSession', 'Sign-in is required for Prod'],
  ])('shows the label of the technical secret name %s', async (secret, expected) => {
    expect(await show({ secret, name: 'Prod' })).toBe(expected);
  });

  it('keeps an unknown secret name as it is', async () => {
    expect(await show({ secret: 'sessionToken', name: 'Prod' })).toBe('sessionToken is required for Prod');
  });

  it.each([
    ['another module', 'profile', 'S3E046'],
    ['another code', 'bucket', 'S3E001'],
  ])('does not translate the secret of %s', async (_name, moduleName, messageCode) => {
    expect(await show({ secret: 'secretKey', name: 'Prod' }, moduleName, messageCode)).toBe(
      `ipcMessage:${moduleName}.${messageCode}`
    );
  });

  it('copes with a message without a code', async () => {
    expect(await show({ secret: 'secretKey' }, 'bucket', null)).toBe('ipcMessage:bucket.null');
  });

  it.each([
    ['no secret param', { name: 'Prod' }, '{secret} is required for Prod'],
    ['null params', null, '{secret} is required for {name}'],
    ['undefined params', undefined, '{secret} is required for {name}'],
  ])('leaves the message alone with %s', async (_name, params, expected) => {
    expect(await show(params)).toBe(expected);
  });
});
