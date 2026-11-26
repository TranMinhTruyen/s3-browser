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

/** Chỉ dùng một toast cho toàn bộ luồng cập nhật; mỗi lần đổi state sẽ cập nhật toast đó thay vì xếp thêm toast mới. */
const TOAST_ID = 'app-update';

/**
 * Chỉ mount một lần trong `AppUpdateToast` (component render lại mỗi khi tiến độ đổi nên không đặt trong `App`). Tải state cập nhật,
 * theo dõi `update:state-changed` và đồng bộ toast theo các trạng thái: có phiên bản mới (chỉ hiện nút Download khi tắt tự động cập nhật),
 * tiến độ tải xuống và sẵn sàng cài đặt.
 */
export function useAppUpdate() {
  const { t } = useTranslation('appUpdate');

  const autoUpdate = useSettingStore(s => s.applied.autoUpdate);
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
    // Tải xuống chạy trong nền nên lỗi chỉ được báo về đây (người dùng không trực tiếp gọi thao tác tải).
    if (previous === 'downloading' && next.state === 'error' && next.errorCode) {
      toast.error(formatStringJson(i18n.t(`ipcMessage:update.${next.errorCode}`), { version: next.version }));
    }
  }, []);

  const onClickDownload = useCallback(() => void download(), [download]);

  // Giữ toast vì người dùng có thể hủy cài đặt trong modal xác nhận.
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
