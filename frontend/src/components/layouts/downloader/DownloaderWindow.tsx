import { Affix, Box, CloseButton, Divider, Group, Paper, Stack, Text } from '@mantine/core';
import { useElementSize } from '@mantine/hooks';
import { CancelAllDownloads } from '@wails/S3Browser/internal/handlers/buckethandler';
import { Events } from '@wailsio/runtime';
import { Download, X } from 'lucide-react';
import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/shallow';
import { selectDownloadingIds, useDownloaderStore } from '@/common/stores/downloaderStore';
import { callIPC } from '@/common/utils/ipcUtils';
import ActionIcon from '@/components/buttons/ActionIcon';
import DownloaderItem from '@/components/layouts/downloader/DownloaderItem';

/** Floating download progress window (or a button when closed); publishes its size for the uploader. */
function DownloaderWindow() {
  const { t } = useTranslation('downloaderWindow');

  const visible = useDownloaderStore(s => s.windowVisible);
  const openWindow = useDownloaderStore(s => s.openWindow);
  const closeWindow = useDownloaderStore(s => s.closeWindow);

  const setWindowSize = useDownloaderStore(s => s.setWindowSize);
  const { ref: sizeRef, width, height } = useElementSize();

  const downloadItemIds = useDownloaderStore(useShallow(selectDownloadingIds));
  const rendered = downloadItemIds.length > 0;
  const addDownloadItems = useDownloaderStore(s => s.upsertDownloadItems);
  const setDownloadProgess = useDownloaderStore(s => s.setDownloadProgess);

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
    const unsubscribe = Events.On('downloader:download-progress', e => {
      if (e.data) {
        setDownloadProgess(e.data);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [setDownloadProgess]);

  // Publish the measured size for UploaderWindow; reset to 0 when nothing is rendered.
  useEffect(() => {
    setWindowSize(rendered ? { width, height } : { width: 0, height: 0 });
  }, [rendered, width, height, setWindowSize]);

  const onClickCancelAll = useCallback(async () => {
    await callIPC(CancelAllDownloads, []);
  }, []);

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
                  color="red"
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

            <Box p="8px" style={{ maxHeight: '260px', overflow: 'auto' }}>
              <Stack gap="xs">
                {downloadItemIds.map(id => (
                  <DownloaderItem key={id} id={id} />
                ))}
              </Stack>
            </Box>
          </Paper>
        </Affix>
      )}
    </>
  ) : null;
}
export default DownloaderWindow;
