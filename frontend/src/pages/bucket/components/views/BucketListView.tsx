import { Box, Card, Stack, Text } from '@mantine/core';
import { GetListBucket } from '@wails/S3Browser/internal/handlers/buckethandler';
import { ConnectionProfileOutput, ListBucketOutput } from '@wails/S3Browser/models';
import { Folder } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { callIPC } from '@/common/utils/ipcUtils';

type BucketListViewProps = {
  profile?: ConnectionProfileOutput | null;
  onSelectBucket?: (bucketName: string | undefined) => void;
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
  const [hoveredKey, setHoveredKey] = useState<number | null>(null);

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
    // Only show data loaded for the currently connected profile
    const bucketList = profileId && bucketDatas?.connectionId === profileId ? bucketDatas.bucketList : [];
    return (bucketList || []).map((item, idx) => (
      <Card
        key={`${item.name}-${idx}`}
        padding="sm"
        orientation="horizontal"
        onClick={() => onSelectBucket?.(item.name)}
        onMouseEnter={() => setHoveredKey(idx)}
        onMouseLeave={() => setHoveredKey(prev => (prev === idx ? null : prev))}
        style={{
          cursor: 'pointer',
          transition: 'border-color 150ms ease',
          border: '1px solid #000000',
          borderColor: hoveredKey === idx ? '#606af5' : '#000000',
        }}
      >
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
          <Folder />
        </Card.Section>
        <Card.Section
          inheritPadding
          px="md"
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <Stack>
            <Text size="xl" fw="bold">
              {item.name}
            </Text>
            <Box mt="xs">
              <Text>Create date</Text>
              <Text>{item.creationDate}</Text>
            </Box>
          </Stack>
        </Card.Section>
      </Card>
    ));
  }, [bucketDatas, profileId, onSelectBucket, hoveredKey]);

  return <>{bucketDetail}</>;
}
export default BucketListView;
