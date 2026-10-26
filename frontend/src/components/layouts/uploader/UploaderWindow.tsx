import { Affix, Box, CloseButton, Divider, Group, Paper, Stack, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { CancelAllUploads } from '@wails/S3Browser/internal/handlers/buckethandler';
import { Events } from '@wailsio/runtime';
import { Upload, X } from 'lucide-react';
import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/shallow';
import { useDownloaderStore } from '@/common/stores/downloaderStore';
import { selectUploadingIds, useUploaderStore } from '@/common/stores/uploaderStore';
import { callIPC } from '@/common/utils/ipcUtils';
import ActionIcon from '@/components/buttons/ActionIcon';
import UploaderItem from '@/components/layouts/uploader/UploaderItem';

const EDGE = 16;
const GAP = 16;
const WINDOW_WIDTH = 400;
const LIST_MAX_HEIGHT = 260;

function UploaderWindow() {
  const { t } = useTranslation('uploaderWindow');

  const [visible, handlers] = useDisclosure();
  const openWindow = handlers.open;

  const uploadItemIds = useUploaderStore(useShallow(selectUploadingIds));
  const startUpload = useUploaderStore(s => s.startUpload);
  const setUploadProgress = useUploaderStore(s => s.setUploadProgress);
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
    const unsubscribe = Events.On('uploader:upload-progress', e => {
      if (e.data) {
        setUploadProgress(e.data);
      }
    });
    return () => {
      unsubscribe();
    };
  }, [setUploadProgress]);

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
        <ActionIcon onClick={handlers.open} size="xl">
          <Upload />
        </ActionIcon>
      </Affix>
    );
  }

  // Window: to the left of the downloader (window or button) when there is one.
  const right = EDGE + (hasDownloader ? downloaderWidth + GAP : 0);

  return (
    <Affix position={{ bottom: EDGE, right }}>
      <Paper w={`${WINDOW_WIDTH}px`} withBorder style={{ overflow: 'hidden' }}>
        <Group p="xs" justify="space-between">
          <Text>{t('title')}</Text>
          <Group gap="xs">
            <ActionIcon color="red" size="md" onClick={onClickCancelAll} title={t('action.cancelAll')}>
              <X />
            </ActionIcon>
            <CloseButton onClick={handlers.close} />
          </Group>
        </Group>

        <Divider />

        <Box p="8px" style={{ maxHeight: `${LIST_MAX_HEIGHT}px`, overflow: 'auto' }}>
          <Stack gap="xs">
            {uploadItemIds.map(id => (
              <UploaderItem key={id} id={id} />
            ))}
          </Stack>
        </Box>
      </Paper>
    </Affix>
  );
}
export default UploaderWindow;
