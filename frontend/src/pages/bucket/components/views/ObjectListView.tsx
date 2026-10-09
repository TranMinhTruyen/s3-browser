import { Box, Card, Menu, Stack, Text } from '@mantine/core';
import { GetListObject } from '@wails/S3Browser/internal/handlers/buckethandler';
import { ConnectionProfileOutput, ListObjectOutput } from '@wails/S3Browser/models';
import dayjs from 'dayjs';
import { Ellipsis, File } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { FULL_DATE_TIME_FORMAT } from '@/common/cnst/commonConst';
import { callIPC } from '@/common/utils/ipcUtils';
import { formatFileSize } from '@/common/utils/stringUtils';
import ActionIcon from '@/components/buttons/AcctionIcon';
import classes from '@/pages/bucket/page.module.css';

type ObjectListViewProps = {
  profile?: ConnectionProfileOutput | null;
  bucket?: string;
};

type ObjectDatas = ListObjectOutput & {
  connectionId: string;
  bucket: string;
  profileName?: string;
};

function ObjectListView(props: ObjectListViewProps) {
  const { bucket, profile } = props;

  const [objectDatas, setObjectDatas] = useState<ObjectDatas>({
    objectList: [],
    nextCursor: '',
    connectionId: '',
    bucket: '',
  });

  const profileId = profile?.id;
  const profileName = profile?.name;

  useEffect(() => {
    if (!profileId || !bucket) return;

    let cancelled = false;
    callIPC(GetListObject, [
      { connectionId: profileId, profileName, bucket: bucket, prefix: '', nextCursor: '', limit: 10 },
    ]).then(output => {
      if (output && !cancelled) {
        setObjectDatas({ ...output, connectionId: profileId, profileName, bucket });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [profileId, profileName, bucket]);

  const objectDetail = useMemo(() => {
    const objectList = profileId && objectDatas?.connectionId === profileId ? objectDatas.objectList : [];
    return (objectList || []).map((item, idx) => (
      <Card key={`${item.name}-${idx}`} padding="sm" orientation="horizontal" className={classes.card}>
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
          <File />
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
            <Box>
              <Text>
                <Text span fw={500}>
                  File size:
                </Text>{' '}
                {formatFileSize(item.size)}
              </Text>
              <Text>
                <Text span fw={500}>
                  Last Modified:
                </Text>{' '}
                {dayjs(item.lastModified).format(FULL_DATE_TIME_FORMAT)}
              </Text>
            </Box>
          </Stack>
        </Card.Section>

        <Card.Section
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            minWidth: '56px',
            justifyContent: 'center',
          }}
        >
          <Menu shadow="lg" withArrow width={200}>
            <Menu.Target>
              <ActionIcon>
                <Ellipsis />
              </ActionIcon>
            </Menu.Target>

            <Menu.Dropdown>
              <Menu.Label>Application</Menu.Label>
              <Menu.Item>Settings</Menu.Item>
              <Menu.Item>Messages</Menu.Item>
              <Menu.Item>Gallery</Menu.Item>
              <Menu.Item
                rightSection={
                  <Text size="xs" c="dimmed">
                    ⌘K
                  </Text>
                }
              >
                Search
              </Menu.Item>

              <Menu.Divider />

              <Menu.Label>Danger zone</Menu.Label>
              <Menu.Item>Transfer my data</Menu.Item>
              <Menu.Item color="red">Delete my account</Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Card.Section>
      </Card>
    ));
  }, [profileId, objectDatas.objectList, objectDatas.connectionId]);

  return <>{objectDetail}</>;
}
export default ObjectListView;
