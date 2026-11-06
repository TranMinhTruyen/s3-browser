import type { UpdateStateOutput } from '@wails/S3Browser/models';
import { Events } from '@wailsio/runtime';
import { type MouseEvent, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';
import { useSettingStore } from '@/common/stores/settingStore';
import { useUpdateStore } from '@/common/stores/updateStore';
import { formatStringJson } from '@/common/utils/stringUtils';
import UpdateProgress from '@/components/display/UpdateProgress';
import i18n from '@/locales/i18n';

/** One toast for the whole update flow; every state change updates it instead of stacking a new one. */
const TOAST_ID = 'app-update';

/**
 * Mount once, in `AppUpdateToast` (it re-renders on every progress tick, so keep it out of `App`). Loads the update state, follows `update:state-changed` and keeps the toast in step:
 * a new version (Download button only when auto update is off), download progress, ready to install.
 */
export function useAppUpdate() {
  const { t } = useTranslation('appUpdate');

  const autoUpdate = useSettingStore(s => s.saved.autoUpdate);
  const { supported, state, version, written, total } = useUpdateStore(
    useShallow(s => ({
      supported: s.supported,
      state: s.state,
      version: s.version,
      written: s.written,
      total: s.total,
    }))
  );
  const load = useUpdateStore(s => s.load);
  const download = useUpdateStore(s => s.download);
  const install = useUpdateStore(s => s.install);

  const onUpdateStateChanged = useCallback((next: UpdateStateOutput) => {
    const { state: previous, setState } = useUpdateStore.getState();
    setState(next);
    // The download runs in the background, so its failure only arrives here (the user did not call it).
    if (previous === 'downloading' && next.state === 'error' && next.errorCode) {
      toast.error(formatStringJson(i18n.t(`ipcMessage:update.${next.errorCode}`), { version: next.version }));
    }
  }, []);

  const onClickDownload = useCallback(() => void download(), [download]);

  // Keep the toast: install may be canceled in the confirm modal.
  const onClickInstall = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      void install();
    },
    [install]
  );

  useEffect(() => {
    void load();
    return Events.On('update:state-changed', e => onUpdateStateChanged(e.data));
  }, [load, onUpdateStateChanged]);

  useEffect(() => {
    if (!supported) return;
    if (state === 'available') {
      toast(t('available', { version }), {
        id: TOAST_ID,
        duration: Infinity,
        description: undefined,
        action: autoUpdate ? undefined : { label: t('button.download'), onClick: onClickDownload },
      });
    } else if (state === 'downloading') {
      toast(t('downloading', { version }), {
        id: TOAST_ID,
        duration: Infinity,
        description: <UpdateProgress written={written} total={total} />,
        action: undefined,
      });
    } else if (state === 'ready') {
      toast(t('ready', { version }), {
        id: TOAST_ID,
        duration: Infinity,
        description: undefined,
        action: { label: t('button.install'), onClick: onClickInstall },
      });
    } else {
      toast.dismiss(TOAST_ID);
    }
  }, [supported, state, version, written, total, autoUpdate, t, onClickDownload, onClickInstall]);
}
