import { Anchor, Box, Card, Center, Divider, Group, Loader, Modal, Stack, Text, Title } from '@mantine/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { GetDownloadHistory, OpenDownloadDest } from '@wails/S3Browser/internal/handlers/buckethandler';
import { DownloadHistoryItem } from '@wails/S3Browser/models';
import dayjs from 'dayjs';
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FULL_DATE_TIME_FORMAT, LIST_ROW_GAP } from '@/common/cnst/commonConst';
import { useRemeasureOnScale, useUiScale } from '@/common/hooks/useUiScale';
import { callIPC } from '@/common/utils/ipcUtils';
import { createMantineModal } from '@/common/utils/modalUtils';
import { formatFileSize } from '@/common/utils/stringUtils';
import Button from '@/components/buttons/Button';
import CloseButton from '@/components/buttons/CloseButton';
import TruncatedText from '@/components/display/TruncatedText';
import { INFO_BG_COLOR } from '@/components/modals/modalColors';
import { MODAL_CHROME_HEIGHT } from '@/components/modals/modalLayout';

const PAGE_SIZE = 10;
const HISTORY_ROW_ESTIMATE = 100;

// Chiều cao nội dung cố định trên màn hình cao; giảm trên màn hình thấp để Modal.Content không vượt max-height.
const BODY_HEIGHT = `min(40.625rem, calc(100dvh - 2 * var(--modal-y-offset) - ${MODAL_CHROME_HEIGHT}))`;

type HistoryCardProps = {
  item: DownloadHistoryItem;
};

/** Một mục lịch sử tải xuống: tên, dung lượng, thời gian, trạng thái và liên kết đến đích lưu. */
const HistoryCard = memo(function HistoryCard(props: HistoryCardProps) {
  const { item } = props;
  const { t } = useTranslation('historyModal');

  const onClickOpenDest = useCallback(async () => {
    if (!item.fileName || !item.destPath) return;
    await callIPC(OpenDownloadDest, [item.fileName, item.destPath]);
  }, [item.fileName, item.destPath]);

  return (
    <Card padding="0.5rem" orientation="horizontal" withBorder>
      <Card.Section inheritPadding px="md" style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' }}>
        <Stack style={{ flex: 1, minWidth: 0 }}>
          <TruncatedText size="xl" fw={500}>
            {item.fileName}
          </TruncatedText>
          <Group gap="xl" wrap="nowrap">
            <Box miw="6.25rem">
              <Text c="dimmed">{t('label.sizeLbl')}</Text>
              <Text>{formatFileSize(item.size ?? 0)}</Text>
            </Box>

            <Box miw="6.25rem">
              <Text c="dimmed">{t('label.downloadAtLbl')}</Text>
              <Text>{dayjs(item.updatedAt).format(FULL_DATE_TIME_FORMAT)}</Text>
            </Box>

            <Box miw="7.5rem">
              <Text c="dimmed">{t('label.statusLbl')}</Text>
              <Text>{item.status}</Text>
            </Box>

            <Box style={{ flex: 1, minWidth: 0 }}>
              <Text c="dimmed">{t('label.destPathLbl')}</Text>
              {item.destPath ? (
                <Anchor onClick={onClickOpenDest}>
                  <TruncatedText>{item.destPath}</TruncatedText>
                </Anchor>
              ) : (
                <Text>{t('label.emptyLbl')}</Text>
              )}
            </Box>
          </Group>
        </Stack>
      </Card.Section>
    </Card>
  );
});

/** Danh sách lịch sử tải xuống được phân trang và ảo hóa; tải trang tiếp theo khi gần cuối danh sách. */
export default createMantineModal<{}, false>(props => {
  const { mantine, ...restProps } = props;

  const { t } = useTranslation('historyModal');

  const [historyList, setHistoryList] = useState<DownloadHistoryItem[]>([]);
  const [afterID, setAfterID] = useState('');
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [scrollMargin, setScrollMargin] = useState(0);
  const scale = useUiScale();

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
    // Backend trả về afterID rỗng khi đã đến trang cuối.
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

  const onClickCancel = useCallback(() => {
    mantine.handler.resolve(false);
    mantine.handler.hide();
  }, [mantine.handler]);

  useEffect(() => {
    loadFirstPage();
    // Hủy yêu cầu đang chạy khi modal đóng.
    return () => requestCtrl.current?.abort();
  }, [loadFirstPage]);

  // Danh sách nằm dưới padding của vùng cuộn nên virtualizer cần biết độ lệch này.
  useLayoutEffect(() => {
    setScrollMargin(listRef.current?.offsetTop ?? 0);
    // offsetTop tính bằng px còn padding phía trên danh sách tính bằng rem: đo lại khi đổi cỡ giao diện.
  }, [scale]);

  // React Compiler đang tắt nên quy tắc lint chỉ dành cho compiler này không áp dụng.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: historyList.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => HISTORY_ROW_ESTIMATE * scale,
    getItemKey: idx => historyList[idx].id,
    gap: LIST_ROW_GAP * scale,
    overscan: 5,
    scrollMargin,
  });

  useRemeasureOnScale(virtualizer, scale);

  const virtualItems = virtualizer.getVirtualItems();
  const lastVisibleIndex = virtualizer.range?.endIndex ?? -1;

  useEffect(() => {
    // Nếu tải trang thất bại thì dừng thay vì thử lại liên tục.
    if (!afterID || isLoadingMore || loadMoreError) return;
    // Tải trang tiếp theo khi chỉ còn 2 mục bên dưới khung nhìn.
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
          p="0.5rem"
          mih="0"
          style={{ justifyContent: 'flex-end', backgroundColor: INFO_BG_COLOR }}
        >
          <Group gap="xs" style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}>
            <Title order={4}>{t('title')}</Title>
          </Group>
          <CloseButton tooltip={t('common:button.close')} onClick={mantine.props.onClose} />
        </Modal.Header>

        <Divider />

        <Modal.Body ref={scrollRef} p="0.5rem" style={{ position: 'relative', overflow: 'auto', height: BODY_HEIGHT }}>
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
                  <HistoryCard item={item} />
                </div>
              );
            })}
            {isLoadingMore ? (
              <Center style={{ position: 'absolute', top: '100%', width: '100%' }} py="0.5rem">
                <Loader size="sm" />
              </Center>
            ) : null}
          </div>
        </Modal.Body>

        <Divider />

        <Group p="0.5rem" justify="space-between" wrap="nowrap">
          <Button onClick={onClickCancel} color="red">
            {t('common:button.cancel')}
          </Button>
        </Group>
      </Modal.Content>
    </Modal.Root>
  );
});
