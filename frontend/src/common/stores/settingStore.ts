import { GetSettings, SaveSettings } from '@wails/S3Browser/internal/handlers/settinghandler';
import { type AppSettingValues, DEFAULT_SETTINGS } from '@/common/cnst/settingConst';
import { createAppStore } from '@/common/stores/createStore';
import { callIPC, invalidateLoads } from '@/common/utils/ipcUtils';
import { applySettings, normalizeSettings } from '@/common/utils/settingUtils';

interface SettingState {
  /** Values persisted in settings.json. */
  saved: AppSettingValues;
  /** Values in effect for this session (saved values plus Apply); lost when the app closes. */
  applied: AppSettingValues;
  /** Values being edited in the modal; theme, font and language are previewed live. */
  draft: AppSettingValues;
  autostartSupported: boolean;
}

interface SettingAction {
  /** Loads settings.json and applies it; keeps the defaults when loading fails. */
  load: () => Promise<void>;
  /** Updates the draft and previews it. */
  setDraft: (patch: Partial<AppSettingValues>) => void;
  /** Saves the draft; resolves true on success. */
  save: () => Promise<boolean>;
  /** Keeps theme, font and language of the draft for this session only (not saved, autostart untouched). */
  apply: () => void;
  /** Puts the draft back to the defaults (previewed, not saved). */
  resetDraft: () => void;
  /** Drops the draft and restores the applied values. */
  revert: () => void;
  /** Clears the store back to the defaults and drops pending loads (used on app reset). */
  reset: () => boolean;
}

const SCOPE = 'Setting';

/** App settings (theme, font, language, launch on startup). */
export const useSettingStore = createAppStore<SettingState & SettingAction>((set, get) => {
  const setBoth = (values: AppSettingValues, action: string): Promise<void> => {
    set(
      state => {
        state.saved = values;
        state.applied = values;
        state.draft = values;
      },
      undefined,
      `${SCOPE}/${action}`
    );
    return applySettings(values);
  };

  return {
    saved: DEFAULT_SETTINGS,
    applied: DEFAULT_SETTINGS,
    draft: DEFAULT_SETTINGS,
    autostartSupported: false,

    load: async () => {
      const output = await callIPC(GetSettings, [], { scope: `${SCOPE}/load`, showMessage: false });
      const values = normalizeSettings(output?.settings);
      await setBoth(values, 'load');
      set({ autostartSupported: output?.autostartSupported === true }, undefined, `${SCOPE}/load`);
    },

    setDraft: patch => {
      const draft = { ...get().draft, ...patch };
      set({ draft }, undefined, `${SCOPE}/setDraft`);
      applySettings(draft);
    },

    save: async () => {
      const output = await callIPC(SaveSettings, [get().draft], { scope: `${SCOPE}/save` });
      if (!output) {
        return false;
      }
      // The backend may keep a different launchOnStartup (STE003), so follow what it returns.
      setBoth(normalizeSettings(output.settings), 'save');
      return true;
    },

    apply: () => {
      const { draft, applied } = get();
      // launchOnStartup (registry) and autoUpdate (updater schedule) are backend state, so they only change on Save.
      set(
        { applied: { ...draft, launchOnStartup: applied.launchOnStartup, autoUpdate: applied.autoUpdate } },
        undefined,
        `${SCOPE}/apply`
      );
    },

    resetDraft: () => {
      const draft = { ...DEFAULT_SETTINGS };
      set({ draft }, undefined, `${SCOPE}/resetDraft`);
      applySettings(draft);
    },

    revert: () => {
      const { applied } = get();
      set({ draft: applied }, undefined, `${SCOPE}/revert`);
      applySettings(applied);
    },

    reset: () => {
      invalidateLoads(SCOPE);
      set(
        { saved: DEFAULT_SETTINGS, applied: DEFAULT_SETTINGS, draft: DEFAULT_SETTINGS, autostartSupported: false },
        undefined,
        `${SCOPE}/reset`
      );
      return true;
    },
  };
}, SCOPE);
