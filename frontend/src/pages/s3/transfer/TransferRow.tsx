import { Card, Center, Collapse, RingProgress } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { X } from 'lucide-react';
import { ReactNode } from 'react';
import { tintedColor } from '@/common/theme/tintedColor';
import ActionIcon from '@/components/buttons/ActionIcon';
import TruncatedText from '@/components/display/TruncatedText';
import { ITEM_HEIGHT } from '@/pages/s3/transfer/transferItem';

type TransferRowProps = {
  title: string;
  percent: number;
  // Nội dung bên trong vòng tiến độ.
  ringLabel: ReactNode;
  // Thông tin dung lượng bên dưới tiêu đề.
  children: ReactNode;
  cancelTooltip: string;
  onCancel: () => void;
};

/** Hàng truyền file có chiều cao cố định, dùng chung cho tải lên/tải xuống: vòng tiến độ, thông tin chi tiết và nút hủy khi rê chuột. */
function TransferRow(props: TransferRowProps) {
  const { title, percent, ringLabel, children, cancelTooltip, onCancel } = props;

  const [expanded, handlerExpanded] = useDisclosure(false);

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
        <Center w="3.5rem" h="100%">
          <RingProgress
            size={60}
            label={ringLabel}
            thickness={6}
            roundCaps
            sections={[{ value: percent, color: 'var(--mantine-color-blue-filled)' }]}
          />
        </Center>
      </Card.Section>

      <Card.Section inheritPadding px="xs" style={{ flex: 1, minWidth: 0, padding: '0.5rem' }}>
        <TruncatedText>{title}</TruncatedText>
        {children}
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
        <Center w="3rem" h="100%">
          <ActionIcon {...tintedColor('red', 'ai')} onClick={onCancel} tooltip={cancelTooltip}>
            <X />
          </ActionIcon>
        </Center>
      </Collapse>
    </Card>
  );
}
export default TransferRow;
