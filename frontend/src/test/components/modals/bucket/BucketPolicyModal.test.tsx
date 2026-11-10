import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GetBucketPolicy, PutBucketPolicy } from '@wails/S3Browser/internal/handlers/buckethandler';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useModalStackStore } from '@/common/stores/modalStackStore';
import { callIPC } from '@/common/utils/ipcUtils';
import BucketPolicyModal from '@/components/modals/bucket/BucketPolicyModal';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

vi.mock('@wails/S3Browser/internal/handlers/buckethandler', () => ({
  GetBucketPolicy: vi.fn(),
  PutBucketPolicy: vi.fn(),
}));
vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));

const callIPCMock = vi.mocked(callIPC);
const flush = () => act(async () => {});

type Policy = { mode: string; policy: string; editDenied?: boolean; publicBlocked?: boolean };
// Per binding: the next result (null = failed), or a promise to control the timing.
const results = {
  get: undefined as unknown,
  put: undefined as unknown,
};
const signals: { get?: AbortSignal; put?: AbortSignal } = {};

const POLICY_JSON = '{"Version":"2012-10-17","Statement":[]}';
const policy = (extra: Partial<Policy> = {}): Policy => ({ mode: 'private', policy: '', ...extra });

type Props = Parameters<typeof BucketPolicyModal.show>[0];
async function open(settle = true, onSaved?: (mode: string) => void) {
  renderWithProviders(<div />);
  let result!: Promise<boolean>;
  act(() => {
    result = BucketPolicyModal.show({
      connectionId: 'c1',
      profileName: 'Prod',
      bucket: 'my-bucket',
      onSaved,
    } as Props) as Promise<boolean>;
  });
  if (settle) await flush();
  return { result, user: userEvent.setup() };
}

const saveBtn = () => screen.getByRole('button', { name: 'Save' });
const segment = (name: string) => screen.getByRole('radio', { name }) as HTMLInputElement;
const policyField = () => screen.getByLabelText(/Policy \(JSON\)/) as HTMLTextAreaElement;

describe('BucketPolicyModal', () => {
  beforeEach(() => {
    useModalStackStore.getState().reset();
    results.get = policy();
    results.put = policy();
    signals.get = undefined;
    signals.put = undefined;
    callIPCMock.mockReset();
    callIPCMock.mockImplementation(((fn: unknown, _args: unknown, options?: { signal?: AbortSignal }) => {
      if (fn === GetBucketPolicy) {
        signals.get = options?.signal;
        return Promise.resolve(results.get);
      }
      signals.put = options?.signal;
      return Promise.resolve(results.put);
    }) as never);
  });

  it('shows a loader and loads the policy of the bucket with its parameters', async () => {
    const { user } = await open(false);

    expect(screen.queryByRole('radio', { name: 'Private' })).not.toBeInTheDocument();
    expect(callIPCMock).toHaveBeenCalledExactlyOnceWith(
      GetBucketPolicy,
      [{ connectionId: 'c1', profileName: 'Prod', bucket: 'my-bucket' }],
      { signal: expect.any(AbortSignal) }
    );
    expect(user).toBeDefined();
    await flush();
    expect(screen.getByText('my-bucket')).toBeInTheDocument();
  });

  it('puts Cancel on the left and Save on the right', async () => {
    await open();

    const footer = screen.getByRole('button', { name: 'Cancel' }).parentElement as HTMLElement;
    expect(Array.from(footer.querySelectorAll('button')).map(b => b.textContent)).toEqual(['Cancel', 'Save']);
  });

  it.each([
    ['private', 'Private', 'No bucket policy.'],
    ['public', 'Public (read-only)', 'Anyone can list and read'],
  ])('selects the %s segment and shows its hint', async (mode, label, hint) => {
    results.get = policy({ mode });
    await open();

    expect(segment(label).checked).toBe(true);
    expect(screen.getByText(new RegExp(hint))).toBeInTheDocument();
    expect(screen.queryByLabelText(/Policy \(JSON\)/)).not.toBeInTheDocument();
    expect(saveBtn()).toBeEnabled();
  });

  it('selects the custom segment and shows the policy JSON', async () => {
    results.get = policy({ mode: 'custom', policy: POLICY_JSON });
    await open();

    expect(segment('Custom').checked).toBe(true);
    expect(policyField()).toHaveValue(POLICY_JSON);
    expect(policyField()).not.toHaveAttribute('readonly');
    expect(saveBtn()).toBeEnabled();
  });

  it('is read only with an error when the policy cannot be loaded', async () => {
    results.get = null;
    await open();

    expect(screen.getByText('Could not load the permission of this bucket.')).toBeInTheDocument();
    expect(segment('Private')).toBeDisabled();
    expect(saveBtn()).toBeDisabled();
  });

  it('is read only with a warning when the account may not edit', async () => {
    results.get = policy({ mode: 'custom', policy: POLICY_JSON, editDenied: true });
    await open();

    expect(
      screen.getByText('Your account is not allowed to change the permission of this bucket.')
    ).toBeInTheDocument();
    expect(segment('Public (read-only)')).toBeDisabled();
    expect(policyField()).toHaveAttribute('readonly');
    expect(saveBtn()).toBeDisabled();
  });

  it('warns when Block Public Access is on', async () => {
    results.get = policy({ publicBlocked: true });
    await open();

    expect(
      screen.getByText('Block Public Access is on for this bucket, so a public policy will be rejected.')
    ).toBeInTheDocument();
    expect(saveBtn()).toBeEnabled();
  });

  it('shows no warning for a normal bucket', async () => {
    await open();

    expect(screen.queryByText(/Could not load|not allowed|Block Public Access/)).not.toBeInTheDocument();
  });

  it('blocks Save and flags invalid JSON, without calling the backend', async () => {
    results.get = policy({ mode: 'custom', policy: POLICY_JSON });
    const { user } = await open();

    fireEvent.change(policyField(), { target: { value: '{ nope' } });

    expect(screen.getByText(/is not valid/)).toBeInTheDocument();
    expect(saveBtn()).toBeDisabled();
    await user.click(saveBtn());
    expect(callIPCMock).toHaveBeenCalledTimes(1);
  });

  it('blocks Save for an empty custom policy without flagging it', async () => {
    results.get = policy({ mode: 'custom', policy: POLICY_JSON });
    await open();

    fireEvent.change(policyField(), { target: { value: '' } });

    expect(screen.queryByText(/is not valid/)).not.toBeInTheDocument();
    expect(saveBtn()).toBeDisabled();
  });

  it('saves the chosen mode without a policy and shows the state the backend returns', async () => {
    results.get = policy({ mode: 'private' });
    results.put = policy({ mode: 'public', publicBlocked: true });
    const { user } = await open();

    await user.click(screen.getByText('Public (read-only)'));
    await user.click(saveBtn());

    expect(callIPCMock).toHaveBeenLastCalledWith(
      PutBucketPolicy,
      [{ connectionId: 'c1', profileName: 'Prod', bucket: 'my-bucket', mode: 'public', policy: undefined }],
      { signal: expect.any(AbortSignal) }
    );
    expect(await screen.findByText(/Block Public Access is on/)).toBeInTheDocument();
    expect(segment('Public (read-only)').checked).toBe(true);
  });

  it('saves a custom policy and shows the returned (normalised) JSON', async () => {
    results.get = policy({ mode: 'custom', policy: POLICY_JSON });
    results.put = policy({ mode: 'custom', policy: '{"Version":"x"}' });
    const { user } = await open();

    fireEvent.change(policyField(), { target: { value: '{"a":1}' } });
    await user.click(saveBtn());

    expect(callIPCMock).toHaveBeenLastCalledWith(
      PutBucketPolicy,
      [{ connectionId: 'c1', profileName: 'Prod', bucket: 'my-bucket', mode: 'custom', policy: '{"a":1}' }],
      { signal: expect.any(AbortSignal) }
    );
    await waitFor(() => expect(policyField()).toHaveValue('{"Version":"x"}'));
  });

  it('keeps the form as typed when the save fails', async () => {
    results.get = policy({ mode: 'custom', policy: POLICY_JSON });
    results.put = null;
    const { user } = await open();

    fireEvent.change(policyField(), { target: { value: '{"a":1}' } });
    await user.click(saveBtn());
    await flush();

    expect(policyField()).toHaveValue('{"a":1}');
    expect(saveBtn()).toBeEnabled();
  });

  it('resolves false on Cancel', async () => {
    const { user, result } = await open();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await expect(result).resolves.toBe(false);
  });

  it('resolves false (not undefined) when closed with Esc', async () => {
    const { user, result } = await open();

    await user.keyboard('{Escape}');

    await expect(result).resolves.toBe(false);
  });

  it('aborts a load still running when the modal is closed and ignores its late result', async () => {
    let finishLoad!: () => void;
    callIPCMock.mockImplementation(((_fn: unknown, _args: unknown, options?: { signal?: AbortSignal }) => {
      signals.get = options?.signal;
      return new Promise(resolve => {
        finishLoad = () => resolve(policy({ mode: 'public' }));
      });
    }) as never);
    const { user, result } = await open(false);
    await flush();

    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(signals.get?.aborted).toBe(true));
    await act(async () => finishLoad());

    // The close button settles the modal with cancelValue (false), never with the late result.
    await expect(result).resolves.toBe(false);
    expect(screen.queryByRole('radio', { name: 'Public (read-only)' })).not.toBeInTheDocument();
  });

  it('aborts a failed load still running when the modal is closed', async () => {
    let finishLoad!: () => void;
    callIPCMock.mockImplementation(((_fn: unknown, _args: unknown, options?: { signal?: AbortSignal }) => {
      signals.get = options?.signal;
      return new Promise(resolve => {
        finishLoad = () => resolve(null);
      });
    }) as never);
    const { user } = await open(false);
    await flush();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(signals.get?.aborted).toBe(true));
    await act(async () => finishLoad());

    expect(screen.queryByText('Could not load the permission of this bucket.')).not.toBeInTheDocument();
  });

  it('aborts a save in flight when the modal is closed and ignores its late result', async () => {
    let finishSave!: () => void;
    callIPCMock.mockImplementation(((fn: unknown, _args: unknown, options?: { signal?: AbortSignal }) => {
      if (fn === GetBucketPolicy) return Promise.resolve(policy());
      signals.put = options?.signal;
      return new Promise(resolve => {
        finishSave = () => resolve(policy({ mode: 'public' }));
      });
    }) as never);
    const { user } = await open();

    await user.click(screen.getByText('Public (read-only)'));
    await user.click(saveBtn());
    expect(signals.put?.aborted).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(signals.put?.aborted).toBe(true));
    await act(async () => finishSave());
  });

  describe('onSaved', () => {
    it('reports the mode the backend saved, after the form shows it', async () => {
      results.put = policy({ mode: 'public' });
      const onSaved = vi.fn();
      const { user } = await open(true, onSaved);

      await user.click(screen.getByText('Public (read-only)'));
      await user.click(saveBtn());

      await waitFor(() => expect(onSaved).toHaveBeenCalledExactlyOnceWith('public'));
      expect(segment('Public (read-only)').checked).toBe(true);
    });

    it('is not called when the save fails', async () => {
      results.put = null;
      const onSaved = vi.fn();
      const { user } = await open(true, onSaved);

      await user.click(screen.getByText('Public (read-only)'));
      await user.click(saveBtn());
      await flush();

      expect(onSaved).not.toHaveBeenCalled();
    });

    it('is not called when the modal is closed before the save returns', async () => {
      let finishSave!: () => void;
      callIPCMock.mockImplementation(((fn: unknown, _args: unknown, options?: { signal?: AbortSignal }) => {
        if (fn === GetBucketPolicy) return Promise.resolve(policy());
        signals.put = options?.signal;
        return new Promise(resolve => {
          finishSave = () => resolve(policy({ mode: 'public' }));
        });
      }) as never);
      const onSaved = vi.fn();
      const { user } = await open(true, onSaved);

      await user.click(screen.getByText('Public (read-only)'));
      await user.click(saveBtn());
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(signals.put?.aborted).toBe(true));
      await act(async () => finishSave());

      expect(onSaved).not.toHaveBeenCalled();
    });

    it('saves without error when no callback is given', async () => {
      results.put = policy({ mode: 'public' });
      const { user } = await open();

      await user.click(screen.getByText('Public (read-only)'));
      await user.click(saveBtn());

      await waitFor(() => expect(segment('Public (read-only)').checked).toBe(true));
    });
  });
});
