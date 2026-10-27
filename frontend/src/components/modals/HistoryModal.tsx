import { Anchor, Box, Card, Center, Divider, Group, Loader, Modal, Stack, Text, Title } from '@mantine/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { GetDownloadHistory, OpenDownloadDest } from '@wails/S3Browser/internal/handlers/buckethandler';
import { DownloadHistoryItem } from '@wails/S3Browser/models';
import dayjs from 'dayjs';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FULL_DATE_TIME_FORMAT } from '@/common/cnst/commonConst';
import { callIPC } from '@/common/utils/ipcUtils';
import { createMantineModal } from '@/common/utils/modalUtils';
import { formatFileSize } from '@/common/utils/stringUtils';
import Button from '@/components/buttons/Button';

const PAGE_SIZE = 10;

export default createMantineModal<{}, false>(props => {
  const { mantine, ...restProps } = props;

  const { t } = useTranslation('historyModal');

  const [historyList, setHistoryList] = useState<DownloadHistoryItem[]>([]);
  const [afterID, setAfterID] = useState('');
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [scrollMargin, setScrollMargin] = useState(0);

  const requestCtrl = useRef<AbortController>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const startRequest = useCallback(() => {
    requestCtrl.current?.abort();
    const ctrl = new AbortController();
    requestCtrl.current = ctrl;
    return ctrl;
  }, []);

  const loadFirstPage = useCallback(async () => {
    const ctrl = startRequest();
    setAfterID('');
    setIsLoadingMore(false);
    setLoadMoreError(false);
    const output = await callIPC(GetDownloadHistory, [{ afterID: '', pageSize: PAGE_SIZE }], { signal: ctrl.signal });
    if (output && !ctrl.signal.aborted) {
      setHistoryList(output.downloadHistoryList ?? []);
      setAfterID(output.afterID ?? '');
    }
  }, [startRequest]);

  const loadNextPage = useCallback(async () => {
    // The backend returns an empty afterID once the last page is reached.
    if (!afterID) return;
    const ctrl = startRequest();
    setIsLoadingMore(true);
    const output = await callIPC(GetDownloadHistory, [{ afterID, pageSize: PAGE_SIZE }], { signal: ctrl.signal });
    if (ctrl.signal.aborted) return;
    if (output) {
      setHistoryList(prev => [...prev, ...(output.downloadHistoryList ?? [])]);
      setAfterID(output.afterID ?? '');
    } else {
      setLoadMoreError(true);
    }
    setIsLoadingMore(false);
  }, [afterID, startRequest]);

  const onClickOpenFile = useCallback(async (fileName?: string, path?: string) => {
    if (!fileName || !path) return;
    await callIPC(OpenDownloadDest, [fileName, path]);
  }, []);

  useEffect(() => {
    loadFirstPage();
    // Cancel any running request when the modal closes.
    return () => requestCtrl.current?.abort();
  }, [loadFirstPage]);

  // The list sits below the scroll container's padding, so the virtualizer needs that offset.
  useLayoutEffect(() => {
    setScrollMargin(listRef.current?.offsetTop ?? 0);
  }, []);

  // React Compiler is disabled, so this compiler-only lint does not apply.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: historyList.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 100,
    getItemKey: idx => historyList[idx].id,
    gap: 8,
    overscan: 5,
    scrollMargin,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const lastVisibleIndex = virtualizer.range?.endIndex ?? -1;

  useEffect(() => {
    // After a failed page, stop instead of retrying in a loop.
    if (!afterID || isLoadingMore || loadMoreError) return;
    // Load the next page once only 2 items are left below the viewport.
    if (lastVisibleIndex >= historyList.length - 1 - 2) {
      loadNextPage();
    }
  }, [lastVisibleIndex, historyList.length, afterID, isLoadingMore, loadMoreError, loadNextPage]);

  return (
    <Modal.Root {...mantine.props} centered {...restProps} size="80%">
      <Modal.Overlay />
      <Modal.Content>
        <Modal.Header
          pos="relative"
          p="8px"
          mih="0px"
          style={{ justifyContent: 'flex-end', backgroundColor: '#d0ebff' }}
        >
          <Group gap="xs" style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}>
            <Title order={4}>{t('title')}</Title>
          </Group>
          <Modal.CloseButton size="md" aria-label={t('common:button.close')} />
        </Modal.Header>

        <Divider />

        <Modal.Body
          ref={scrollRef}
          p="8px"
          style={{ position: 'relative', minHeight: '650px', maxHeight: '650px', overflow: 'auto' }}
        >
          <div ref={listRef} style={{ position: 'relative', height: virtualizer.getTotalSize() }}>
            {virtualItems.map(row => {
              const item = historyList[row.index];
              return (
                <div
                  key={item.id}
                  data-index={row.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    width: '100%',
                    transform: `translateY(${row.start - scrollMargin}px)`,
                  }}
                >
                  <Card padding="8px" orientation="horizontal" withBorder>
                    <Card.Section
                      inheritPadding
                      px="md"
                      style={{
                        flex: 1,
                        minWidth: 0,
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      <Stack style={{ flex: 1, minWidth: 0 }}>
                        <Text size="xl" truncate="end" fw={500}>
                          {item.fileName}
                        </Text>
                        <Group gap="xl" wrap="nowrap">
                          <Box miw="100px">
                            <Text c="dimmed">{t('label.sizeLbl')}</Text>
                            <Text>{formatFileSize(item.size ?? 0)}</Text>
                          </Box>

                          <Box miw="100px">
                            <Text c="dimmed">{t('label.downloadAtLbl')}</Text>
                            <Text>{dayjs(item.updatedAt).format(FULL_DATE_TIME_FORMAT)}</Text>
                          </Box>

                          <Box miw="120px">
                            <Text c="dimmed">{t('label.statusLbl')}</Text>
                            <Text>{item.status}</Text>
                          </Box>

                          <Box style={{ flex: 1, minWidth: 0 }}>
                            <Text c="dimmed">{t('label.destPathLbl')}</Text>
                            {item.destPath ? (
                              <Anchor onClick={() => onClickOpenFile(item.fileName, item.destPath)}>
                                <Text truncate="end">{item.destPath}</Text>
                              </Anchor>
                            ) : (
                              <Text>{t('label.emptyLbl')}</Text>
                            )}
                          </Box>
                        </Group>
                      </Stack>
                    </Card.Section>
                  </Card>
                </div>
              );
            })}
            {isLoadingMore ? (
              <Center style={{ position: 'absolute', top: '100%', width: '100%' }} py="8px">
                <Loader size="sm" />
              </Center>
            ) : null}
          </div>
        </Modal.Body>

        <Divider />

        <Group p="8px" justify="flex-end">
          <Button
            onClick={() => {
              mantine.handler.resolve(false);
              mantine.handler.hide();
            }}
            color="red"
          >
            {t('common:button.cancel')}
          </Button>
        </Group>
      </Modal.Content>
    </Modal.Root>
  );
});
