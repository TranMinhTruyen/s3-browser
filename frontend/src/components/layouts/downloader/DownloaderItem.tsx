import { Box, Card, Center, Collapse, Group, RingProgress, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { CancelDownloadOne } from '@wails/S3Browser/internal/handlers/buckethandler';
import { X } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useDownloaderStore } from '@/common/stores/downloaderStore';
import { callIPC } from '@/common/utils/ipcUtils';
import { formatFileSize } from '@/common/utils/stringUtils';
import ActionIcon from '@/components/buttons/ActionIcon';

type DownloaderItemProps = {
  id: string;
};

function DownloaderItem(props: DownloaderItemProps) {
  const { id } = props;

  const [expanded, handlerExpanded] = useDisclosure(false);

  const item = useDownloaderStore(s => s.downloadItems[id]);

  const percent = item.total > 0 ? Math.min(99, Math.round((item.downloaded / item.total) * 100)) : 100;

  const onClickCancelDownload = useCallback(async () => {
    await callIPC(CancelDownloadOne, [id]);
  }, [id]);

  return (
    <Card
      padding="sm"
      h="80px"
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
            sections={[{ value: percent, color: 'blue' }]}
          />
        </Center>
      </Card.Section>

      <Card.Section inheritPadding px="xs" style={{ flex: 1, minWidth: 0, padding: '8px' }}>
        <Text truncate="end">Object: {item?.fileName}</Text>
        <Group>
          <Box>
            <Text size="xs" c="dimmed">
              Downloaded
            </Text>
            <Text>{formatFileSize(item.downloaded)}</Text>
          </Box>

          <Box>
            <Text size="xs" c="dimmed">
              Remaining
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
          <ActionIcon color="red" onClick={onClickCancelDownload}>
            <X />
          </ActionIcon>
        </Center>
      </Collapse>
    </Card>
  );
}

export default memo(DownloaderItem);
