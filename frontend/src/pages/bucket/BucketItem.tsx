import { Card, Group, Stack, Text, Tooltip } from '@mantine/core';
import { Bucket } from '@wails/S3Browser/models/bucket';
import dayjs from 'dayjs';
import { Folder, TriangleAlert } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { FULL_DATE_TIME_FORMAT } from '@/common/cnst/commonConst';
import { WARNING_COLOR } from '@/components/modals/modalColors';
import classes from '@/pages/bucket/page.module.css';

type BucketItemProps = {
  item: Bucket;
  onSelectBucket?: (bucketName: string | undefined) => void;
};

/** One row of the bucket list: name, creation date (unknown for anonymous buckets) and a warning when the bucket cannot be accessed; clicking it opens the bucket. */
function BucketItem(props: BucketItemProps) {
  const { item, onSelectBucket } = props;
  const { t } = useTranslation('bucket', { keyPrefix: 'page' });
  // An anonymous connection cannot read the creation date, so the backend sends the zero date (year 1).
  const hasCreationDate = dayjs(item.creationDate).year() > 1;

  const onClickBucket = useCallback(() => {
    onSelectBucket?.(item.name);
  }, [onSelectBucket, item.name]);

  return (
    <Card padding="sm" orientation="horizontal" onClick={onClickBucket} className={classes.card}>
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
        {/* miw=0 lets the flex item shrink, so a long bucket name is truncated instead of overflowing. */}
        <Stack miw={0}>
          <Group gap="xs" wrap="nowrap">
            <Text size="xl" fw="bold" truncate="end">
              {item.name}
            </Text>
            {item.inaccessible ? (
              <Tooltip label={t('tooltip.inaccessible')}>
                <TriangleAlert size={18} color={WARNING_COLOR} aria-label={t('tooltip.inaccessible')} />
              </Tooltip>
            ) : null}
          </Group>
          {hasCreationDate ? (
            <Text>
              <Text span fw={500}>
                {t('label.createDate')}
              </Text>{' '}
              {dayjs(item.creationDate).format(FULL_DATE_TIME_FORMAT)}
            </Text>
          ) : null}
        </Stack>
      </Card.Section>
    </Card>
  );
}
export default memo(BucketItem);
