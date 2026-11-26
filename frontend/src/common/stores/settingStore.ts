import { GetSettings, SaveSettings, SetLaunchOnStartup } from '@wails/S3Browser/internal/handlers/settinghandler';
import { SetUpdateOptions } from '@wails/S3Browser/internal/handlers/updatehandler';
import { type AppSettingValues, DEFAULT_SETTINGS } from '@/common/cnst/settingConst';
import { createAppStore } from '@/common/stores/createStore';
import { callIPC, invalidateLoads } from '@/common/utils/ipcUtils';
import { applySettings, isUpdateOptionsChanged, normalizeSettings } from '@/common/utils/settingUtils';

interface SettingState {
  /** Các giá trị được lưu trong settings.json. */
  saved: AppSettingValues;
  /** Các giá trị đang áp dụng trong phiên này (giá trị đã lưu cộng với thay đổi được áp dụng); mất khi đóng ứng dụng. */
  applied: AppSettingValues;
  /** Các giá trị đang chỉnh sửa trong modal; giao diện, phông chữ và ngôn ngữ được xem trước trực tiếp. */
  draft: AppSettingValues;
  autostartSupported: boolean;
}

interface SettingAction {
  /** Tải và áp dụng settings.json; giữ giá trị mặc định nếu tải thất bại. */
  load: () => Promise<void>;
  /** Cập nhật và xem trước bản nháp; các tùy chọn cập nhật được chuyển ngay cho trình cập nhật (chưa lưu). */
  setDraft: (patch: Partial<AppSettingValues>) => void;
  /** Lưu bản nháp; trả về true nếu thành công. */
  save: () => Promise<boolean>;
  /** Chỉ giữ bản nháp trong phiên này (không lưu), nhưng ghi launchOnStartup ngay; trả về true nếu thành công. */
  apply: () => Promise<boolean>;
  /** Đưa bản nháp về mặc định (được xem trước nhưng chưa lưu). */
  resetDraft: () => void;
  /** Bỏ bản nháp và khôi phục các giá trị đang áp dụng. */
  revert: () => void;
  /** Đặt store về mặc định và loại bỏ các lượt tải đang chờ (dùng khi reset ứng dụng). */
  reset: () => boolean;
}

const SCOPE = 'Setting';

/** Các lệnh gọi trình cập nhật chạy lần lượt để thao tác bật/tắt nhanh không làm chúng đến sai thứ tự. */
let updaterQueue: Promise<unknown> = Promise.resolve();

/** Gửi cả hai tùy chọn cập nhật tới trình cập nhật (chưa lưu) khi `next` khác `previous`. */
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

/** Thiết lập ứng dụng (giao diện, phông chữ, ngôn ngữ, chạy khi khởi động). */
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
      // Backend có thể giữ launchOnStartup ở giá trị khác (STE003), nên dùng giá trị backend trả về.
      setBoth(normalizeSettings(output.settings), 'save');
      return true;
    },

    apply: async () => {
      const { draft, applied } = get();
      let launchOnStartup = draft.launchOnStartup;
      if (launchOnStartup !== applied.launchOnStartup) {
        // launchOnStartup là trạng thái trong registry nên được ghi ngay; Cancel không thể hoàn tác.
        const output = await callIPC(SetLaunchOnStartup, [launchOnStartup], { scope: `${SCOPE}/apply` });
        if (!output) {
          return false;
        }
        // Backend có thể giữ giá trị cũ (STE003), nên dùng giá trị backend trả về.
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
