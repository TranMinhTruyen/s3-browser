import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SaveSettings } from '@wails/S3Browser/internal/handlers/settinghandler';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/common/cnst/settingConst';
import { useModalStackStore } from '@/common/stores/modalStackStore';
import { useSettingStore } from '@/common/stores/settingStore';
import { callIPC } from '@/common/utils/ipcUtils';
import { applySettings } from '@/common/utils/settingUtils';
import SettingModal from '@/components/modals/SettingModal';
import { renderWithProviders } from '@/test/renderWithProviders';

vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));
vi.mock('@/common/utils/settingUtils', async importOriginal => ({
  ...(await importOriginal<typeof import('@/common/utils/settingUtils')>()),
  applySettings: vi.fn(),
}));
vi.mock('@wails/S3Browser/internal/handlers/settinghandler', () => ({ GetSettings: vi.fn(), SaveSettings: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const callIPCMock = vi.mocked(callIPC);
const flush = () => act(async () => {});
const state = () => useSettingStore.getState();

function open() {
  renderWithProviders(<div />);
  let result!: Promise<boolean | null>;
  act(() => {
    result = SettingModal.show();
  });
  return result;
}

async function pickOption(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
  await user.click(screen.getByRole('combobox', { name: label }));
  await user.click(await screen.findByRole('option', { name: option, hidden: true }));
}

describe('SettingModal', () => {
  beforeEach(() => {
    useModalStackStore.getState().reset();
    state().reset();
    vi.clearAllMocks();
  });

  it('shows the draft values in the selects', async () => {
    useSettingStore.setState({ draft: { ...DEFAULT_SETTINGS, theme: 'dark', font: 'arial', language: 'vi' } });
    open();
    await flush();

    expect(screen.getByRole('combobox', { name: 'Theme' })).toHaveValue('Dark');
    expect(screen.getByRole('combobox', { name: 'Font' })).toHaveValue('Arial');
    expect(screen.getByRole('combobox', { name: 'Language' })).toHaveValue('Tiếng Việt');
  });

  it('hides the launch on startup switch when autostart is not supported', async () => {
    open();
    await flush();

    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('previews each change through the store without saving', async () => {
    const user = userEvent.setup();
    useSettingStore.setState({ autostartSupported: true });
    open();
    await flush();

    await pickOption(user, 'Theme', 'Dark');
    await pickOption(user, 'Font', 'JetBrains Mono');
    await pickOption(user, 'Language', '日本語');
    await user.click(screen.getByRole('switch', { name: 'Launch on Windows startup' }));

    expect(state().draft).toEqual({ theme: 'dark', font: 'jetbrains-mono', language: 'ja', launchOnStartup: true });
    expect(state().saved).toEqual(DEFAULT_SETTINGS);
    expect(applySettings).toHaveBeenLastCalledWith(state().draft);
    expect(callIPCMock).not.toHaveBeenCalled();
  });

  it('resets the draft to the defaults but does not save', async () => {
    const user = userEvent.setup();
    useSettingStore.setState({ draft: { ...DEFAULT_SETTINGS, theme: 'dark' } });
    open();
    await flush();

    await user.click(screen.getByRole('button', { name: 'Reset to default' }));

    expect(state().draft).toEqual(DEFAULT_SETTINGS);
    expect(callIPCMock).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox', { name: 'Theme' })).toHaveValue('Light');
  });

  it('saves, shows a toast and resolves true', async () => {
    const user = userEvent.setup();
    callIPCMock.mockResolvedValueOnce({ settings: { ...DEFAULT_SETTINGS, theme: 'dark' } });
    const result = open();
    await flush();

    await pickOption(user, 'Theme', 'Dark');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await expect(result).resolves.toBe(true);
    expect(callIPCMock).toHaveBeenCalledWith(SaveSettings, [{ ...DEFAULT_SETTINGS, theme: 'dark' }], {
      scope: 'Setting/save',
    });
    expect(toast.success).toHaveBeenCalledWith('Settings saved.');
    expect(state().saved.theme).toBe('dark');
  });

  it('stays open without a toast when saving fails', async () => {
    const user = userEvent.setup();
    callIPCMock.mockResolvedValueOnce(null);
    open();
    await flush();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await flush();

    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('cancel undoes the preview and resolves false', async () => {
    const user = userEvent.setup();
    const applied = { ...DEFAULT_SETTINGS, font: 'arial' } as const;
    useSettingStore.setState({ saved: applied, applied, draft: DEFAULT_SETTINGS });
    const result = open();
    await flush();

    await pickOption(user, 'Theme', 'Dark');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await expect(result).resolves.toBe(false);
    expect(state().draft).toEqual({ ...DEFAULT_SETTINGS, font: 'arial' });
    expect(applySettings).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, font: 'arial' });
    expect(callIPCMock).not.toHaveBeenCalled();
  });

  it('apply keeps the values for the session, shows a toast, stays open and does not save', async () => {
    const user = userEvent.setup();
    useSettingStore.setState({ autostartSupported: true });
    open();
    await flush();

    await pickOption(user, 'Theme', 'Dark');
    await user.click(screen.getByRole('switch', { name: 'Launch on Windows startup' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(state().applied).toEqual({ ...DEFAULT_SETTINGS, theme: 'dark', launchOnStartup: false });
    expect(state().saved).toEqual(DEFAULT_SETTINGS);
    expect(toast.success).toHaveBeenCalledWith('Settings applied until the app is closed.');
    expect(callIPCMock).not.toHaveBeenCalledWith(SaveSettings, expect.anything(), expect.anything());
    expect(callIPCMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('cancel after apply keeps the applied values and drops later changes', async () => {
    const user = userEvent.setup();
    const result = open();
    await flush();

    await pickOption(user, 'Theme', 'Dark');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await pickOption(user, 'Font', 'Arial');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await expect(result).resolves.toBe(false);
    expect(state().draft).toEqual({ ...DEFAULT_SETTINGS, theme: 'dark' });
    expect(applySettings).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, theme: 'dark' });
    expect(state().saved).toEqual(DEFAULT_SETTINGS);
  });

  it('closing with the close button undoes the preview and resolves null', async () => {
    const user = userEvent.setup();
    const result = open();
    await flush();

    await pickOption(user, 'Theme', 'Dark');
    await user.click(screen.getByRole('button', { name: 'Close' }));

    await expect(result).resolves.toBeNull();
    expect(state().draft).toEqual(DEFAULT_SETTINGS);
    expect(callIPCMock).not.toHaveBeenCalled();
  });
});
