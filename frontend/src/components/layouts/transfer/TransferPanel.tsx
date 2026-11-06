import { Divider, Group, Paper, Text } from '@mantine/core';
import { Ban } from 'lucide-react';
import { ReactNode } from 'react';
import { tintedColor } from '@/common/theme/tintedColor';
import ActionIcon from '@/components/buttons/ActionIcon';
import CloseButton from '@/components/buttons/CloseButton';
import { ITEM_HEIGHT } from '@/components/layouts/transfer/transferItem';
import VirtualItemList from '@/components/layouts/transfer/VirtualItemList';

type TransferPanelProps = {
  title: string;
  cancelAllTooltip: string;
  closeLabel: string;
  ids: string[];
  // Gap between two rows, in px.
  gap: number;
  renderItem: (id: string) => ReactNode;
  onCancelAll: () => void;
  onClose: () => void;
};

/** Window body shared by the uploader and downloader: header with cancel-all / close, then the row list. */
function TransferPanel(props: TransferPanelProps) {
  const { title, cancelAllTooltip, closeLabel, ids, gap, renderItem, onCancelAll, onClose } = props;

  return (
    <Paper w="400px" withBorder style={{ overflow: 'hidden' }}>
      <Group p="xs" justify="space-between">
        <Text>{title}</Text>
        <Group gap="xs">
          <ActionIcon {...tintedColor('red', 'ai')} size="md" onClick={onCancelAll} tooltip={cancelAllTooltip}>
            <Ban />
          </ActionIcon>
          <CloseButton onClick={onClose} tooltip={closeLabel} />
        </Group>
      </Group>

      <Divider />

      <VirtualItemList ids={ids} gap={gap} itemHeight={ITEM_HEIGHT} renderItem={renderItem} />
    </Paper>
  );
}
export default TransferPanel;
