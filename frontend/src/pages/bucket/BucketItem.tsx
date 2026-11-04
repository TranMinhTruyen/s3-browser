import { Card, Group, Stack, Text } from '@mantine/core';
import { Bucket } from '@wails/S3Browser/models/bucket';
import dayjs from 'dayjs';
import { Folder } from 'lucide-react';
import { type CSSProperties, memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { FULL_DATE_TIME_FORMAT, LIST_ROW_HEIGHT } from '@/common/cnst/commonConst';
import TruncatedText from '@/components/display/TruncatedText';
import WarningIcon from '@/components/display/WarningIcon';
import ConfirmModal from '@/components/modals/confirm/ConfirmModal';
import classes from '@/pages/bucket/page.module.css';

type BucketItemProps = {
  item: Bucket;
  onSelectBucket?: (bucketName: string | undefined) => void;
};

const ICON_SECTION_STYLE: CSSProperties = {
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  minWidth: '56px',
  justifyContent: 'center',
};
const CONTENT_SECTION_STYLE: CSSProperties = { flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' };

/**
 * One row of the bucket list: name, creation date (unknown for anonymous buckets) and a warning when the bucket
 * cannot be accessed. Clicking it opens the bucket, after a confirmation when it may be inaccessible.
 */
function BucketItem(props: BucketItemProps) {
  const { item, onSelectBucket } = props;
  const { t } = useTranslation('bucket', { keyPrefix: 'page' });
  // An anonymous connection cannot read the creation date, so the backend sends the zero date (year 1).
  const hasCreationDate = dayjs(item.creationDate).year() > 1;

  const onClickBucket = useCallback(async () => {
    // The access probe can be wrong (e.g. prefix-scoped policies), so warn and let the user decide.
    if (item.inaccessible) {
      const confirmed = await ConfirmModal.show({
        type: 'warning',
        confirmCode: 'C000007',
        params: { bucket: item.name },
      });
      if (!confirmed) return;
    }
    onSelectBucket?.(item.name);
  }, [onSelectBucket, item.name, item.inaccessible]);

  return (
    <Card padding="sm" orientation="horizontal" h={LIST_ROW_HEIGHT} onClick={onClickBucket} className={classes.card}>
      <Card.Section inheritPadding px="xs" withBorder className={classes.iconSection} style={ICON_SECTION_STYLE}>
        <Folder />
      </Card.Section>
      <Card.Section inheritPadding px="xs" style={CONTENT_SECTION_STYLE}>
        {/* miw=0 lets the flex item shrink, so a long bucket name is truncated instead of overflowing. */}
        <Stack miw={0} gap="4px">
          <Group gap="xs" wrap="nowrap">
            <TruncatedText size="xl" fw="bold">
              {item.name}
            </TruncatedText>
            {item.inaccessible ? <WarningIcon label={t('tooltip.inaccessible')} size={18} /> : null}
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
