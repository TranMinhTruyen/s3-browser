import { Affix, Box, CloseButton, Divider, Group, Paper, Stack, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Events } from '@wailsio/runtime';
import { Download } from 'lucide-react';
import { useEffect } from 'react';
import { useShallow } from 'zustand/shallow';
import { selectDownloadingIds, useDownloaderStore } from '@/common/stores/downloaderStore';
import ActionIcon from '@/components/buttons/ActionIcon';
import DownloaderItem from '@/components/layouts/downloader/DownloaderItem';

function DownloaderWindow() {
  const [visible, handlers] = useDisclosure();
  // `handlers` is a new object every render; its methods are stable.
  const openWindow = handlers.open;

  const downloadItemIds = useDownloaderStore(useShallow(selectDownloadingIds));
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

  return downloadItemIds.length > 0 ? (
    <>
      {!visible ? (
        <Affix style={{ bottom: '16px', right: '16px' }}>
          <ActionIcon onClick={handlers.open} size="xl">
            <Download />
          </ActionIcon>
        </Affix>
      ) : null}
      {visible && (
        <Affix position={{ bottom: 16, right: 16 }}>
          <Paper w="400px" withBorder style={{ overflow: 'hidden' }}>
            <Group p="xs" justify="space-between">
              <Text>Downloading</Text>
              <CloseButton onClick={handlers.close} ml="auto" />
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
