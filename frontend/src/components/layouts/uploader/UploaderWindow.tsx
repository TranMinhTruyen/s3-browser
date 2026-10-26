import { Affix, Box, CloseButton, Divider, Group, Paper, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useVirtualizer } from '@tanstack/react-virtual';
import { CancelAllUploads } from '@wails/S3Browser/internal/handlers/buckethandler';
import { Events } from '@wailsio/runtime';
import { Upload, X } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';
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
const ITEM_HEIGHT = 80;
const ITEM_GAP = 8;

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

  const listRef = useRef<HTMLDivElement>(null);

  // React Compiler is disabled, so this compiler-only lint does not apply.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: uploadItemIds.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => ITEM_HEIGHT,
    getItemKey: idx => uploadItemIds[idx],
    gap: ITEM_GAP,
    overscan: 5,
  });

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

        <Box ref={listRef} p="8px" style={{ maxHeight: `${LIST_MAX_HEIGHT}px`, overflow: 'auto' }}>
          <div style={{ position: 'relative', height: virtualizer.getTotalSize(), width: '100%' }}>
            {virtualizer.getVirtualItems().map(row => (
              <div
                key={row.key}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: ITEM_HEIGHT,
                  transform: `translateY(${row.start}px)`,
                }}
              >
                <UploaderItem id={uploadItemIds[row.index]} />
              </div>
            ))}
          </div>
        </Box>
      </Paper>
    </Affix>
  );
}
export default UploaderWindow;
