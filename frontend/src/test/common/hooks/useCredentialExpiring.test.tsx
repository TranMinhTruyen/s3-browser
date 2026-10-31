import { renderHook } from '@testing-library/react';
import { ReauthConnection } from '@wails/S3Browser/internal/handlers/buckethandler';
import type { CredentialExpiringOutput } from '@wails/S3Browser/models';
import { Events } from '@wailsio/runtime';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { onCredentialExpiring, reauthConnection, useCredentialExpiring } from '@/common/hooks/useCredentialExpiring';
import { callIPC } from '@/common/utils/ipcUtils';
import { showMfaCodeModal } from '@/components/modals/lazyModals';
import i18n from '@/locales/i18n';

vi.mock('@wailsio/runtime', () => ({ Events: { On: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { warning: vi.fn() } }));
vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));
vi.mock('@wails/S3Browser/internal/handlers/buckethandler', () => ({ ReauthConnection: vi.fn() }));
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

  it.each(['minioOidc', 'static', ''])('toasts the expiry time without an action for %j', authType => {
    onCredentialExpiring(event({ authType }));

    const { title, options } = lastToast();
    expect(title).toBe(i18n.t('credentialExpiring:other.title', { name: 'Prod' }));
    expect(options).toMatchObject({ id: 'credential-expiring-c1', duration: Infinity });
    expect(options.description).toBe(i18n.t('credentialExpiring:other.description', { time: '31-10-2026 10:20:30' }));
    expect(options.action).toBeUndefined();
    expect(showMfaCodeModal).not.toHaveBeenCalled();
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
