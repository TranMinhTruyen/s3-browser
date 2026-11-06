import { GetSettings, SaveSettings } from '@wails/S3Browser/internal/handlers/settinghandler';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/common/cnst/settingConst';
import { useSettingStore } from '@/common/stores/settingStore';
import { callIPC, invalidateLoads } from '@/common/utils/ipcUtils';
import { applySettings } from '@/common/utils/settingUtils';

vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));
vi.mock('@/common/utils/settingUtils', async importOriginal => ({
  ...(await importOriginal<typeof import('@/common/utils/settingUtils')>()),
  applySettings: vi.fn(),
}));
vi.mock('@wails/S3Browser/internal/handlers/settinghandler', () => ({ GetSettings: vi.fn(), SaveSettings: vi.fn() }));

const callIPCMock = vi.mocked(callIPC);
const state = () => useSettingStore.getState();
const dark = {
  theme: 'dark',
  font: 'arial',
  language: 'vi',
  launchOnStartup: true,
  autoUpdate: true,
  betaUpdate: true,
} as const;

describe('settingStore', () => {
  beforeEach(() => {
    state().reset();
    vi.clearAllMocks();
  });

  describe('load', () => {
    it('stores and applies the loaded settings and the autostart support', async () => {
      callIPCMock.mockResolvedValueOnce({ settings: dark, autostartSupported: true });
      await state().load();

      expect(callIPCMock).toHaveBeenCalledWith(GetSettings, [], { scope: 'Setting/load', showMessage: false });
      expect(state().saved).toEqual(dark);
      expect(state().draft).toEqual(dark);
      expect(state().autostartSupported).toBe(true);
      expect(applySettings).toHaveBeenCalledWith(dark);
    });

    it('waits for applySettings (language bundle) before it finishes', async () => {
      let finish!: () => void;
      vi.mocked(applySettings).mockReturnValueOnce(
        new Promise<void>(resolve => {
          finish = resolve;
        })
      );
      callIPCMock.mockResolvedValueOnce({ settings: dark, autostartSupported: true });

      let done = false;
      const loading = state()
        .load()
        .then(() => {
          done = true;
        });
      await vi.waitFor(() => expect(applySettings).toHaveBeenCalledWith(dark));
      await Promise.resolve();
      expect(done).toBe(false);
      expect(state().autostartSupported).toBe(false);

      finish();
      await loading;
      expect(done).toBe(true);
      expect(state().autostartSupported).toBe(true);
    });

    it('falls back to the defaults and no autostart when the call fails', async () => {
      useSettingStore.setState({ saved: dark, draft: dark, autostartSupported: true });
      callIPCMock.mockResolvedValueOnce(null);
      await state().load();

      expect(state().saved).toEqual(DEFAULT_SETTINGS);
      expect(state().autostartSupported).toBe(false);
      expect(applySettings).toHaveBeenCalledWith(DEFAULT_SETTINGS);
    });

    it('normalizes invalid values and ignores a non-true autostartSupported', async () => {
      callIPCMock.mockResolvedValueOnce({ settings: { theme: 'x' }, autostartSupported: 'yes' });
      await state().load();

      expect(state().saved).toEqual(DEFAULT_SETTINGS);
      expect(state().autostartSupported).toBe(false);
    });
  });

  it('setDraft merges the patch into the draft, previews it and keeps saved untouched', () => {
    state().setDraft({ theme: 'dark' });

    expect(state().draft).toEqual({ ...DEFAULT_SETTINGS, theme: 'dark' });
    expect(state().saved).toEqual(DEFAULT_SETTINGS);
    expect(applySettings).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, theme: 'dark' });
  });

  describe('save', () => {
    it('sends the draft and follows the settings the backend returns', async () => {
      state().setDraft({ theme: 'dark', launchOnStartup: true });
      callIPCMock.mockResolvedValueOnce({ settings: { ...DEFAULT_SETTINGS, theme: 'dark', launchOnStartup: false } });

      await expect(state().save()).resolves.toBe(true);

      expect(callIPCMock).toHaveBeenCalledWith(
        SaveSettings,
        [{ ...DEFAULT_SETTINGS, theme: 'dark', launchOnStartup: true }],
        { scope: 'Setting/save' }
      );
      expect(state().saved).toEqual({ ...DEFAULT_SETTINGS, theme: 'dark', launchOnStartup: false });
      expect(state().draft).toEqual(state().saved);
    });

    it('returns false and keeps the saved values when saving fails', async () => {
      state().setDraft({ theme: 'dark' });
      callIPCMock.mockResolvedValueOnce(null);

      await expect(state().save()).resolves.toBe(false);

      expect(state().saved).toEqual(DEFAULT_SETTINGS);
      expect(state().draft.theme).toBe('dark');
    });
  });

  it('resetDraft puts the draft back to the defaults without saving', () => {
    useSettingStore.setState({ saved: dark, draft: dark });
    state().resetDraft();

    expect(state().draft).toEqual(DEFAULT_SETTINGS);
    expect(state().saved).toEqual(dark);
    expect(applySettings).toHaveBeenCalledWith(DEFAULT_SETTINGS);
  });

  it('revert restores the applied values into the draft', () => {
    useSettingStore.setState({ saved: DEFAULT_SETTINGS, applied: dark, draft: DEFAULT_SETTINGS });
    state().revert();

    expect(state().draft).toEqual(dark);
    expect(state().saved).toEqual(DEFAULT_SETTINGS);
    expect(applySettings).toHaveBeenCalledWith(dark);
  });

  describe('apply', () => {
    it('keeps theme, font and language of the draft but the old launchOnStartup, without IPC or saving', () => {
      state().setDraft({ theme: 'dark', font: 'arial', language: 'vi', launchOnStartup: true });
      state().apply();

      expect(state().applied).toEqual({
        theme: 'dark',
        font: 'arial',
        language: 'vi',
        launchOnStartup: false,
        autoUpdate: true,
        betaUpdate: false,
      });
      expect(state().saved).toEqual(DEFAULT_SETTINGS);
      expect(state().draft.launchOnStartup).toBe(true);
      expect(callIPCMock).not.toHaveBeenCalled();
    });

    it('keeps the previous applied autoUpdate when the draft changes it', () => {
      state().setDraft({ theme: 'dark', autoUpdate: false });
      state().apply();

      expect(state().applied).toEqual({ ...DEFAULT_SETTINGS, theme: 'dark', autoUpdate: true });
      expect(state().draft.autoUpdate).toBe(false);
      expect(state().saved.autoUpdate).toBe(true);
      expect(callIPCMock).not.toHaveBeenCalled();
    });

    it('keeps the previous applied betaUpdate when the draft changes it', () => {
      useSettingStore.setState({ applied: { ...DEFAULT_SETTINGS, betaUpdate: true } });
      state().setDraft({ theme: 'dark', betaUpdate: false });
      state().apply();

      expect(state().applied).toEqual({ ...DEFAULT_SETTINGS, theme: 'dark', betaUpdate: true });
      expect(state().draft.betaUpdate).toBe(false);
    });

    it('keeps the previous applied launchOnStartup', () => {
      useSettingStore.setState({ applied: { ...DEFAULT_SETTINGS, launchOnStartup: true } });
      state().setDraft({ theme: 'dark', launchOnStartup: false });
      state().apply();

      expect(state().applied).toEqual({ ...DEFAULT_SETTINGS, theme: 'dark', launchOnStartup: true });
    });

    it('makes a later revert return to the applied values', () => {
      state().setDraft({ theme: 'dark' });
      state().apply();
      state().setDraft({ theme: 'light', font: 'arial' });
      state().revert();

      expect(state().draft).toEqual({ ...DEFAULT_SETTINGS, theme: 'dark' });
      expect(applySettings).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, theme: 'dark' });
    });
  });

  it('save sends the draft including betaUpdate and follows the returned betaUpdate', async () => {
    state().setDraft({ betaUpdate: true });
    callIPCMock.mockResolvedValueOnce({ settings: { ...DEFAULT_SETTINGS, betaUpdate: true } });
    await expect(state().save()).resolves.toBe(true);

    expect(callIPCMock.mock.calls[0][1]).toEqual([expect.objectContaining({ betaUpdate: true })]);
    expect(state().saved.betaUpdate).toBe(true);
    expect(state().applied.betaUpdate).toBe(true);
  });

  it('save and load also set applied', async () => {
    state().setDraft({ theme: 'dark' });
    callIPCMock.mockResolvedValueOnce({ settings: { ...DEFAULT_SETTINGS, theme: 'dark' } });
    await state().save();
    expect(state().applied).toEqual({ ...DEFAULT_SETTINGS, theme: 'dark' });

    callIPCMock.mockResolvedValueOnce({ settings: dark });
    await state().load();
    expect(state().applied).toEqual(dark);
  });

  it('reset invalidates the pending loads and restores the initial state', () => {
    useSettingStore.setState({ saved: dark, applied: dark, draft: dark, autostartSupported: true });

    expect(state().reset()).toBe(true);

    expect(invalidateLoads).toHaveBeenCalledWith('Setting');
    expect(state().saved).toEqual(DEFAULT_SETTINGS);
    expect(state().applied).toEqual(DEFAULT_SETTINGS);
    expect(state().draft).toEqual(DEFAULT_SETTINGS);
    expect(state().autostartSupported).toBe(false);
  });
});
