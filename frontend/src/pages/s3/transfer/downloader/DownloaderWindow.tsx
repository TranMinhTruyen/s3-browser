import { Affix } from '@mantine/core';
import { useElementSize } from '@mantine/hooks';
import * as AppEvents from '@wails/events';
import { CancelAllDownloads } from '@wails/S3Browser/internal/handlers/buckethandler';
import { Events } from '@wailsio/runtime';
import { Download } from 'lucide-react';
import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { selectDownloadingIds, useDownloaderStore } from '@/common/stores/downloaderStore';
import { callIPC } from '@/common/utils/ipcUtils';
import ActionIcon from '@/components/buttons/ActionIcon';
import DownloaderItem from '@/pages/s3/transfer/downloader/DownloaderItem';
import TransferPanel from '@/pages/s3/transfer/TransferPanel';

// Bằng Stack gap="xs" trước đây (10px) để giữ nguyên khoảng cách giữa các hàng.
const ITEM_GAP = 10;

/** Cửa sổ nổi hiển thị tiến độ tải xuống (hoặc một nút khi đóng); gửi kích thước cho uploader. */
function DownloaderWindow() {
  const { t } = useTranslation('downloaderWindow');

  const visible = useDownloaderStore(s => s.windowVisible);
  const openWindow = useDownloaderStore(s => s.openWindow);
  const closeWindow = useDownloaderStore(s => s.closeWindow);

  const setWindowSize = useDownloaderStore(s => s.setWindowSize);
  const { ref: sizeRef, width, height } = useElementSize();

  const downloadItemIds = useDownloaderStore(selectDownloadingIds);
  const rendered = downloadItemIds.length > 0;
  const addDownloadItems = useDownloaderStore(s => s.upsertDownloadItems);
  const setDownloadProgressBatch = useDownloaderStore(s => s.setDownloadProgressBatch);

  useEffect(() => {
    const unsubscribe = Events.On('downloader:load-download-history', e => {
      if (e.data) {
        openWindow();
        addDownloadItems([{ ...e.data }]);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [addDownloadItems, openWindow]);

  useEffect(() => {
    const unsubscribe = Events.On(AppEvents.DownloaderDownloadProgressBatch, e => {
      if (e.data) {
        setDownloadProgressBatch(e.data.items);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [setDownloadProgressBatch]);

  // Gửi kích thước đã đo cho UploaderWindow; đặt về 0 khi không render gì.
  useEffect(() => {
    setWindowSize(rendered ? { width, height } : { width: 0, height: 0 });
  }, [rendered, width, height, setWindowSize]);

  const onClickCancelAll = useCallback(async () => {
    await callIPC(CancelAllDownloads, []);
  }, []);

  const renderItem = useCallback((id: string) => <DownloaderItem id={id} />, []);

  return rendered ? (
    <>
      {!visible ? (
        <Affix ref={sizeRef} style={{ bottom: '1rem', right: '1rem' }}>
          <ActionIcon onClick={openWindow} size="xl" tooltip={t('title')}>
            <Download />
          </ActionIcon>
        </Affix>
      ) : null}
      {visible && (
        <Affix ref={sizeRef} position={{ bottom: '1rem', right: '1rem' }}>
          <TransferPanel
            title={t('title')}
            cancelAllTooltip={t('action.cancelAll')}
            closeLabel={t('action.close')}
            ids={downloadItemIds}
            gap={ITEM_GAP}
            renderItem={renderItem}
            onCancelAll={onClickCancelAll}
            onClose={closeWindow}
          />
        </Affix>
      )}
    </>
  ) : null;
}
export default DownloaderWindow;
