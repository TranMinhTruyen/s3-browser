import { Box, Card, Stack, Text } from '@mantine/core';
import { GetListBucket } from '@wails/S3Browser/internal/handlers/buckethandler';
import { ConnectionProfileOutput, ListBucketOutput } from '@wails/S3Browser/models';
import dayjs from 'dayjs';
import { Folder } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { FULL_DATE_TIME_FORMAT } from '@/common/cnst/commonConst';
import { callIPC } from '@/common/utils/ipcUtils';
import classes from '@/pages/bucket/page.module.css';

type BucketListViewProps = {
  profile?: ConnectionProfileOutput | null;
  onSelectBucket?: (bucketName: string | undefined) => void;
  onRefresh?: () => void;
};

type BucketDatas = ListBucketOutput & {
  connectionId: string;
  profileName?: string;
};

function BucketListView(props: BucketListViewProps) {
  const { profile, onSelectBucket } = props;

  const [bucketDatas, setBucketDatas] = useState<BucketDatas>({
    bucketList: [],
    nextCursor: '',
    connectionId: '',
  });

  const profileId = profile?.id;
  const profileName = profile?.name;

  useEffect(() => {
    if (!profileId) return;

    let cancelled = false;
    callIPC(GetListBucket, [{ connectionId: profileId, profileName, nextCursor: '', limit: 10 }]).then(output => {
      if (output && !cancelled) {
        setBucketDatas({ ...output, connectionId: profileId, profileName });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [profileId, profileName]);

  const bucketDetail = useMemo(() => {
    const bucketList = profileId && bucketDatas?.connectionId === profileId ? bucketDatas.bucketList : [];
    return (bucketList || []).map((item, idx) => (
      <Card
        key={`${item.name}-${idx}`}
        padding="sm"
        orientation="horizontal"
        onClick={() => onSelectBucket?.(item.name)}
        className={classes.card}
      >
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
    ));
  }, [bucketDatas, profileId, onSelectBucket]);

  return <>{bucketDetail}</>;
}
export default BucketListView;
