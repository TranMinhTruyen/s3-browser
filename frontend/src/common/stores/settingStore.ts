import { GetSettings, SaveSettings, SetLaunchOnStartup } from '@wails/S3Browser/internal/handlers/settinghandler';
import { SetUpdateOptions } from '@wails/S3Browser/internal/handlers/updatehandler';
import { type AppSettingValues, DEFAULT_SETTINGS } from '@/common/cnst/settingConst';
import { createAppStore } from '@/common/stores/createStore';
import { callIPC, invalidateLoads } from '@/common/utils/ipcUtils';
import { applySettings, isUpdateOptionsChanged, normalizeSettings } from '@/common/utils/settingUtils';

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
  /** Updates the draft and previews it; the update switches reach the updater at once (not saved). */
  setDraft: (patch: Partial<AppSettingValues>) => void;
  /** Saves the draft; resolves true on success. */
  save: () => Promise<boolean>;
  /** Keeps the draft for this session only (not saved), but writes launchOnStartup at once; resolves true on success. */
  apply: () => Promise<boolean>;
  /** Puts the draft back to the defaults (previewed, not saved). */
  resetDraft: () => void;
  /** Drops the draft and restores the applied values. */
  revert: () => void;
  /** Clears the store back to the defaults and drops pending loads (used on app reset). */
  reset: () => boolean;
}

const SCOPE = 'Setting';

/** Updater calls run one after another, so toggling switches fast cannot make them arrive out of order. */
let updaterQueue: Promise<unknown> = Promise.resolve();

/** Sends both update switches to the updater (not saved) when `next` changes them compared to `previous`. */
const syncUpdater = (previous: AppSettingValues, next: AppSettingValues) => {
  if (!isUpdateOptionsChanged(previous, next)) {
    return;
  }
  updaterQueue = updaterQueue
    .then(() =>
      callIPC(SetUpdateOptions, [next.betaUpdate, next.autoUpdate], {
        scope: `${SCOPE}/syncUpdater`,
        showMessage: false,
      })
    )
    .catch(() => null);
};

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
      const previous = get().draft;
      const draft = { ...previous, ...patch };
      set({ draft }, undefined, `${SCOPE}/setDraft`);
      applySettings(draft);
      syncUpdater(previous, draft);
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

    apply: async () => {
      const { draft, applied } = get();
      let launchOnStartup = draft.launchOnStartup;
      if (launchOnStartup !== applied.launchOnStartup) {
        // launchOnStartup is registry state, so it is written now and Cancel cannot undo it.
        const output = await callIPC(SetLaunchOnStartup, [launchOnStartup], { scope: `${SCOPE}/apply` });
        if (!output) {
          return false;
        }
        // The backend may keep the old value (STE003), so follow what it returns.
        launchOnStartup = output.settings?.launchOnStartup === true;
      }
      set(
        state => {
          state.applied = { ...draft, launchOnStartup };
          state.saved.launchOnStartup = launchOnStartup;
          state.draft.launchOnStartup = launchOnStartup;
        },
        undefined,
        `${SCOPE}/apply`
      );
      return true;
    },

    resetDraft: () => {
      const previous = get().draft;
      const draft = { ...DEFAULT_SETTINGS };
      set({ draft }, undefined, `${SCOPE}/resetDraft`);
      applySettings(draft);
      syncUpdater(previous, draft);
    },

    revert: () => {
      const { applied, draft } = get();
      set({ draft: applied }, undefined, `${SCOPE}/revert`);
      applySettings(applied);
      syncUpdater(draft, applied);
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
