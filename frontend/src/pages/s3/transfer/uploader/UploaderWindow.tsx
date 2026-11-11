import { Affix } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import * as AppEvents from '@wails/events';
import { CancelAllUploads } from '@wails/S3Browser/internal/handlers/buckethandler';
import { Events } from '@wailsio/runtime';
import { Upload } from 'lucide-react';
import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/shallow';
import { callIPC } from '@/common/utils/ipcUtils';
import ActionIcon from '@/components/buttons/ActionIcon';
import { useDownloaderStore } from '@/pages/s3/stores/downloaderStore';
import { selectUploadingIds, useUploaderStore } from '@/pages/s3/stores/uploaderStore';
import TransferPanel from '@/pages/s3/transfer/TransferPanel';
import UploaderItem from '@/pages/s3/transfer/uploader/UploaderItem';

const EDGE = 16;
const GAP = 16;
const ITEM_GAP = 8;

/** Floating upload progress window (or a button when closed), placed next to the downloader. */
function UploaderWindow() {
  const { t } = useTranslation('uploaderWindow');

  const [visible, handlers] = useDisclosure();
  const openWindow = handlers.open;

  const uploadItemIds = useUploaderStore(useShallow(selectUploadingIds));
  const startUpload = useUploaderStore(s => s.startUpload);
  const setUploadProgressBatch = useUploaderStore(s => s.setUploadProgressBatch);
  const finishUpload = useUploaderStore(s => s.finishUpload);

  const downloaderWidth = useDownloaderStore(s => s.windowSize.width);
  const downloaderHeight = useDownloaderStore(s => s.windowSize.height);

  useEffect(() => {
    const unsubscribe = Events.On('uploader:upload-started', e => {
      if (e.data) {
        openWindow();
        startUpload(e.data);
      }
    });
    return () => {
      unsubscribe();
    };
  }, [openWindow, startUpload]);

  useEffect(() => {
    const unsubscribe = Events.On(AppEvents.UploaderUploadProgressBatch, e => {
      if (e.data) {
        setUploadProgressBatch(e.data.items);
      }
    });
    return () => {
      unsubscribe();
    };
  }, [setUploadProgressBatch]);

  useEffect(() => {
    const unsubscribe = Events.On('uploader:upload-finished', e => {
      if (e.data) {
        finishUpload(e.data);
      }
    });
    return () => {
      unsubscribe();
    };
  }, [finishUpload]);

  const renderItem = useCallback((id: string) => <UploaderItem id={id} />, []);

  const onClickCancelAll = useCallback(async () => {
    await callIPC(CancelAllUploads, []);
  }, []);

  if (uploadItemIds.length === 0) return null;

  const hasDownloader = downloaderWidth > 0 && downloaderHeight > 0;

  if (!visible) {
    // Button: above the downloader (window or button) when there is one.
    const bottom = EDGE + (hasDownloader ? downloaderHeight + GAP : 0);
    return (
      <Affix position={{ bottom, right: EDGE }}>
        <ActionIcon onClick={openWindow} size="xl" tooltip={t('title')}>
          <Upload />
        </ActionIcon>
      </Affix>
    );
  }

  // Window: to the left of the downloader (window or button) when there is one.
  const right = EDGE + (hasDownloader ? downloaderWidth + GAP : 0);

  return (
    <Affix position={{ bottom: EDGE, right }}>
      <TransferPanel
        title={t('title')}
        cancelAllTooltip={t('action.cancelAll')}
        closeLabel={t('action.close')}
        ids={uploadItemIds}
        gap={ITEM_GAP}
        renderItem={renderItem}
        onCancelAll={onClickCancelAll}
        onClose={handlers.close}
      />
    </Affix>
  );
}
export default UploaderWindow;
