import { Affix, CloseButton, Divider, Group, Paper, Text } from '@mantine/core';
import { useElementSize } from '@mantine/hooks';
import * as AppEvents from '@wails/events';
import { CancelAllDownloads } from '@wails/S3Browser/internal/handlers/buckethandler';
import { Events } from '@wailsio/runtime';
import { Download, X } from 'lucide-react';
import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { selectDownloadingIds, useDownloaderStore } from '@/common/stores/downloaderStore';
import { tintedColor } from '@/common/theme/tintedColor';
import { callIPC } from '@/common/utils/ipcUtils';
import ActionIcon from '@/components/buttons/ActionIcon';
import DownloaderItem from '@/components/layouts/transfer/downloader/DownloaderItem';
import { ITEM_HEIGHT } from '@/components/layouts/transfer/transferItem';
import VirtualItemList from '@/components/layouts/transfer/VirtualItemList';

// Same as the former Stack gap="xs" (10px), so rows keep their spacing.
const ITEM_GAP = 10;

/** Floating download progress window (or a button when closed); publishes its size for the uploader. */
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

  // Publish the measured size for UploaderWindow; reset to 0 when nothing is rendered.
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
        <Affix ref={sizeRef} style={{ bottom: '16px', right: '16px' }}>
          <ActionIcon onClick={openWindow} size="xl" aria-label={t('title')}>
            <Download />
          </ActionIcon>
        </Affix>
      ) : null}
      {visible && (
        <Affix ref={sizeRef} position={{ bottom: 16, right: 16 }}>
          <Paper w="400px" withBorder style={{ overflow: 'hidden' }}>
            <Group p="xs" justify="space-between">
              <Text>{t('title')}</Text>
              <Group gap="xs">
                <ActionIcon
                  {...tintedColor('red', 'ai')}
                  size="md"
                  onClick={onClickCancelAll}
                  title={t('action.cancelAll')}
                  aria-label={t('action.cancelAll')}
                >
                  <X />
                </ActionIcon>
                <CloseButton onClick={closeWindow} aria-label={t('action.close')} />
              </Group>
            </Group>

            <Divider />

            <VirtualItemList ids={downloadItemIds} gap={ITEM_GAP} itemHeight={ITEM_HEIGHT} renderItem={renderItem} />
          </Paper>
        </Affix>
      )}
    </>
  ) : null;
}
export default DownloaderWindow;
