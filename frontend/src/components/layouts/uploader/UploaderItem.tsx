import { Box, Card, Center, Collapse, Group, RingProgress, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { CancelUploadOne } from '@wails/S3Browser/internal/handlers/buckethandler';
import { X } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useUploaderStore } from '@/common/stores/uploaderStore';
import { callIPC } from '@/common/utils/ipcUtils';
import { formatFileSize } from '@/common/utils/stringUtils';
import ActionIcon from '@/components/buttons/ActionIcon';

type UploaderItemProps = {
  id: string;
};

function UploaderItem(props: UploaderItemProps) {
  const { id } = props;

  const { t } = useTranslation('uploaderWindow');
  const [expanded, handlerExpanded] = useDisclosure(false);

  const item = useUploaderStore(s => s.uploadItems[id]);

  const onClickCancelUpload = useCallback(async () => {
    await callIPC(CancelUploadOne, [id]);
  }, [id]);

  if (!item) return null;

  const percent = item.total > 0 ? Math.min(99, Math.round((item.uploaded / item.total) * 100)) : 0;

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
        <Text truncate="end">
          {t('label.objectLbl')}: {item.fileName}
        </Text>
        <Group>
          <Box>
            <Text size="xs" c="dimmed">
              {t('label.uploadedLbl')}
            </Text>
            <Text>{formatFileSize(item.uploaded)}</Text>
          </Box>

          <Box>
            <Text size="xs" c="dimmed">
              {t('label.remainingLbl')}
            </Text>
            <Text>{formatFileSize(Math.max(0, item.total - item.uploaded))}</Text>
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
          <ActionIcon color="red" onClick={onClickCancelUpload}>
            <X />
          </ActionIcon>
        </Center>
      </Collapse>
    </Card>
  );
}

export default memo(UploaderItem);
