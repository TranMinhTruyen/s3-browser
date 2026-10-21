import { Box, Card, Stack, Text } from '@mantine/core';
import { Bucket } from '@wails/S3Browser/models/bucket';
import dayjs from 'dayjs';
import { Folder } from 'lucide-react';
import { memo } from 'react';
import { FULL_DATE_TIME_FORMAT } from '@/common/cnst/commonConst';
import classes from '@/pages/bucket/page.module.css';

type BucketItemProps = {
  item: Bucket;
  onSelectBucket?: (bucketName: string | undefined) => void;
};

function BucketItem(props: BucketItemProps) {
  const { item, onSelectBucket } = props;

  return (
    <Card padding="sm" orientation="horizontal" onClick={() => onSelectBucket?.(item.name)} className={classes.card}>
      <Card.Section
        inheritPadding
        px="xs"
        withBorder
        className={classes.iconSection}
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          minWidth: '56px',
          justifyContent: 'center',
        }}
      >
        <Folder />
      </Card.Section>
      <Card.Section
        inheritPadding
        px="xs"
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <Stack>
          <Text size="xl" fw="bold" truncate="end">
            {item.name}
          </Text>
          <Box>
            <Text>
              <Text span fw={500}>
                Create date:
              </Text>{' '}
              {dayjs(item.creationDate).format(FULL_DATE_TIME_FORMAT)}
            </Text>
          </Box>
        </Stack>
      </Card.Section>
    </Card>
  );
}
export default memo(BucketItem);
