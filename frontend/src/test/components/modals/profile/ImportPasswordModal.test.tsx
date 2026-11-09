import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportProfile } from '@wails/S3Browser/internal/handlers/profilehandler';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useModalStackStore } from '@/common/stores/modalStackStore';
import type { ConnectionProfile } from '@/common/stores/profileStore';
import { callIPC } from '@/common/utils/ipcUtils';
import ImportPasswordModal from '@/components/modals/profile/ImportPasswordModal';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

vi.mock('@wails/S3Browser/internal/handlers/profilehandler', () => ({ ImportProfile: vi.fn() }));
vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));

const callIPCMock = vi.mocked(callIPC);
const flush = () => act(async () => {});
const imported = { id: 'p9', name: 'Imported' } as ConnectionProfile;

async function open() {
  const view = renderWithProviders(<div />);
  let result!: Promise<ConnectionProfile | null>;
  act(() => {
    result = ImportPasswordModal.show({
      path: 'C:/in/prod.json',
      name: 'prod.json',
    }) as Promise<ConnectionProfile | null>;
  });
  await flush();
  const settled = { value: undefined as ConnectionProfile | null | undefined, done: false };
  void result.then(v => {
    settled.value = v;
    settled.done = true;
  });
  return { result, settled, view, user: userEvent.setup() };
}

const title = () => screen.queryByRole('heading', { name: 'Import profile' });
const password = () => screen.getByLabelText(/^Password/, { selector: 'input' });
const importBtn = () => screen.getByRole('button', { name: 'Import' });

describe('ImportPasswordModal', () => {
  beforeEach(() => {
    useModalStackStore.getState().reset();
    callIPCMock.mockReset();
    callIPCMock.mockResolvedValue(imported as never);
  });

  it('shows the file name and a masked password field, with Cancel left and Import right', async () => {
    await open();

    expect(title()).toBeInTheDocument();
    expect(screen.getByText(/prod\.json contains encrypted secrets/)).toBeInTheDocument();
    expect(password()).toHaveAttribute('type', 'password');
    const footer = screen.getByRole('button', { name: 'Cancel' }).parentElement as HTMLElement;
    expect(Array.from(footer.querySelectorAll('button')).map(b => b.textContent)).toEqual(['Cancel', 'Import']);
  });

  it('requires a password and does not call the backend', async () => {
    const { user } = await open();

    await user.click(importBtn());

    expect(await screen.findByText(/is required/)).toBeInTheDocument();
    expect(callIPCMock).not.toHaveBeenCalled();
  });

  it.each(['a', 'seven77'])('rejects %j (under 8 characters) without calling the backend', async value => {
    const { user } = await open();

    await user.type(password(), value);
    await user.click(importBtn());

    expect(await screen.findByText('Password must be at least 8 characters')).toBeInTheDocument();
    expect(callIPCMock).not.toHaveBeenCalled();
  });

  it('counts code points: 4 emoji are rejected, 8 emoji are accepted', async () => {
    const { user } = await open();

    await user.click(password());
    await user.paste('\u{1F600}'.repeat(4));
    await user.click(importBtn());
    expect(await screen.findByText('Password must be at least 8 characters')).toBeInTheDocument();
    expect(callIPCMock).not.toHaveBeenCalled();

    await user.clear(password());
    await user.paste('\u{1F600}'.repeat(8));
    await user.click(importBtn());

    await waitFor(() => expect(callIPCMock).toHaveBeenCalledTimes(1));
    expect(callIPCMock.mock.calls[0]?.[1]).toEqual([{ path: 'C:/in/prod.json', password: '\u{1F600}'.repeat(8) }]);
  });

  it('while submitting: X and Cancel are disabled, Escape and outside click do not close', async () => {
    let finish!: (v: ConnectionProfile) => void;
    callIPCMock.mockImplementation((() => new Promise(r => (finish = r))) as never);
    const { user, result, settled } = await open();

    await user.type(password(), 'secret-pw');
    await user.click(importBtn());
    await flush();

    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await user.keyboard('{Escape}');
    await user.click(document.body);
    await flush();
    expect(title()).toBeInTheDocument();
    expect(settled.done).toBe(false);

    await act(async () => finish(imported));
    await expect(result).resolves.toEqual(imported);
    await waitFor(() => expect(title()).not.toBeInTheDocument());
  });

  it('can be closed with Escape when not submitting', async () => {
    const { user, result } = await open();

    await user.keyboard('{Escape}');

    await expect(result).resolves.toBeNull();
  });

  it('imports with the typed password, resolves the profile and closes', async () => {
    const { user, result } = await open();

    await user.type(password(), 'secret-pw');
    await user.click(importBtn());

    await expect(result).resolves.toEqual(imported);
    expect(callIPCMock).toHaveBeenCalledExactlyOnceWith(
      ImportProfile,
      [{ path: 'C:/in/prod.json', password: 'secret-pw' }],
      { signal: expect.any(AbortSignal) }
    );
    await waitFor(() => expect(title()).not.toBeInTheDocument());
  });

  it('keeps the modal open and unresolved when the import fails (wrong password)', async () => {
    callIPCMock.mockResolvedValue(null as never);
    const { user, settled } = await open();

    await user.type(password(), 'wrong-pw');
    await user.click(importBtn());
    await flush();

    expect(callIPCMock).toHaveBeenCalledTimes(1);
    expect(title()).toBeInTheDocument();
    expect(settled.done).toBe(false);
    expect(importBtn()).toBeEnabled();
  });

  it('resolves null and closes on Cancel without calling the backend', async () => {
    const { user, result } = await open();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await expect(result).resolves.toBeNull();
    expect(callIPCMock).not.toHaveBeenCalled();
    await waitFor(() => expect(title()).not.toBeInTheDocument());
  });

  it('resolves null on the X button', async () => {
    const { user, result } = await open();

    await user.click(screen.getByRole('button', { name: 'Close' }));

    await expect(result).resolves.toBeNull();
    expect(callIPCMock).not.toHaveBeenCalled();
  });

  it('aborts the import in flight when the modal is unmounted', async () => {
    let signal: AbortSignal | undefined;
    callIPCMock.mockImplementation((async (_b: unknown, _a: unknown, opts: { signal: AbortSignal }) => {
      signal = opts.signal;
      return new Promise(() => {});
    }) as never);
    const { user, view } = await open();

    await user.type(password(), 'secret-pw');
    await user.click(importBtn());
    await flush();
    expect(signal?.aborted).toBe(false);

    view.unmount();

    expect(signal?.aborted).toBe(true);
  });
});
