import { Affix, Box, CloseButton, Divider, Group, Paper, Stack, Text } from '@mantine/core';
import { useElementSize } from '@mantine/hooks';
import { Events } from '@wailsio/runtime';
import { Download } from 'lucide-react';
import { useEffect } from 'react';
import { useShallow } from 'zustand/shallow';
import { selectDownloadingIds, useDownloaderStore } from '@/common/stores/downloaderStore';
import ActionIcon from '@/components/buttons/ActionIcon';
import DownloaderItem from '@/components/layouts/downloader/DownloaderItem';

function DownloaderWindow() {
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

  return rendered ? (
    <>
      {!visible ? (
        <Affix ref={sizeRef} style={{ bottom: '16px', right: '16px' }}>
          <ActionIcon onClick={openWindow} size="xl">
            <Download />
          </ActionIcon>
        </Affix>
      ) : null}
      {visible && (
        <Affix ref={sizeRef} position={{ bottom: 16, right: 16 }}>
          <Paper w="400px" withBorder style={{ overflow: 'hidden' }}>
            <Group p="xs" justify="space-between">
              <Text>Downloading</Text>
              <CloseButton onClick={closeWindow} ml="auto" />
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
