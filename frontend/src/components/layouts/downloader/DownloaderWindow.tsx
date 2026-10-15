import { Affix, CloseButton, FloatingWindow, Group, ScrollArea, Stack, Text } from '@mantine/core';
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
        <FloatingWindow
          p="xs"
          w="400px"
          withBorder
          excludeDragHandleSelector="button"
          style={{ bottom: '16px', right: '16px' }}
          enabled={false}
        >
          <Group mb="xs" justify="space-between">
            <Text>Downloading</Text>
            <CloseButton onClick={handlers.close} ml="auto" />
          </Group>
          <ScrollArea h="260px" scrollbars="y" styles={{ content: { display: 'block' } }}>
            <Stack gap="xs">
              {downloadItemIds.map(id => (
                <DownloaderItem key={id} id={id} />
              ))}
            </Stack>
          </ScrollArea>
        </FloatingWindow>
      )}
    </>
  ) : null;
}
export default DownloaderWindow;
