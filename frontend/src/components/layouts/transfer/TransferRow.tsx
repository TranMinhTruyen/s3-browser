import { Card, Center, Collapse, RingProgress } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { X } from 'lucide-react';
import { ReactNode } from 'react';
import { tintedColor } from '@/common/theme/tintedColor';
import ActionIcon from '@/components/buttons/ActionIcon';
import { ITEM_HEIGHT } from '@/components/layouts/transfer/transferItem';
import TruncatedText from '@/components/TruncatedText';

type TransferRowProps = {
  title: string;
  percent: number;
  // Content inside the progress ring.
  ringLabel: ReactNode;
  // Size details under the title.
  children: ReactNode;
  cancelTooltip: string;
  onCancel: () => void;
};

/** Fixed-height transfer row shared by upload and download: progress ring, details and a cancel button on hover. */
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
        <Center w="56px" h="100%">
          <RingProgress
            size={60}
            label={ringLabel}
            thickness={6}
            roundCaps
            sections={[{ value: percent, color: 'var(--mantine-color-blue-filled)' }]}
          />
        </Center>
      </Card.Section>

      <Card.Section inheritPadding px="xs" style={{ flex: 1, minWidth: 0, padding: '8px' }}>
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
        <Center w="48px" h="100%">
          <ActionIcon {...tintedColor('red', 'ai')} onClick={onCancel} tooltip={cancelTooltip}>
            <X />
          </ActionIcon>
        </Center>
      </Collapse>
    </Card>
  );
}
export default TransferRow;
