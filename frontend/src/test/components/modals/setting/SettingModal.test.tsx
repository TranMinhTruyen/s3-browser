import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SaveSettings, SetLaunchOnStartup } from '@wails/S3Browser/internal/handlers/settinghandler';
import { SetUpdateOptions } from '@wails/S3Browser/internal/handlers/updatehandler';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/common/cnst/settingConst';
import { useModalStackStore } from '@/common/stores/modalStackStore';
import { useSettingStore } from '@/common/stores/settingStore';
import { useUpdateStore } from '@/common/stores/updateStore';
import { callIPC } from '@/common/utils/ipcUtils';
import { applySettings } from '@/common/utils/settingUtils';
import { showUnsavedSettingModal } from '@/components/modals/lazyModals';
import SettingModal from '@/components/modals/setting/SettingModal';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));
vi.mock('@/common/utils/settingUtils', async importOriginal => ({
  ...(await importOriginal<typeof import('@/common/utils/settingUtils')>()),
  applySettings: vi.fn(),
}));
vi.mock('@wails/S3Browser/internal/handlers/settinghandler', () => ({
  GetSettings: vi.fn(),
  SaveSettings: vi.fn(),
  SetLaunchOnStartup: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// Mantine Select never emits null with allowDeselect=false, so a helper button drives that branch.
vi.mock('@/components/inputs/SelectInput', async importOriginal => {
  const Original = (await importOriginal<typeof import('@/components/inputs/SelectInput')>()).default;
  return {
    default: (props: React.ComponentProps<typeof Original>) => (
      <>
        <Original {...props} />
        <button type="button" onClick={() => props.onChange?.(null, null as never)}>
          {`null-${props.label}`}
        </button>
      </>
    ),
  };
});
vi.mock('@/components/modals/lazyModals', () => ({ showUnsavedSettingModal: vi.fn() }));

const callIPCMock = vi.mocked(callIPC);
const unsavedMock = vi.mocked(showUnsavedSettingModal);
const updaterCalls = () => callIPCMock.mock.calls.filter(call => call[0] === SetUpdateOptions);
const flush = () => act(async () => {});
const state = () => useSettingStore.getState();
const AUTO_UPDATE_LABEL = 'Automatically check for and download updates';
const BETA_LABEL = 'Receive beta (pre-release) versions';
const realSave = state().save;
const realApply = state().apply;

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
    useSettingStore.setState({ save: realSave, apply: realApply });
    state().reset();
    useUpdateStore.getState().reset();
    vi.clearAllMocks();
    unsavedMock.mockResolvedValue('back');
  });

  afterEach(async () => {
    await flush();
  });

  it('shows the draft values in the selects', async () => {
    useSettingStore.setState({ draft: { ...DEFAULT_SETTINGS, theme: 'dark', font: 'arial', language: 'vi' } });
    open();
    await flush();

    expect(screen.getByRole('combobox', { name: 'Theme' })).toHaveValue('Dark');
    expect(screen.getByRole('combobox', { name: 'Font' })).toHaveValue('Arial');
    expect(screen.getByRole('combobox', { name: 'Language' })).toHaveValue('Tiếng Việt');
  });

  it('lists the native names of the new languages and selects them', async () => {
    const user = userEvent.setup();
    open();
    await flush();

    await user.click(screen.getByRole('combobox', { name: 'Language' }));
    for (const name of ['简体中文', '繁體中文', 'Русский', 'Deutsch']) {
      expect(await screen.findByRole('option', { name, hidden: true })).toBeInTheDocument();
    }
    await user.click(screen.getByRole('option', { name: '繁體中文', hidden: true }));

    expect(state().draft.language).toBe('zh-TW');
    expect(screen.getByRole('combobox', { name: 'Language' })).toHaveValue('繁體中文');
  });

  it.each([
    ['zh-CN', 'Microsoft YaHei UI'],
    ['zh-TW', 'Microsoft JhengHei UI'],
    ['ja', 'Yu Gothic UI'],
  ] as const)('previews the font options with the %s fallback (%s)', async (language, fallback) => {
    const user = userEvent.setup();
    useSettingStore.setState({ draft: { ...DEFAULT_SETTINGS, language } });
    open();
    await flush();

    await user.click(screen.getByRole('combobox', { name: 'Font' }));
    const label = await screen.findByText('Arial', { selector: 'span[style]' });

    expect(label.style.fontFamily).toContain(fallback);
    expect(label.style.fontFamily).toContain('Arial');
  });

  it('hides the launch on startup switch when autostart is not supported', async () => {
    open();
    await flush();

    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('hides the auto update switch and the update section when updates are not supported', async () => {
    open();
    await flush();

    expect(screen.queryByRole('switch', { name: AUTO_UPDATE_LABEL })).toBeNull();
    expect(screen.queryByRole('switch', { name: BETA_LABEL })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Check for updates' })).not.toBeInTheDocument();
  });

  it('shows the update section and an auto update switch that only changes the draft', async () => {
    const user = userEvent.setup();
    useUpdateStore.setState({ supported: true, currentVersion: '1.0.0' });
    open();
    await flush();

    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeInTheDocument();
    const autoUpdate = screen.getByRole('switch', { name: AUTO_UPDATE_LABEL });
    expect(autoUpdate).toBeChecked();

    await user.click(autoUpdate);

    expect(state().draft.autoUpdate).toBe(false);
    expect(state().saved.autoUpdate).toBe(true);
    expect(autoUpdate).not.toBeChecked();
    // Reaches the updater at once, but is not saved to settings.json.
    await waitFor(() => expect(updaterCalls()).toHaveLength(1));
    expect(callIPCMock).toHaveBeenCalledWith(SetUpdateOptions, [false, false], {
      scope: 'Setting/syncUpdater',
      showMessage: false,
    });
    expect(callIPCMock).not.toHaveBeenCalledWith(SaveSettings, expect.anything(), expect.anything());
  });

  it('shows a beta switch that only changes the draft when updates are supported', async () => {
    const user = userEvent.setup();
    useUpdateStore.setState({ supported: true, currentVersion: '1.0.0' });
    open();
    await flush();

    const beta = screen.getByRole('switch', { name: BETA_LABEL });
    expect(beta).not.toBeChecked();

    await user.click(beta);

    expect(state().draft.betaUpdate).toBe(true);
    expect(state().saved.betaUpdate).toBe(false);
    expect(beta).toBeChecked();
    await waitFor(() => expect(updaterCalls()).toHaveLength(1));
    expect(callIPCMock).toHaveBeenCalledWith(SetUpdateOptions, [true, true], expect.anything());
    expect(callIPCMock).not.toHaveBeenCalledWith(SaveSettings, expect.anything(), expect.anything());
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

    expect(state().draft).toEqual({
      theme: 'dark',
      font: 'jetbrains-mono',
      language: 'ja',
      launchOnStartup: true,
      autoUpdate: true,
      betaUpdate: false,
    });
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

  // Intended behaviour change (sprint-17 Q2=A): Apply writes launchOnStartup at once.
  it('apply keeps the values for the session, writes launchOnStartup, shows a toast and does not save', async () => {
    const user = userEvent.setup();
    useSettingStore.setState({ autostartSupported: true });
    callIPCMock.mockResolvedValueOnce({ settings: { ...DEFAULT_SETTINGS, launchOnStartup: true } });
    open();
    await flush();

    await pickOption(user, 'Theme', 'Dark');
    await user.click(screen.getByRole('switch', { name: 'Launch on Windows startup' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Settings applied until the app is closed.'));
    expect(state().applied).toEqual({ ...DEFAULT_SETTINGS, theme: 'dark', launchOnStartup: true });
    expect(state().saved).toEqual({ ...DEFAULT_SETTINGS, launchOnStartup: true });
    expect(callIPCMock).toHaveBeenCalledExactlyOnceWith(SetLaunchOnStartup, [true], expect.anything());
    expect(callIPCMock).not.toHaveBeenCalledWith(SaveSettings, expect.anything(), expect.anything());
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('apply without a launchOnStartup change makes no IPC call and still shows the toast', async () => {
    const user = userEvent.setup();
    open();
    await flush();

    await pickOption(user, 'Theme', 'Dark');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Settings applied until the app is closed.'));
    expect(callIPCMock).not.toHaveBeenCalled();
  });

  it('apply shows no toast and keeps applied when the IPC returns null', async () => {
    const user = userEvent.setup();
    useSettingStore.setState({ autostartSupported: true });
    callIPCMock.mockResolvedValueOnce(null);
    open();
    await flush();

    await user.click(screen.getByRole('switch', { name: 'Launch on Windows startup' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await flush();

    expect(callIPCMock).toHaveBeenCalledWith(SetLaunchOnStartup, [true], expect.anything());
    expect(toast.success).not.toHaveBeenCalled();
    expect(state().applied).toEqual(DEFAULT_SETTINGS);
  });

  it('apply shows no toast when the store rejects', async () => {
    const user = userEvent.setup();
    useSettingStore.setState({ apply: vi.fn().mockRejectedValue(new Error('boom')) });
    open();
    await flush();

    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await flush();

    expect(toast.success).not.toHaveBeenCalled();
  });

  it('cancel after apply does not undo a written launchOnStartup', async () => {
    const user = userEvent.setup();
    useSettingStore.setState({ autostartSupported: true });
    callIPCMock.mockResolvedValueOnce({ settings: { ...DEFAULT_SETTINGS, launchOnStartup: true } });
    const result = open();
    await flush();

    await user.click(screen.getByRole('switch', { name: 'Launch on Windows startup' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await expect(result).resolves.toBe(false);
    expect(state().draft.launchOnStartup).toBe(true);
    expect(state().applied.launchOnStartup).toBe(true);
    expect(callIPCMock).not.toHaveBeenCalledWith(SetLaunchOnStartup, [false], expect.anything());
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

  it('offers the follow system theme and previews it', async () => {
    const user = userEvent.setup();
    open();
    await flush();

    await pickOption(user, 'Theme', 'Follow system');

    expect(state().draft.theme).toBe('auto');
    expect(applySettings).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'auto' }));
  });

  describe('while saving', () => {
    function pendingSave() {
      let finish!: (value: unknown) => void;
      callIPCMock.mockReturnValueOnce(new Promise(resolve => (finish = resolve)));
      return (value: unknown) => act(async () => finish(value));
    }

    it('locks every button and the close button, Save shows loading', async () => {
      const user = userEvent.setup();
      pendingSave();
      open();
      await flush();

      await user.click(screen.getByRole('button', { name: 'Save' }));

      expect(await screen.findByRole('button', { name: 'Cancel' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Reset to default' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('data-loading', 'true');
    });

    it('does not close on Escape or on overlay click and does not revert', async () => {
      const user = userEvent.setup();
      pendingSave();
      const result = open();
      let settled = false;
      result.then(() => (settled = true));
      await flush();

      await pickOption(user, 'Theme', 'Dark');
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await screen.findByRole('button', { name: 'Cancel' });
      const applyCalls = vi.mocked(applySettings).mock.calls.length;

      await user.keyboard('{Escape}');
      const overlay = document.querySelector('.mantine-Modal-overlay');
      expect(overlay).not.toBeNull();
      await user.click(overlay as Element);
      await flush();

      expect(settled).toBe(false);
      expect(screen.getByRole('combobox', { name: 'Theme' })).toHaveValue('Dark');
      expect(state().draft.theme).toBe('dark');
      expect(vi.mocked(applySettings).mock.calls.length).toBe(applyCalls);
    });

    it('unlocks the buttons and stays open when the save returns false', async () => {
      const user = userEvent.setup();
      const finish = pendingSave();
      open();
      await flush();

      await user.click(screen.getByRole('button', { name: 'Save' }));
      expect(await screen.findByRole('button', { name: 'Cancel' })).toBeDisabled();
      await finish(null);

      await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled());
      expect(screen.getByRole('button', { name: 'Reset to default' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled();
      expect(toast.success).not.toHaveBeenCalled();
    });

    it('unlocks the buttons, shows no toast and stays open when save() rejects', async () => {
      const user = userEvent.setup();
      useSettingStore.setState({ save: vi.fn().mockRejectedValue(new Error('boom')) });
      let settled = false;
      open().then(() => (settled = true));
      await flush();

      await user.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled());
      expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled();
      expect(toast.success).not.toHaveBeenCalled();
      expect(settled).toBe(false);
    });

    it('closes again with Escape after a failed save', async () => {
      const user = userEvent.setup();
      const finish = pendingSave();
      const result = open();
      await flush();

      await user.click(screen.getByRole('button', { name: 'Save' }));
      await screen.findByRole('button', { name: 'Cancel' });
      await finish(null);
      await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled());
      await user.keyboard('{Escape}');

      await expect(result).resolves.toBeNull();
    });

    it('toasts, resolves true and closes when the save succeeds', async () => {
      const user = userEvent.setup();
      const finish = pendingSave();
      const result = open();
      await flush();

      await user.click(screen.getByRole('button', { name: 'Save' }));
      await screen.findByRole('button', { name: 'Cancel' });
      await finish({ settings: DEFAULT_SETTINGS });

      await expect(result).resolves.toBe(true);
      expect(toast.success).toHaveBeenCalledWith('Settings saved.');
    });

    it('keeps the launchOnStartup value the backend returns (STE003)', async () => {
      const user = userEvent.setup();
      useSettingStore.setState({ autostartSupported: true });
      callIPCMock.mockResolvedValueOnce({ settings: { ...DEFAULT_SETTINGS, launchOnStartup: false } });
      const result = open();
      await flush();

      await user.click(screen.getByRole('switch', { name: 'Launch on Windows startup' }));
      await user.click(screen.getByRole('button', { name: 'Save' }));

      await expect(result).resolves.toBe(true);
      expect(callIPCMock).toHaveBeenCalledWith(
        SaveSettings,
        [{ ...DEFAULT_SETTINGS, launchOnStartup: true }],
        expect.anything()
      );
      expect(state().saved.launchOnStartup).toBe(false);
      expect(state().draft.launchOnStartup).toBe(false);
    });
  });

  it.each(['Theme', 'Font', 'Language'])('ignores a null %s selection', async label => {
    const user = userEvent.setup();
    open();
    await flush();

    await user.click(screen.getByRole('button', { name: `null-${label}` }));

    expect(state().draft).toEqual(DEFAULT_SETTINGS);
    expect(applySettings).not.toHaveBeenCalled();
  });

  describe('while applying', () => {
    function pendingApply() {
      let finish!: (value: boolean) => void;
      let fail!: (reason: Error) => void;
      useSettingStore.setState({
        apply: vi.fn().mockReturnValue(
          new Promise<boolean>((resolve, reject) => {
            finish = resolve;
            fail = reject;
          })
        ),
      });
      return {
        finish: (value: boolean) => act(async () => finish(value)),
        fail: () => act(async () => fail(new Error('boom'))),
      };
    }

    async function startApply(user: ReturnType<typeof userEvent.setup>) {
      await user.click(screen.getByRole('button', { name: 'Apply' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled());
    }

    it('locks every button, ignores Escape and overlay click', async () => {
      const user = userEvent.setup();
      const pending = pendingApply();
      let settled = false;
      open().then(() => (settled = true));
      await flush();

      await startApply(user);

      expect(screen.getByRole('button', { name: 'Reset to default' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();

      await user.keyboard('{Escape}');
      await user.click(document.querySelector('.mantine-Modal-overlay') as Element);
      await flush();

      expect(settled).toBe(false);
      expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument();
      expect(toast.success).not.toHaveBeenCalled();
      await pending.finish(false);
    });

    it('unlocks the buttons and toasts when apply resolves true', async () => {
      const user = userEvent.setup();
      const pending = pendingApply();
      open();
      await flush();

      await startApply(user);
      await pending.finish(true);

      await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled());
      expect(screen.getByRole('button', { name: 'Reset to default' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled();
      expect(toast.success).toHaveBeenCalledExactlyOnceWith('Settings applied until the app is closed.');
    });

    it('unlocks the buttons without a toast when apply resolves false', async () => {
      const user = userEvent.setup();
      const pending = pendingApply();
      open();
      await flush();

      await startApply(user);
      await pending.finish(false);

      await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled());
      expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();
      expect(toast.success).not.toHaveBeenCalled();
    });

    it('unlocks the buttons without a toast when apply rejects', async () => {
      const user = userEvent.setup();
      const pending = pendingApply();
      open();
      await flush();

      await startApply(user);
      await pending.fail();

      await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled());
      expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled();
      expect(toast.success).not.toHaveBeenCalled();
    });
  });

  describe('when another modal is on top', () => {
    it('ignores Escape and overlay click: no revert and the modal stays open', async () => {
      const user = userEvent.setup();
      let settled = false;
      open().then(() => (settled = true));
      await flush();

      await pickOption(user, 'Theme', 'Dark');
      act(() => useModalStackStore.getState().acquire('other-modal'));
      const applyCalls = vi.mocked(applySettings).mock.calls.length;

      await user.keyboard('{Escape}');
      const overlay = document.querySelector('.mantine-Modal-overlay');
      expect(overlay).not.toBeNull();
      await user.click(overlay as Element);
      await flush();

      expect(settled).toBe(false);
      expect(screen.getByRole('combobox', { name: 'Theme' })).toHaveValue('Dark');
      expect(state().draft.theme).toBe('dark');
      expect(vi.mocked(applySettings).mock.calls.length).toBe(applyCalls);
    });

    it('closes with Escape again once it is topmost', async () => {
      const user = userEvent.setup();
      const result = open();
      await flush();

      act(() => useModalStackStore.getState().acquire('other-modal'));
      await user.keyboard('{Escape}');
      act(() => useModalStackStore.getState().release('other-modal'));
      await flush();
      await user.keyboard('{Escape}');

      await expect(result).resolves.toBeNull();
    });
  });

  it('closing with the close button when nothing changed resolves null without a warning', async () => {
    const user = userEvent.setup();
    const result = open();
    await flush();

    await user.click(screen.getByRole('button', { name: 'Close' }));

    await expect(result).resolves.toBeNull();
    expect(unsavedMock).not.toHaveBeenCalled();
    expect(state().draft).toEqual(DEFAULT_SETTINGS);
    expect(callIPCMock).not.toHaveBeenCalled();
  });

  it('closing with Escape when nothing changed resolves null without a warning', async () => {
    const user = userEvent.setup();
    const result = open();
    await flush();

    await user.keyboard('{Escape}');

    await expect(result).resolves.toBeNull();
    expect(unsavedMock).not.toHaveBeenCalled();
  });

  it('does not warn after Apply because the draft equals the applied values', async () => {
    const user = userEvent.setup();
    const result = open();
    await flush();

    await pickOption(user, 'Theme', 'Dark');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await user.click(screen.getByRole('button', { name: 'Close' }));

    await expect(result).resolves.toBeNull();
    expect(unsavedMock).not.toHaveBeenCalled();
    expect(state().draft.theme).toBe('dark');
  });

  describe('unsaved changes', () => {
    it.each([
      [
        'the close button',
        async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Close' })),
      ],
      ['Escape', async (user: ReturnType<typeof userEvent.setup>) => user.keyboard('{Escape}')],
      [
        'a click outside',
        async (user: ReturnType<typeof userEvent.setup>) =>
          user.click(document.querySelector('.mantine-Modal-overlay') as Element),
      ],
    ])('asks what to do when %s is used with a changed draft', async (_name, close) => {
      const user = userEvent.setup();
      open();
      await flush();

      await pickOption(user, 'Theme', 'Dark');
      await close(user);
      await flush();

      expect(unsavedMock).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    });

    it('back keeps the modal open and the draft untouched', async () => {
      const user = userEvent.setup();
      let settled = false;
      open().then(() => (settled = true));
      await flush();

      await pickOption(user, 'Theme', 'Dark');
      unsavedMock.mockResolvedValue('back');
      await user.click(screen.getByRole('button', { name: 'Close' }));
      await flush();

      expect(settled).toBe(false);
      expect(state().draft.theme).toBe('dark');
      expect(screen.getByRole('combobox', { name: 'Theme' })).toHaveValue('Dark');
      expect(callIPCMock).not.toHaveBeenCalled();
    });

    it('a null answer (modal dismissed) keeps the modal open too', async () => {
      const user = userEvent.setup();
      let settled = false;
      open().then(() => (settled = true));
      await flush();

      await pickOption(user, 'Theme', 'Dark');
      unsavedMock.mockResolvedValue(undefined);
      await user.click(screen.getByRole('button', { name: 'Close' }));
      await flush();

      expect(settled).toBe(false);
      expect(state().draft.theme).toBe('dark');
    });

    it('discard reverts the draft, the updater and closes with null', async () => {
      const user = userEvent.setup();
      const result = open();
      await flush();

      await pickOption(user, 'Theme', 'Dark');
      useUpdateStore.setState({ supported: true, currentVersion: '1.0.0' });
      await flush();
      await user.click(screen.getByRole('switch', { name: BETA_LABEL }));
      await waitFor(() => expect(updaterCalls()).toHaveLength(1));

      unsavedMock.mockResolvedValue('discard');
      await user.click(screen.getByRole('button', { name: 'Close' }));

      await expect(result).resolves.toBeNull();
      expect(state().draft).toEqual(DEFAULT_SETTINGS);
      expect(applySettings).toHaveBeenLastCalledWith(DEFAULT_SETTINGS);
      await waitFor(() => expect(updaterCalls()).toHaveLength(2));
      expect(updaterCalls()[1][1]).toEqual([false, true]);
      expect(callIPCMock).not.toHaveBeenCalledWith(SaveSettings, expect.anything(), expect.anything());
    });

    it('save runs the normal save flow: toast and resolves true', async () => {
      const user = userEvent.setup();
      callIPCMock.mockResolvedValueOnce({ settings: { ...DEFAULT_SETTINGS, theme: 'dark' } });
      const result = open();
      await flush();

      await pickOption(user, 'Theme', 'Dark');
      unsavedMock.mockResolvedValue('save');
      await user.click(screen.getByRole('button', { name: 'Close' }));

      await expect(result).resolves.toBe(true);
      expect(callIPCMock).toHaveBeenCalledWith(SaveSettings, [{ ...DEFAULT_SETTINGS, theme: 'dark' }], {
        scope: 'Setting/save',
      });
      expect(toast.success).toHaveBeenCalledWith('Settings saved.');
      expect(state().saved.theme).toBe('dark');
    });

    it('save that fails keeps the modal open without a toast', async () => {
      const user = userEvent.setup();
      callIPCMock.mockResolvedValueOnce(null);
      let settled = false;
      open().then(() => (settled = true));
      await flush();

      await pickOption(user, 'Theme', 'Dark');
      unsavedMock.mockResolvedValue('save');
      await user.click(screen.getByRole('button', { name: 'Close' }));
      await flush();

      expect(callIPCMock).toHaveBeenCalledWith(SaveSettings, expect.anything(), expect.anything());
      expect(settled).toBe(false);
      expect(toast.success).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
      expect(state().draft.theme).toBe('dark');
    });

    it('the footer Cancel button reverts without a warning even when dirty', async () => {
      const user = userEvent.setup();
      const result = open();
      await flush();

      await pickOption(user, 'Theme', 'Dark');
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      await expect(result).resolves.toBe(false);
      expect(unsavedMock).not.toHaveBeenCalled();
      expect(state().draft).toEqual(DEFAULT_SETTINGS);
    });

    it('a changed update switch alone counts as dirty', async () => {
      const user = userEvent.setup();
      useUpdateStore.setState({ supported: true, currentVersion: '1.0.0' });
      open();
      await flush();

      await user.click(screen.getByRole('switch', { name: AUTO_UPDATE_LABEL }));
      await user.click(screen.getByRole('button', { name: 'Close' }));

      expect(unsavedMock).toHaveBeenCalledTimes(1);
    });
  });
});
