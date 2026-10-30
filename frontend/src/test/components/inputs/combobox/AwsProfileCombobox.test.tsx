import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ListAwsProfiles } from '@wails/S3Browser/internal/handlers/buckethandler';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callIPC } from '@/common/utils/ipcUtils';
import AwsProfileCombobox from '@/components/inputs/combobox/AwsProfileCombobox';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));
vi.mock('@wails/S3Browser/internal/handlers/buckethandler', () => ({ ListAwsProfiles: vi.fn() }));

const callIPCMock = vi.mocked(callIPC);
const flush = () => act(async () => {});
const aws = (name: string, extra: Record<string, unknown> = {}) => ({ name, isSso: false, ...extra });

const PROFILES = [aws('dev'), aws('prod', { isSso: true }), aws('proc', { hasCredentialProcess: true })];

const trigger = () => screen.getByRole('button', { name: /AWS CLI profile/ });
const optionNames = () => screen.getAllByRole('option', { hidden: true }).map(o => o.textContent);

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(trigger());
  await screen.findAllByRole('option', { hidden: true });
}

describe('AwsProfileCombobox', () => {
  beforeEach(() => {
    callIPCMock.mockResolvedValue(PROFILES as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lists the profiles found by the backend with the standard files', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AwsProfileCombobox />);
    await flush();

    await open(user);

    expect(optionNames()).toEqual(['dev', 'prod', 'proc']);
    expect(callIPCMock).toHaveBeenCalledTimes(1);
    expect(callIPCMock.mock.calls[0][0]).toBe(ListAwsProfiles);
    expect(callIPCMock.mock.calls[0][1]).toEqual(['', '']);
  });

  it('lists only the SSO profiles with ssoOnly', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AwsProfileCombobox ssoOnly />);
    await flush();

    await open(user);

    expect(optionNames()).toEqual(['prod']);
  });

  it('selects a profile and reports it', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<AwsProfileCombobox onChange={onChange} />);
    await flush();

    await open(user);
    await user.click(screen.getByText('dev'));

    expect(onChange).toHaveBeenCalledWith('dev');
    expect(trigger()).toHaveTextContent('dev');
  });

  it('selects a profile when nobody listens to the change', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AwsProfileCombobox />);
    await flush();

    await open(user);
    await user.click(screen.getByText('dev'));

    expect(trigger()).toHaveTextContent('dev');
  });

  it('clears the selection with an empty string, not null', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<AwsProfileCombobox defaultValue="dev" onChange={onChange} />);
    await flush();

    await user.click(screen.getByRole('button', { name: 'Clear' }));

    expect(onChange).toHaveBeenCalledWith('');
    expect(trigger()).not.toHaveTextContent('dev');
  });

  it.each([
    ['value', { value: 'ghost' }],
    ['defaultValue', { defaultValue: 'ghost' }],
  ])('keeps a %s that is no longer in the files, listed first', async (_n, props) => {
    const user = userEvent.setup();
    renderWithProviders(<AwsProfileCombobox {...props} />);
    await flush();

    await open(user);

    expect(optionNames()).toEqual(['ghost', 'dev', 'prod', 'proc']);
  });

  it('does not duplicate the current profile when it is in the files', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AwsProfileCombobox defaultValue="dev" />);
    await flush();

    await open(user);

    expect(optionNames()).toEqual(['dev', 'prod', 'proc']);
  });

  it('warns when the selected profile runs a credential_process command', async () => {
    const warning = 'This profile runs its credential_process command when connecting.';
    const user = userEvent.setup();
    renderWithProviders(<AwsProfileCombobox defaultValue="dev" />);
    await flush();
    expect(screen.queryByText(warning)).not.toBeInTheDocument();

    await open(user);
    await user.click(screen.getByText('proc'));

    expect(screen.getByText(warning)).toBeInTheDocument();
  });

  it('shows the empty text when no profile exists', async () => {
    callIPCMock.mockResolvedValue([] as never);
    const user = userEvent.setup();
    renderWithProviders(<AwsProfileCombobox />);
    await flush();

    await user.click(trigger());

    expect(await screen.findByText('No profiles found. Check the ~/.aws/config file.')).toBeInTheDocument();
  });

  it('keeps the list when the backend call fails (null body)', async () => {
    vi.useFakeTimers();
    const { rerender } = renderWithProviders(<AwsProfileCombobox configFile="" />);
    await flush();
    callIPCMock.mockResolvedValue(null as never);

    rerender(<AwsProfileCombobox configFile="/x" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(callIPCMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
    await open(userEvent.setup());
    expect(optionNames()).toEqual(['dev', 'prod', 'proc']);
  });

  it('aborts the request when unmounted', async () => {
    const { unmount } = renderWithProviders(<AwsProfileCombobox />);
    await flush();
    const options = callIPCMock.mock.calls[0][2] as { signal: AbortSignal };
    expect(options.signal.aborted).toBe(false);

    unmount();

    expect(options.signal.aborted).toBe(true);
  });

  it('reloads once, 300ms after the files change, with the trimmed paths and aborts the previous request', async () => {
    vi.useFakeTimers();
    const { rerender } = renderWithProviders(<AwsProfileCombobox />);
    await flush();
    const firstSignal = (callIPCMock.mock.calls[0][2] as { signal: AbortSignal }).signal;

    rerender(<AwsProfileCombobox configFile=" /a/config " credentialsFile=" /a/cred " />);
    rerender(<AwsProfileCombobox configFile=" /a/config " credentialsFile=" /a/cred" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(299);
    });
    expect(callIPCMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(callIPCMock).toHaveBeenCalledTimes(2);
    expect(callIPCMock.mock.calls[1][1]).toEqual(['/a/config', '/a/cred']);
    expect(firstSignal.aborted).toBe(true);
  });
});
