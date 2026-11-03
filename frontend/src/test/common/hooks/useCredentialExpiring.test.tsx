import { renderHook } from '@testing-library/react';
import { LoginMinioOidc, ReauthConnection } from '@wails/S3Browser/internal/handlers/buckethandler';
import type { CredentialExpiringOutput } from '@wails/S3Browser/models';
import { Events } from '@wailsio/runtime';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  onCredentialExpiring,
  reauthConnection,
  reloginOidc,
  useCredentialExpiring,
} from '@/common/hooks/useCredentialExpiring';
import { useProfileStore } from '@/common/stores/profileStore';
import { callIPC } from '@/common/utils/ipcUtils';
import { showMfaCodeModal } from '@/components/modals/lazyModals';
import i18n from '@/locales/i18n';

vi.mock('sonner', () => ({ toast: { warning: vi.fn() } }));
vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));
vi.mock('@wails/S3Browser/internal/handlers/buckethandler', () => ({
  LoginMinioOidc: vi.fn(),
  ReauthConnection: vi.fn(),
}));
vi.mock('@/components/modals/lazyModals', () => ({ showMfaCodeModal: vi.fn() }));

const event = (patch: Partial<CredentialExpiringOutput> = {}) =>
  ({
    connectionId: 'c1',
    profileName: 'Prod',
    authType: 'assumeRole',
    expiresAt: '2026-10-31T10:20:30',
    ...patch,
  }) as CredentialExpiringOutput;

type ToastOptions = {
  id: string;
  duration: number;
  description: string;
  action?: { label: string; onClick: () => void };
};
const lastToast = () => {
  const [title, options] = vi.mocked(toast.warning).mock.calls.at(-1) as unknown as [string, ToastOptions];
  return { title, options };
};

describe('reauthConnection', () => {
  it('asks the backend to sign in again with what the profile saved', async () => {
    vi.mocked(callIPC).mockResolvedValue({ isConnected: true } as never);

    await expect(reauthConnection('c1')).resolves.toEqual({ isConnected: true });

    expect(callIPC).toHaveBeenCalledExactlyOnceWith(ReauthConnection, ['c1', { authConfig: {}, authSecret: {} }]);
  });
});

describe('reloginOidc', () => {
  const authConfig = { clientId: 'cid', issuerUrl: 'https://idp' };

  beforeEach(() => {
    useProfileStore.setState({ connectionProfiles: { c1: { id: 'c1', authConfig } as never } });
  });

  it('does nothing for a profile that is not loaded', async () => {
    await reloginOidc('unknown');

    expect(callIPC).not.toHaveBeenCalled();
  });

  it.each([
    ['null', null],
    ['a login without session', { sessionId: '' }],
  ])('does not renew when the sign-in returns %s', async (_n, login) => {
    vi.mocked(callIPC).mockResolvedValue(login as never);

    await reloginOidc('c1');

    expect(callIPC).toHaveBeenCalledExactlyOnceWith(LoginMinioOidc, [authConfig]);
  });

  it('renews the credentials with the new sign-in', async () => {
    vi.mocked(callIPC)
      .mockResolvedValueOnce({ sessionId: 's1' } as never)
      .mockResolvedValueOnce(null as never);

    await reloginOidc('c1');

    expect(callIPC).toHaveBeenCalledTimes(2);
    expect(callIPC).toHaveBeenNthCalledWith(1, LoginMinioOidc, [authConfig]);
    expect(callIPC).toHaveBeenNthCalledWith(2, ReauthConnection, [
      'c1',
      { oidcSessionId: 's1', authConfig: {}, authSecret: {} },
    ]);
  });

  describe('while a sign-in runs', () => {
    // Every started sign-in is finished in afterEach, so the module-level set never leaks into another test.
    const pending: Array<(login: unknown) => void> = [];
    const hold = () =>
      vi.mocked(callIPC).mockImplementationOnce(
        (() =>
          new Promise(resolve => {
            pending.push(resolve);
          })) as never
      );

    afterEach(async () => {
      for (const settle of pending.splice(0)) settle(null);
      await Promise.resolve();
      await Promise.resolve();
    });

    it('ignores a second click on the same connection and signs in again once the first is over', async () => {
      hold();
      const first = reloginOidc('c1');
      await reloginOidc('c1');

      expect(callIPC).toHaveBeenCalledExactlyOnceWith(LoginMinioOidc, [authConfig]);

      pending[0](null);
      await first;
      vi.mocked(callIPC).mockResolvedValueOnce(null as never);
      await reloginOidc('c1');

      expect(callIPC).toHaveBeenCalledTimes(2);
    });

    it('can sign in again after the previous one threw', async () => {
      vi.mocked(callIPC).mockRejectedValueOnce(new Error('boom'));
      await expect(reloginOidc('c1')).rejects.toThrow('boom');
      vi.mocked(callIPC).mockResolvedValueOnce(null as never);

      await reloginOidc('c1');

      expect(callIPC).toHaveBeenCalledTimes(2);
    });

    it('can sign in again after the renewal finished', async () => {
      vi.mocked(callIPC)
        .mockResolvedValueOnce({ sessionId: 's1' } as never)
        .mockResolvedValueOnce(null as never);
      await reloginOidc('c1');
      vi.mocked(callIPC).mockResolvedValueOnce(null as never);

      await reloginOidc('c1');

      expect(callIPC).toHaveBeenCalledTimes(3);
    });

    it('keeps the connections independent', async () => {
      useProfileStore.setState({
        connectionProfiles: { c1: { id: 'c1', authConfig } as never, c2: { id: 'c2', authConfig } as never },
      });
      hold();
      void reloginOidc('c1');
      hold();
      void reloginOidc('c2');
      await reloginOidc('c2');

      expect(callIPC).toHaveBeenCalledTimes(2);
      expect(callIPC).toHaveBeenCalledWith(LoginMinioOidc, [authConfig]);
    });
  });
});

describe('onCredentialExpiring', () => {
  beforeEach(() => {
    vi.mocked(callIPC).mockResolvedValue(null as never);
  });

  it('opens the MFA code modal for assumeRole, without any toast', () => {
    onCredentialExpiring(event());

    expect(showMfaCodeModal).toHaveBeenCalledExactlyOnceWith({ connectionId: 'c1', profileName: 'Prod' });
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('toasts the login command with the AWS profile for sso, and keeps the toast open', () => {
    onCredentialExpiring(event({ authType: 'sso', awsProfile: 'dev' }));

    const { title, options } = lastToast();
    expect(title).toBe(i18n.t('credentialExpiring:sso.title', { name: 'Prod' }));
    expect(options).toMatchObject({
      id: 'credential-expiring-c1',
      duration: Infinity,
      description: i18n.t('credentialExpiring:sso.description', { command: 'aws sso login --profile dev' }),
    });
    expect(options.action?.label).toBe(i18n.t('credentialExpiring:sso.reconnect'));
    expect(showMfaCodeModal).not.toHaveBeenCalled();
  });

  it('uses the plain login command for sso when the AWS profile is unknown', () => {
    onCredentialExpiring(event({ authType: 'sso' }));

    expect(lastToast().options.description).toBe(
      i18n.t('credentialExpiring:sso.description', { command: 'aws sso login' })
    );
  });

  it('reconnects through the backend when the sso toast action is clicked', () => {
    onCredentialExpiring(event({ authType: 'sso', awsProfile: 'dev' }));

    lastToast().options.action?.onClick();

    expect(callIPC).toHaveBeenCalledExactlyOnceWith(ReauthConnection, ['c1', { authConfig: {}, authSecret: {} }]);
  });

  it.each(['static', 'minioLdap', ''])('toasts the expiry time without an action for %j', authType => {
    onCredentialExpiring(event({ authType }));

    const { title, options } = lastToast();
    expect(title).toBe(i18n.t('credentialExpiring:other.title', { name: 'Prod' }));
    expect(options).toMatchObject({ id: 'credential-expiring-c1', duration: Infinity });
    expect(options.description).toBe(i18n.t('credentialExpiring:other.description', { time: '31-10-2026 10:20:30' }));
    expect(options.action).toBeUndefined();
    expect(showMfaCodeModal).not.toHaveBeenCalled();
  });
});

describe('onCredentialExpiring minioOidc', () => {
  it('toasts the expiry time with a button to sign in again', () => {
    onCredentialExpiring(event({ authType: 'minioOidc' }));

    const { title, options } = lastToast();
    expect(title).toBe(i18n.t('credentialExpiring:oidc.title', { name: 'Prod' }));
    expect(options).toMatchObject({
      id: 'credential-expiring-c1',
      duration: Infinity,
      description: i18n.t('credentialExpiring:oidc.description', { time: '31-10-2026 10:20:30' }),
    });
    expect(options.action?.label).toBe(i18n.t('credentialExpiring:oidc.relogin'));
    expect(showMfaCodeModal).not.toHaveBeenCalled();
  });

  it('signs in again when the button is clicked', () => {
    useProfileStore.setState({ connectionProfiles: { c1: { id: 'c1', authConfig: { clientId: 'x' } } as never } });
    vi.mocked(callIPC).mockResolvedValue(null as never);
    onCredentialExpiring(event({ authType: 'minioOidc' }));

    lastToast().options.action?.onClick();

    expect(callIPC).toHaveBeenCalledExactlyOnceWith(LoginMinioOidc, [{ clientId: 'x' }]);
  });
});

describe('useCredentialExpiring', () => {
  const unsubscribe = vi.fn();

  beforeEach(() => {
    vi.mocked(Events.On).mockReturnValue(unsubscribe);
  });

  it('subscribes once to the event and unsubscribes on unmount', () => {
    const { rerender, unmount } = renderHook(() => useCredentialExpiring());
    rerender();

    expect(Events.On).toHaveBeenCalledExactlyOnceWith('bucket:credential-expiring', expect.any(Function));
    expect(unsubscribe).not.toHaveBeenCalled();

    unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('handles the payload of the event', () => {
    renderHook(() => useCredentialExpiring());
    const listener = vi.mocked(Events.On).mock.calls[0][1] as unknown as (e: { data: unknown }) => void;

    listener({ data: event() });

    expect(showMfaCodeModal).toHaveBeenCalledExactlyOnceWith({ connectionId: 'c1', profileName: 'Prod' });
  });
});
