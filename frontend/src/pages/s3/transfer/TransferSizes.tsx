import { Box, Group, Text } from '@mantine/core';

type TransferSizesProps = {
  doneLabel: string;
  doneSize: string;
  remainingLabel: string;
  remainingSize: string;
};

/** "Transferred / remaining" size pair shown in a transfer row. */
function TransferSizes(props: TransferSizesProps) {
  const { doneLabel, doneSize, remainingLabel, remainingSize } = props;

  return (
    <Group>
      <Box>
        <Text size="xs" c="dimmed">
          {doneLabel}
        </Text>
        <Text>{doneSize}</Text>
      </Box>

      <Box>
        <Text size="xs" c="dimmed">
          {remainingLabel}
        </Text>
        <Text>{remainingSize}</Text>
      </Box>
    </Group>
  );
}
export default TransferSizes;
