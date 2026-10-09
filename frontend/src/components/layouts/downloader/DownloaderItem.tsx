import { Box, Card, Group, RingProgress, Text } from '@mantine/core';
import { useDownloaderStore } from '@/common/stores/downloaderStore';
import { formatFileSize } from '@/common/utils/stringUtils';

type DownloaderItemProps = {
  id: string;
};

function DownloaderItem(props: DownloaderItemProps) {
  const { id } = props;

  const item = useDownloaderStore(s => s.downloadItems[id]);

  const percent = item.total > 0 ? Math.min(99, Math.round((item.downloaded / item.total) * 100)) : 100;

  return (
    <Card padding="sm" withBorder orientation="horizontal" h="80px">
      <Card.Section
        inheritPadding
        px="xs"
        withBorder
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          minWidth: '56px',
          justifyContent: 'center',
        }}
      >
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
      </Card.Section>

      <Card.Section inheritPadding px="xs" style={{ flex: 1, minWidth: 0, padding: '8px' }}>
        <Text truncate="end">File: {item?.fileName}</Text>
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
    </Card>
  );
}

export default DownloaderItem;
