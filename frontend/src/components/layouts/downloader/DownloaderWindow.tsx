import { FloatingWindow, ScrollArea, Stack } from '@mantine/core';
import { Events } from '@wailsio/runtime';
import { useEffect } from 'react';
import { useShallow } from 'zustand/shallow';
import { useDownloaderStore } from '@/common/stores/downloaderStore';
import DownloaderItem from '@/components/layouts/downloader/DownloaderItem';

function DownloaderWindow() {
  const downloadItemIds = useDownloaderStore(useShallow(s => Object.keys(s.downloadItems)));
  const addDownloadItems = useDownloaderStore(s => s.addDownloadItems);
  const setDownloadProgess = useDownloaderStore(s => s.setDownloadProgess);

  useEffect(() => {
    const unsubscribe = Events.On('downloader:load-download-history', e => {
      if (e.data) {
        addDownloadItems([{ ...e.data }]);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [addDownloadItems]);

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
    <FloatingWindow
      p="xs"
      w="350px"
      withBorder
      excludeDragHandleSelector="button"
      initialPosition={{ bottom: 16, right: 16 }}
      enabled={false}
    >
      <ScrollArea h="250px" scrollbars="y" styles={{ content: { display: 'block' } }}>
        <Stack gap="xs">
          {downloadItemIds.map(id => (
            <DownloaderItem key={id} id={id} />
          ))}
        </Stack>
      </ScrollArea>
    </FloatingWindow>
  ) : null;
}
export default DownloaderWindow;
