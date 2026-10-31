import { Box, Card, Center, Collapse, Group, RingProgress, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { CancelDownloadOne } from '@wails/S3Browser/internal/handlers/buckethandler';
import { X } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useDownloaderStore } from '@/common/stores/downloaderStore';
import { callIPC } from '@/common/utils/ipcUtils';
import { formatFileSize } from '@/common/utils/stringUtils';
import ActionIcon from '@/components/buttons/ActionIcon';
import { ITEM_HEIGHT } from '@/components/layouts/transfer/transferItem';

type DownloaderItemProps = {
  id: string;
};

/** One download row: progress ring, sizes and a cancel button shown on hover. */
function DownloaderItem(props: DownloaderItemProps) {
  const { id } = props;
  const { t } = useTranslation('downloaderWindow');

  const [expanded, handlerExpanded] = useDisclosure(false);

  const item = useDownloaderStore(s => s.downloadItems[id]);

  const percent = item.total > 0 ? Math.min(99, Math.round((item.downloaded / item.total) * 100)) : 100;

  const onClickCancelDownload = useCallback(async () => {
    await callIPC(CancelDownloadOne, [id]);
  }, [id]);

  return (
    <Card
      padding="sm"
      h={ITEM_HEIGHT}
      withBorder
      orientation="horizontal"
      onMouseEnter={handlerExpanded.open}
      onMouseLeave={handlerExpanded.close}
    >
      <Card.Section inheritPadding px="xs" withBorder>
        <Center w="56px" h="100%">
          <RingProgress
            size={60}
            label={
              <Text size="xs" ta="center">
                {percent}%
              </Text>
            }
            thickness={6}
            roundCaps
            sections={[{ value: percent, color: 'var(--mantine-color-blue-filled)' }]}
          />
        </Center>
      </Card.Section>

      <Card.Section inheritPadding px="xs" style={{ flex: 1, minWidth: 0, padding: '8px' }}>
        <Text truncate="end">
          {t('label.objectLbl')}: {item.fileName}
        </Text>
        <Group>
          <Box>
            <Text size="xs" c="dimmed">
              {t('label.downloadedLbl')}
            </Text>
            <Text>{formatFileSize(item.downloaded)}</Text>
          </Box>

          <Box>
            <Text size="xs" c="dimmed">
              {t('label.remainingLbl')}
            </Text>
            <Text>{formatFileSize(item.total - item.downloaded)}</Text>
          </Box>
        </Group>
      </Card.Section>

      <Collapse
        expanded={expanded}
        orientation="horizontal"
        style={{
          flexShrink: 0,
          marginBlock: 'calc(var(--card-padding) * -1)',
          marginInlineEnd: 'calc(var(--card-padding) * -1)',
          borderInlineStart: '1px solid var(--mantine-color-default-border)',
        }}
      >
        <Center w="48px" h="100%">
          <ActionIcon
            color="var(--mantine-color-red-light-color)"
            onClick={onClickCancelDownload}
            aria-label={t('action.cancel')}
          >
            <X />
          </ActionIcon>
        </Center>
      </Collapse>
    </Card>
  );
}

export default memo(DownloaderItem);
