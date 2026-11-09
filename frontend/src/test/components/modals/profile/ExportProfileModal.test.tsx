import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExportProfile } from '@wails/S3Browser/internal/handlers/profilehandler';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useModalStackStore } from '@/common/stores/modalStackStore';
import { callIPC } from '@/common/utils/ipcUtils';
import ExportProfileModal from '@/components/modals/profile/ExportProfileModal';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

vi.mock('@wails/S3Browser/internal/handlers/profilehandler', () => ({ ExportProfile: vi.fn() }));
vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));

const callIPCMock = vi.mocked(callIPC);
const flush = () => act(async () => {});

type Profile = Parameters<typeof ExportProfileModal.show>[0]['profile'];
const withSecret: Profile = { id: 'p1', name: 'Prod', savedSecrets: ['secretKey'] };

async function open(profile: Profile = withSecret) {
  renderWithProviders(<div />);
  let result!: Promise<boolean>;
  act(() => {
    result = ExportProfileModal.show({ profile }) as Promise<boolean>;
  });
  await flush();
  const settled = { value: undefined as boolean | undefined };
  void result.then(v => {
    settled.value = v;
  });
  return { result, settled, user: userEvent.setup() };
}

const checkbox = () => screen.getByRole('checkbox', { name: /Include secrets/ });
const exportBtn = () => screen.getByRole('button', { name: 'Export' });
const password = () => screen.getByLabelText(/^Password/, { selector: 'input' });
const confirm = () => screen.getByLabelText(/^Confirm password/, { selector: 'input' });
const title = () => screen.queryByRole('heading', { name: 'Export profile' });

describe('ExportProfileModal', () => {
  beforeEach(() => {
    useModalStackStore.getState().reset();
    callIPCMock.mockReset();
    callIPCMock.mockResolvedValue('C:/out/p.json' as never);
  });

  it('shows the title, with Cancel on the left and Export on the right', async () => {
    await open();

    expect(title()).toBeInTheDocument();
    const footer = screen.getByRole('button', { name: 'Cancel' }).parentElement as HTMLElement;
    expect(Array.from(footer.querySelectorAll('button')).map(b => b.textContent)).toEqual(['Cancel', 'Export']);
  });

  it.each([
    ['an empty list', []],
    ['no list', undefined],
  ])('disables the secrets checkbox and explains why for %s', async (_n, savedSecrets) => {
    await open({ id: 'p1', name: 'Prod', savedSecrets } as Profile);

    expect(checkbox()).toBeDisabled();
    expect(screen.getByText('This profile has no saved secrets.')).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Password/)).not.toBeInTheDocument();
  });

  it('enables the checkbox with the encryption hint and shows no password fields until ticked', async () => {
    const { user } = await open();

    expect(checkbox()).toBeEnabled();
    expect(screen.getByText(/Secrets are encrypted with this password/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Password/)).not.toBeInTheDocument();

    await user.click(checkbox());
    expect(password()).toHaveAttribute('type', 'password');
    expect(confirm()).toHaveAttribute('type', 'password');

    await user.click(checkbox());
    expect(screen.queryByLabelText(/^Password/)).not.toBeInTheDocument();
  });

  it('exports without secrets: no password is sent', async () => {
    const { user, result } = await open();

    await user.click(exportBtn());

    await expect(result).resolves.toBe(true);
    expect(callIPCMock).toHaveBeenCalledExactlyOnceWith(
      ExportProfile,
      [{ id: 'p1', includeSecret: false, password: undefined }],
      { signal: expect.any(AbortSignal) }
    );
    await waitFor(() => expect(title()).not.toBeInTheDocument());
  });

  it('exports with secrets and sends the password', async () => {
    const { user, result } = await open();

    await user.click(checkbox());
    await user.type(password(), 'password1');
    await user.type(confirm(), 'password1');
    await user.click(exportBtn());

    await expect(result).resolves.toBe(true);
    expect(callIPCMock).toHaveBeenCalledExactlyOnceWith(
      ExportProfile,
      [{ id: 'p1', includeSecret: true, password: 'password1' }],
      { signal: expect.any(AbortSignal) }
    );
  });

  it('requires a password when secrets are included', async () => {
    const { user } = await open();

    await user.click(checkbox());
    await user.click(exportBtn());

    expect(await screen.findByText('Password is required')).toBeInTheDocument();
    expect(callIPCMock).not.toHaveBeenCalled();
  });

  it('requires at least 8 characters', async () => {
    const { user } = await open();

    await user.click(checkbox());
    await user.type(password(), 'short');
    await user.type(confirm(), 'short');
    await user.click(exportBtn());

    expect(await screen.findByText('Password must be at least 8 characters')).toBeInTheDocument();
    expect(callIPCMock).not.toHaveBeenCalled();
  });

  it('counts code points: 4 emoji (8 UTF-16 units) are rejected as too short', async () => {
    const { user } = await open();
    const emoji4 = '\u{1F600}'.repeat(4);

    await user.click(checkbox());
    await user.click(password());
    await user.paste(emoji4);
    await user.click(confirm());
    await user.paste(emoji4);
    await user.click(exportBtn());

    expect(await screen.findByText('Password must be at least 8 characters')).toBeInTheDocument();
    expect(callIPCMock).not.toHaveBeenCalled();
  });

  it('requires the confirmation to match', async () => {
    const { user } = await open();

    await user.click(checkbox());
    await user.type(password(), 'password1');
    await user.type(confirm(), 'password2');
    await user.click(exportBtn());

    expect(await screen.findByText('Confirm password does not match')).toBeInTheDocument();
    expect(callIPCMock).not.toHaveBeenCalled();
  });

  it.each([
    ['an empty path (save dialog canceled)', ''],
    ['null (failed)', null],
  ])('keeps the modal open and unresolved on %s', async (_n, value) => {
    callIPCMock.mockResolvedValue(value as never);
    const { user, settled } = await open();

    await user.click(exportBtn());
    await flush();

    expect(callIPCMock).toHaveBeenCalledTimes(1);
    expect(title()).toBeInTheDocument();
    expect(settled.value).toBeUndefined();
    expect(exportBtn()).toBeEnabled();
  });

  it('resolves false and closes on Cancel without calling the backend', async () => {
    const { user, result } = await open();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await expect(result).resolves.toBe(false);
    expect(callIPCMock).not.toHaveBeenCalled();
    await waitFor(() => expect(title()).not.toBeInTheDocument());
  });

  it('resolves false and closes on the X button', async () => {
    const { user, result } = await open();

    await user.click(screen.getByRole('button', { name: 'Close' }));

    await expect(result).resolves.toBe(false);
    expect(callIPCMock).not.toHaveBeenCalled();
  });
});
