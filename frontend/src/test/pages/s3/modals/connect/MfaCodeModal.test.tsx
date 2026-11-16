import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReauthConnection } from '@wails/S3Browser/internal/handlers/buckethandler';
import type { ConnectionProfileOutput } from '@wails/S3Browser/models';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useModalStackStore } from '@/common/stores/modalStackStore';
import { callIPC } from '@/common/utils/ipcUtils';
import MfaCodeModal from '@/pages/s3/modals/connect/MfaCodeModal';
import { useProfileStore } from '@/pages/s3/stores/profileStore';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

vi.mock('@wails/S3Browser/internal/handlers/buckethandler', () => ({ ReauthConnection: vi.fn() }));
vi.mock('@wails/S3Browser/internal/handlers/profilehandler', () => ({ GetAllConnectionProfile: vi.fn() }));
vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));

const callIPCMock = vi.mocked(callIPC);
const flush = () => act(async () => {});

const profile = (extra: Partial<ConnectionProfileOutput> = {}) =>
  ({
    id: 'c1',
    name: 'Prod',
    authType: 'assumeRole',
    authConfig: { sourceType: 'static' },
    savedSecrets: [],
    ...extra,
  }) as ConnectionProfileOutput;

const mfaField = () => screen.getByLabelText(/MFA code/, { selector: 'input' });
const secretField = () => screen.getByLabelText(/Secret key/, { selector: 'input' });
const querySecretField = () => screen.queryByLabelText(/Secret key/, { selector: 'input' });

/** Shows the modal; `result` settles when it resolves. */
async function open(stored?: ConnectionProfileOutput) {
  useProfileStore.setState({ connectionProfiles: stored ? { c1: stored } : {} });
  const view = renderWithProviders(<div />);
  let result!: Promise<boolean>;
  act(() => {
    result = MfaCodeModal.show({ connectionId: 'c1', profileName: 'Prod' }) as Promise<boolean>;
  });
  await flush();
  const settled = { value: undefined as boolean | undefined };
  void result.then(v => {
    settled.value = v;
  });
  return { result, settled, view, user: userEvent.setup() };
}

describe('MfaCodeModal', () => {
  beforeEach(() => {
    useModalStackStore.getState().reset();
    callIPCMock.mockResolvedValue({ isConnected: true } as never);
  });

  describe('fields', () => {
    it('explains which profile is about to expire and asks for the MFA code only when the secret key is saved', async () => {
      await open(profile({ savedSecrets: ['secretKey'] }));

      expect(screen.getByText('Renew credentials')).toBeInTheDocument();
      expect(
        screen.getByText('Credentials of profile Prod expire soon, enter a new MFA code to keep the connection.')
      ).toBeInTheDocument();
      expect(mfaField()).toHaveAttribute('placeholder', 'Used once, never saved');
      expect(querySecretField()).not.toBeInTheDocument();
    });

    it.each([
      ['the profile is not in the store', undefined],
      ['the role is assumed from an AWS CLI profile', profile({ authConfig: { sourceType: 'profile' } as never })],
      ['the secret key is saved', profile({ savedSecrets: ['secretKey'] })],
    ])('does not ask for the secret key when %s', async (_name, stored) => {
      await open(stored);

      expect(querySecretField()).not.toBeInTheDocument();
    });

    it.each([
      ['the secret key is not saved', profile()],
      ['savedSecrets is missing', profile({ savedSecrets: undefined })],
      ['only another secret is saved', profile({ savedSecrets: ['sessionToken'] })],
    ])('asks for the secret key when %s', async (_name, stored) => {
      await open(stored);

      expect(secretField()).toHaveAttribute('type', 'password');
    });
  });

  describe('validation', () => {
    it('does not call the backend while the MFA code is empty or blank', async () => {
      const { user, settled } = await open(profile({ savedSecrets: ['secretKey'] }));

      await user.click(screen.getByRole('button', { name: 'Renew' }));
      expect(await screen.findByText('MFA code is required')).toBeInTheDocument();

      fireEvent.change(mfaField(), { target: { value: '   ' } });
      await user.click(screen.getByRole('button', { name: 'Renew' }));

      expect(callIPCMock).not.toHaveBeenCalled();
      expect(settled.value).toBeUndefined();
    });

    it('requires the secret key too when it is asked for', async () => {
      const { user } = await open(profile());
      fireEvent.change(mfaField(), { target: { value: '123456' } });

      await user.click(screen.getByRole('button', { name: 'Renew' }));

      expect(await screen.findByText('Secret key is required')).toBeInTheDocument();
      expect(screen.queryByText('MFA code is required')).not.toBeInTheDocument();
      expect(callIPCMock).not.toHaveBeenCalled();
    });
  });

  describe('renewing', () => {
    it('sends the trimmed code and the secret key, then resolves true', async () => {
      const { user, result } = await open(profile());
      fireEvent.change(mfaField(), { target: { value: ' 123456 ' } });
      fireEvent.change(secretField(), { target: { value: 'SK' } });

      await user.click(screen.getByRole('button', { name: 'Renew' }));

      await expect(result).resolves.toBe(true);
      expect(callIPCMock).toHaveBeenCalledExactlyOnceWith(
        ReauthConnection,
        ['c1', { mfaCode: '123456', secretKey: 'SK', authConfig: {}, authSecret: {} }],
        { signal: expect.any(AbortSignal) }
      );
    });

    it('sends no secret key when the profile stores it', async () => {
      const { user, result } = await open(profile({ savedSecrets: ['secretKey'] }));
      fireEvent.change(mfaField(), { target: { value: '654321' } });

      await user.click(screen.getByRole('button', { name: 'Renew' }));

      await expect(result).resolves.toBe(true);
      const input = callIPCMock.mock.calls[0][1]?.[1];
      expect(input).toStrictEqual({ mfaCode: '654321', secretKey: undefined, authConfig: {}, authSecret: {} });
    });

    it.each([
      ['the backend reports not connected', { isConnected: false }],
      ['the call fails or is canceled', null],
    ])('keeps the modal open when %s', async (_name, output) => {
      callIPCMock.mockResolvedValue(output as never);
      const { user, settled } = await open(profile({ savedSecrets: ['secretKey'] }));
      fireEvent.change(mfaField(), { target: { value: '123456' } });

      await user.click(screen.getByRole('button', { name: 'Renew' }));

      await waitFor(() => expect(callIPCMock).toHaveBeenCalledTimes(1));
      await flush();
      expect(settled.value).toBeUndefined();
      expect(screen.getByText('Renew credentials')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Renew' })).toBeEnabled();
    });

    it('cancels the call when the modal is unmounted meanwhile', async () => {
      let signal: AbortSignal | undefined;
      callIPCMock.mockImplementation((async (_b: unknown, _a: unknown, options?: { signal?: AbortSignal }) => {
        signal = options?.signal;
        return new Promise(() => {});
      }) as never);
      const { user, view } = await open(profile({ savedSecrets: ['secretKey'] }));
      fireEvent.change(mfaField(), { target: { value: '123456' } });

      await user.click(screen.getByRole('button', { name: 'Renew' }));
      await waitFor(() => expect(signal).toBeInstanceOf(AbortSignal));
      expect(signal?.aborted).toBe(false);

      view.unmount();

      expect(signal?.aborted).toBe(true);
    });
  });

  describe('cancel', () => {
    it('resolves false without calling the backend', async () => {
      const { user, result } = await open(profile());

      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      await expect(result).resolves.toBe(false);
      expect(callIPCMock).not.toHaveBeenCalled();
    });

    it('resolves false when the modal is dismissed with the close button', async () => {
      const { user, result } = await open(profile());

      await user.click(screen.getByRole('button', { name: 'Close' }));

      await expect(result).resolves.toBe(false);
    });

    it('does not submit the form when the close button is clicked', async () => {
      const { user, result } = await open(profile({ savedSecrets: ['secretKey'] }));

      await user.click(screen.getByRole('button', { name: 'Close' }));

      await expect(result).resolves.toBe(false);
      expect(screen.queryByText('MFA code is required')).not.toBeInTheDocument();
      expect(callIPCMock).not.toHaveBeenCalled();
    });
  });
});
