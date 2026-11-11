import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginMinioOidc } from '@wails/S3Browser/internal/handlers/buckethandler';
import dayjs from 'dayjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callIPC } from '@/common/utils/ipcUtils';
import AuthOidcFields from '@/pages/s3/modals/connect/fields/AuthOidcFields';
import { Harness, input, type Patch, type Probe, starred, values } from '@/test/_helpers/authFieldsHarness';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

vi.mock('@wails/S3Browser/internal/handlers/buckethandler', () => ({ LoginMinioOidc: vi.fn() }));
vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));

const callIPCMock = vi.mocked(callIPC);
const flush = () => act(async () => {});

/** A sign-in the test settles by hand. */
const pendingLogin = () => {
  let settle!: (output: unknown) => void;
  const promise = new Promise(resolve => {
    settle = resolve;
  });
  callIPCMock.mockReturnValue(promise as never);
  return settle;
};

const ISSUER = 'https://idp.example.com';

describe('AuthOidcFields', () => {
  let unmount: () => void;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], now: new Date('2026-11-01T10:00:00') });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const setup = (authConfig: Patch['authConfig'] = {}, rest: Patch = {}) => {
    const probe: Probe = {};
    ({ unmount } = renderWithProviders(
      <Harness
        initial={values({
          authType: 'minioOidc',
          ...rest,
          authConfig: { clientId: 'cid', issuerUrl: ISSUER, ...authConfig },
        })}
        probe={probe}
      >
        {form => <AuthOidcFields form={form} />}
      </Harness>
    ));
    return probe;
  };

  const loginButton = () => screen.getByRole('button', { name: 'Sign in' });
  const click = async (el: HTMLElement) => {
    fireEvent.click(el);
    await flush();
  };
  const login = (sessionId = 'sess', expiresAt = '2026-11-01T11:00:00') => ({ sessionId, expiresAt });

  it('shows the provider settings and not signed in', () => {
    setup({ callbackPort: 48765 });

    expect(starred(input(/Client ID/))).toBe(true);
    expect(starred(input(/Issuer URL/))).toBe(true);
    expect(input(/Issuer URL/)).toHaveAttribute('placeholder', 'https://idp.example.com/realms/main');
    expect(input(/Scope/)).toHaveAttribute('placeholder', 'Default: openid');
    expect(input(/Role ARN \(optional\)/)).toBeInTheDocument();
    expect(input(/Callback port/)).toHaveValue('48765');
    expect(screen.getByText('Not signed in')).toBeInTheDocument();
    expect(screen.queryByText(/Waiting for the sign-in/)).not.toBeInTheDocument();
  });

  it.each([
    ['the default port', 48765, 'http://127.0.0.1:48765/callback'],
    ['a typed port', 50000, 'http://127.0.0.1:50000/callback'],
    ['an empty port, falling back to the default', '', 'http://127.0.0.1:48765/callback'],
  ])('shows the redirect URI for %s', (_n, callbackPort, expected) => {
    setup({ callbackPort: callbackPort as never });

    expect(input(/Redirect URI/)).toHaveValue(expected);
    expect(input(/Redirect URI/)).toHaveAttribute('readonly');
  });

  it('copies the redirect URI', async () => {
    vi.useRealTimers();
    setup();
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    await user.click(screen.getByRole('button', { name: 'Copy' }));

    expect(await navigator.clipboard.readText()).toBe('http://127.0.0.1:48765/callback');
  });

  it.each([
    ['client id', { clientId: '' }],
    ['issuer URL', { issuerUrl: '' }],
    ['client id of spaces', { clientId: '   ' }],
    ['issuer URL of spaces', { issuerUrl: '  ' }],
  ])('disables the sign-in button without the %s', (_n, config) => {
    setup(config);

    expect(loginButton()).toBeDisabled();
  });

  it('enables the sign-in button once both settings are typed', () => {
    setup({ clientId: '', issuerUrl: '' });
    expect(loginButton()).toBeDisabled();

    fireEvent.change(input(/Client ID/), { target: { value: 'cid' } });
    expect(loginButton()).toBeDisabled();
    fireEvent.change(input(/Issuer URL/), { target: { value: ISSUER } });

    expect(loginButton()).toBeEnabled();
  });

  it('signs in with the trimmed settings and keeps the session id and the expiry', async () => {
    const settle = pendingLogin();
    const probe = setup({ clientId: ' cid ', issuerUrl: ` ${ISSUER} `, scope: ' openid ', roleArn: ' arn:x ' });
    probe.form?.setFieldError('oidcSessionId', 'V000001');

    await click(loginButton());

    expect(callIPCMock).toHaveBeenCalledExactlyOnceWith(
      LoginMinioOidc,
      [{ clientId: 'cid', issuerUrl: ISSUER, scope: 'openid', roleArn: 'arn:x', callbackPort: 48765 }],
      { signal: expect.any(AbortSignal) }
    );
    expect(screen.getByText('Waiting for the sign-in in your browser...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel sign-in' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();

    settle(login('sess', '2026-11-01T11:30:00'));
    await flush();

    expect(probe.form?.getValues().oidcSessionId).toBe('sess');
    expect(probe.form?.errors.oidcSessionId).toBeUndefined();
    expect(screen.getByText('Signed in, valid until 11:30')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('leaves the port out when it is empty', async () => {
    pendingLogin();
    setup({ callbackPort: '' as never });

    await click(loginButton());

    const [, [config]] = callIPCMock.mock.calls[0] as unknown as [unknown, [{ callbackPort?: number }]];
    expect(config.callbackPort).toBeUndefined();
  });

  it.each([
    ['null (failed or canceled)', null],
    ['an empty session id', { sessionId: '', expiresAt: '2026-11-01T11:00:00' }],
  ])('goes back to not signed in when the sign-in returns %s', async (_n, output) => {
    callIPCMock.mockResolvedValue(output as never);
    const probe = setup();

    await click(loginButton());

    expect(screen.getByText('Not signed in')).toBeInTheDocument();
    expect(probe.form?.getValues().oidcSessionId).toBe('');
  });

  it('cancels a sign-in that waits for the browser', async () => {
    pendingLogin();
    setup();
    await click(loginButton());
    const signal = (callIPCMock.mock.calls[0][2] as { signal: AbortSignal }).signal;
    expect(signal.aborted).toBe(false);

    // The user must be able to press it while the sign-in is pending.
    const cancel = screen.getByRole('button', { name: 'Cancel sign-in' });
    expect(cancel).toBeEnabled();
    await click(cancel);

    expect(signal.aborted).toBe(true);
    // The aborted call is still pending, yet Cancel resets the status at once.
    expect(screen.getByText('Not signed in')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('cancels the sign-in when the fields go away', async () => {
    pendingLogin();
    setup();
    await click(loginButton());
    const signal = (callIPCMock.mock.calls[0][2] as { signal: AbortSignal }).signal;
    expect(signal.aborted).toBe(false);

    unmount();

    expect(signal.aborted).toBe(true);
  });

  it('unmounts cleanly when no sign-in was started', () => {
    setup();

    expect(() => unmount()).not.toThrow();
  });

  it('forgets the sign-in when it expires', async () => {
    callIPCMock.mockResolvedValue(login('sess', '2026-11-01T10:00:30') as never);
    const probe = setup();
    await click(loginButton());
    expect(probe.form?.getValues().oidcSessionId).toBe('sess');

    await act(async () => {
      vi.advanceTimersByTime(29_000);
    });
    expect(probe.form?.getValues().oidcSessionId).toBe('sess');
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });

    expect(probe.form?.getValues().oidcSessionId).toBe('');
    expect(screen.getByText('The sign-in has expired, sign in again')).toBeInTheDocument();
  });

  it('expires at once when the sign-in is already over', async () => {
    callIPCMock.mockResolvedValue(login('sess', '2026-11-01T09:00:00') as never);
    const probe = setup();

    await click(loginButton());
    await act(async () => {
      vi.advanceTimersByTime(0);
    });

    expect(probe.form?.getValues().oidcSessionId).toBe('');
    expect(screen.getByText('The sign-in has expired, sign in again')).toBeInTheDocument();
  });

  it('does not expire a sign-in that was dropped by a settings change', async () => {
    callIPCMock.mockResolvedValue(login() as never);
    const probe = setup();
    await click(loginButton());

    fireEvent.change(input(/Client ID/), { target: { value: 'other' } });
    await flush();
    await act(async () => {
      vi.advanceTimersByTime(3_600_000);
    });

    expect(screen.getByText('Not signed in')).toBeInTheDocument();
    expect(probe.form?.getValues().oidcSessionId).toBe('');
  });

  it.each([
    ['Client ID', 'other'],
    ['Issuer URL', 'https://other.example.com'],
    ['Scope', 'groups'],
    ['Role ARN \\(optional\\)', 'arn:aws:iam::1:role/x'],
  ])('drops the sign-in when the %s changes', async (label, value) => {
    callIPCMock.mockResolvedValue(login() as never);
    const probe = setup();
    await click(loginButton());
    expect(screen.getByText(/Signed in, valid until/)).toBeInTheDocument();

    fireEvent.change(input(new RegExp(label)), { target: { value } });
    await flush();

    expect(probe.form?.getValues().oidcSessionId).toBe('');
    expect(screen.getByText('Not signed in')).toBeInTheDocument();
  });

  it('drops the sign-in when the callback port changes', async () => {
    callIPCMock.mockResolvedValue(login() as never);
    const probe = setup();
    await click(loginButton());

    fireEvent.change(input(/Callback port/), { target: { value: '50000' } });
    await flush();

    expect(probe.form?.getValues().oidcSessionId).toBe('');
    expect(screen.getByText('Not signed in')).toBeInTheDocument();
  });

  it.each([
    ['Client ID', 'other'],
    ['Issuer URL', 'https://other.example.com'],
    ['Scope', 'groups'],
    ['Role ARN \\(optional\\)', 'arn:aws:iam::1:role/x'],
    ['Callback port', '50000'],
  ])('cancels the pending sign-in when the %s changes', async (label, value) => {
    pendingLogin();
    const probe = setup();
    await click(loginButton());
    const signal = (callIPCMock.mock.calls[0][2] as { signal: AbortSignal }).signal;
    expect(signal.aborted).toBe(false);

    fireEvent.change(input(new RegExp(label)), { target: { value } });
    await flush();

    expect(signal.aborted).toBe(true);
    expect(probe.form?.getValues().oidcSessionId).toBe('');
    expect(screen.getByText('Not signed in')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel sign-in' })).not.toBeInTheDocument();
    expect(loginButton()).toBeEnabled();
  });

  it('signs in again after a pending sign-in was canceled by a settings change', async () => {
    callIPCMock.mockReturnValueOnce(new Promise(() => {}) as never);
    const probe = setup();
    await click(loginButton());
    fireEvent.change(input(/Client ID/), { target: { value: 'other' } });
    await flush();
    callIPCMock.mockResolvedValueOnce(login('second') as never);

    await click(loginButton());

    const [, [config], options] = callIPCMock.mock.calls[1] as unknown as [
      unknown,
      [{ clientId: string }],
      { signal: AbortSignal },
    ];
    expect(config.clientId).toBe('other');
    expect(options.signal.aborted).toBe(false);
    expect((callIPCMock.mock.calls[0][2] as { signal: AbortSignal }).signal).not.toBe(options.signal);
    expect(probe.form?.getValues().oidcSessionId).toBe('second');
    expect(screen.getByText(/Signed in, valid until/)).toBeInTheDocument();
  });

  it('signs in a second time after a canceled one', async () => {
    // Like the real callIPC: a canceled call settles with null.
    callIPCMock.mockImplementationOnce(
      ((_b: unknown, _a: unknown, o: { signal: AbortSignal }) =>
        new Promise(resolve => o.signal.addEventListener('abort', () => resolve(null)))) as never
    );
    const probe = setup();
    await click(loginButton());
    await click(screen.getByRole('button', { name: 'Cancel sign-in' }));
    expect(screen.getByText('Not signed in')).toBeInTheDocument();
    callIPCMock.mockResolvedValueOnce(login('again') as never);

    await click(loginButton());

    expect(callIPCMock).toHaveBeenCalledTimes(2);
    expect(probe.form?.getValues().oidcSessionId).toBe('again');
    expect(screen.getByText(/Signed in, valid until/)).toBeInTheDocument();
  });

  it('keeps the new sign-in waiting when the canceled one settles late', async () => {
    let settleFirst!: (output: unknown) => void;
    callIPCMock.mockReturnValueOnce(new Promise(resolve => (settleFirst = resolve)) as never);
    setup();
    await click(loginButton());
    fireEvent.change(input(/Client ID/), { target: { value: 'other' } });
    await flush();
    callIPCMock.mockReturnValueOnce(new Promise(() => {}) as never);
    await click(loginButton());

    settleFirst(null);
    await flush();

    expect(screen.getByText('Waiting for the sign-in in your browser...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel sign-in' })).toBeInTheDocument();
  });

  it('aborts the previous sign-in when the fields go away after a second one started', async () => {
    callIPCMock.mockReturnValue(new Promise(() => {}) as never);
    setup();
    await click(loginButton());
    fireEvent.change(input(/Client ID/), { target: { value: 'other' } });
    await flush();
    await click(loginButton());
    const signal = (callIPCMock.mock.calls[1][2] as { signal: AbortSignal }).signal;

    unmount();

    expect(signal.aborted).toBe(true);
  });

  it('keeps the shown state when a setting changes without a sign-in', async () => {
    const probe = setup();

    fireEvent.change(input(/Client ID/), { target: { value: 'other' } });
    await flush();

    expect(screen.getByText('Not signed in')).toBeInTheDocument();
    expect(probe.form?.getValues().oidcSessionId).toBe('');
  });

  it('shows the validation error of the sign-in', async () => {
    const probe = setup();

    act(() => probe.form?.setFieldError('oidcSessionId', 'V000001'));

    expect(screen.getByText('Sign-in is required')).toBeInTheDocument();
  });

  it('shows no error by default', () => {
    setup();

    expect(screen.queryByText(/is required/)).not.toBeInTheDocument();
  });

  it('formats the expiry time with the local clock', async () => {
    callIPCMock.mockResolvedValue(login('s', '2026-11-01T23:05:00') as never);
    setup();

    await click(loginButton());

    expect(
      screen.getByText(`Signed in, valid until ${dayjs('2026-11-01T23:05:00').format('HH:mm')}`)
    ).toBeInTheDocument();
  });
});
