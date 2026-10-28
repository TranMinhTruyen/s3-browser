import { FilesDroppedOutput } from '@wails/S3Browser/models/bucket';
import { Events } from '@wailsio/runtime';
import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { formatStringJson } from '@/common/utils/stringUtils';
import { ensureUploadIdle, runUpload } from '@/common/utils/uploadUtils';
import UploadLimitModal from '@/components/modals/UploadLimitModal';
import i18n from '@/locales/i18n';

type UseFilesDroppedUploadParams = {
  tabId: string;
  connectionId?: string;
  profileName?: string;
  bucket?: string;
  prefix: string;
  onRefresh: () => Promise<void>;
};

/**
 * Uploads files dropped on this tab (`uploader:files-dropped` event): shows limit warnings, lets the user
 * pick files when a limit is exceeded, then uploads into the current folder and refreshes the list.
 */
export function useFilesDroppedUpload(params: UseFilesDroppedUploadParams) {
  const { tabId, connectionId, profileName, bucket, prefix, onRefresh } = params;

  // An upload can outlive this render (the user may open another folder meanwhile) or the
  // view itself, so it refreshes through these refs: the list currently shown, if still mounted.
  const onRefreshRef = useRef(onRefresh);
  const isMountedRef = useRef(true);
  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

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

      // A group over a limit needs the user to choose which files to upload.
      if (groups.some(group => group.overMaxFiles || group.overLargeCount)) {
        const chosen = await UploadLimitModal.show({
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

      // runUpload checks again: another tab may have started an upload while the modal was open.
      await runUpload({ tabId, connectionId, profileName, bucket, prefix, files }, async () => {
        if (isMountedRef.current) await onRefreshRef.current();
      });
    },
    [bucket, connectionId, prefix, profileName, tabId]
  );

  useEffect(() => {
    const unsubscribe = Events.On('uploader:files-dropped', e => {
      // Every open tab listens; only the tab the files were dropped on handles them.
      if (e.data?.tabId === tabId) {
        onFilesDropped(e.data);
      }
    });
    return () => {
      unsubscribe();
    };
  }, [onFilesDropped, tabId]);
}
