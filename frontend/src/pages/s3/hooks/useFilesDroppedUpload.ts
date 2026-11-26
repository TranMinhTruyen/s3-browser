import { FilesDroppedOutput } from '@wails/S3Browser/models/bucket';
import { Events } from '@wailsio/runtime';
import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { formatStringJson } from '@/common/utils/stringUtils';
import { showUploadLimitModal } from '@/components/modals/lazyModals';
import i18n from '@/locales/i18n';
import { onTabGone } from '@/pages/s3/utils/tabUtils';
import { ensureUploadIdle, runUpload } from '@/pages/s3/utils/uploadUtils';

type UseFilesDroppedUploadParams = {
  tabId: string;
  connectionId?: string;
  profileName?: string;
  bucket?: string;
  prefix: string;
  onRefresh: () => Promise<void>;
};

/**
 * Tải lên các file được thả vào tab này (sự kiện `uploader:files-dropped`): cảnh báo khi vượt giới hạn, cho phép người dùng
 * chọn file nếu vượt giới hạn, sau đó tải lên thư mục hiện tại và làm mới danh sách.
 */
export function useFilesDroppedUpload(params: UseFilesDroppedUploadParams) {
  const { tabId, connectionId, profileName, bucket, prefix, onRefresh } = params;

  // Một lượt tải có thể kéo dài qua lần render này (người dùng có thể mở thư mục khác trong lúc chờ) hoặc qua cả vòng đời
  // của view, nên chỉ làm mới qua các ref này: danh sách đang hiển thị nếu view vẫn được mount.
  const onRefreshRef = useRef(onRefresh);
  const isMountedRef = useRef(true);
  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);
  useEffect(() => {
    isMountedRef.current = true;
    // Tab bị ẩn (Activity) vẫn còn hoạt động: lượt tải hoàn tất trong lúc đó vẫn phải làm mới danh sách của tab.
    return onTabGone(tabId, () => {
      isMountedRef.current = false;
    });
  }, [tabId]);

  const onFilesDropped = useCallback(
    async ({
      groups,
      skipped,
      overMaxTotal,
      capped,
      maxFilesPerFolder,
      largeFileSize,
      largeFileMaxCount,
      maxTotalFiles,
    }: FilesDroppedOutput) => {
      if (!connectionId || !bucket) return;
      if (skipped > 0) {
        toast.warning(formatStringJson(i18n.t('ipcMessage:bucket.S3W006'), { count: skipped }));
      }
      if (overMaxTotal) {
        toast.warning(formatStringJson(i18n.t('ipcMessage:bucket.S3W007'), { max: maxTotalFiles }));
      }
      let files = groups.flatMap(group => group.files);
      if (files.length === 0) return;

      if (!ensureUploadIdle()) return;

      // Nhóm vượt giới hạn cần người dùng chọn những file sẽ tải lên.
      if (groups.some(group => group.overMaxFiles || group.overLargeCount)) {
        // undefined nghĩa là không tải được phần modal (đã hiện toast) hoặc người dùng đã hủy; không tải file lên.
        const chosen = await showUploadLimitModal({
          groups,
          maxFilesPerFolder,
          largeFileSize,
          largeFileMaxCount,
          capped,
        });
        if (!chosen || chosen.length === 0) return;
        files = chosen;
      } else if (capped) {
        toast.warning(i18n.t('uploadLimitModal:cappedWarning'));
      }

      // runUpload kiểm tra lại vì tab khác có thể đã bắt đầu tải file trong lúc modal mở.
      await runUpload({ tabId, connectionId, profileName, bucket, prefix, files }, async () => {
        if (isMountedRef.current) await onRefreshRef.current();
      });
    },
    [bucket, connectionId, prefix, profileName, tabId]
  );

  useEffect(() => {
    const unsubscribe = Events.On('uploader:files-dropped', e => {
      // Mọi tab đang mở đều lắng nghe; chỉ tab nơi file được thả mới xử lý sự kiện.
      if (e.data?.tabId === tabId) {
        onFilesDropped(e.data);
      }
    });
    return () => {
      unsubscribe();
    };
  }, [onFilesDropped, tabId]);
}
