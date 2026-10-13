import { Box, Card, Group, Menu, Stack, Text } from '@mantine/core';
import { DownloadObject, GetListObject } from '@wails/S3Browser/internal/handlers/buckethandler';
import { ConnectionProfileOutput, ListObjectOutput } from '@wails/S3Browser/models';
import dayjs from 'dayjs';
import { Ellipsis } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FULL_DATE_TIME_FORMAT } from '@/common/cnst/commonConst';
import { callIPC } from '@/common/utils/ipcUtils';
import { formatFileSize } from '@/common/utils/stringUtils';
import ActionIcon from '@/components/buttons/AcctionIcon';
import CheckBoxInput from '@/components/inputs/CheckBoxInput';
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

  const [selection, setSelection] = useState<string[]>([]);
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
      { connectionId: profileId, profileName, bucket, prefix: '', nextCursor: '', limit: 10 },
    ]).then(output => {
      if (output && !cancelled) {
        setObjectDatas({ ...output, connectionId: profileId, profileName, bucket });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [profileId, profileName, bucket]);

  const onClickDownload = useCallback(
    (object: string) => {
      if (!profileId || !bucket) return;
      callIPC(DownloadObject, [{ connectionId: profileId, profileName, bucket, objects: [object] }]);
    },
    [bucket, profileName, profileId]
  );

  const objectDetail = useMemo(() => {
    const objectList = profileId && objectDatas?.connectionId === profileId ? objectDatas.objectList : [];
    return (objectList || []).map((item, idx) => (
      <Card key={`${item.name}-${idx}`} padding="8px" orientation="horizontal" className={classes.card}>
        <Card.Section
          inheritPadding
          px="8px"
          withBorder
          className={classes.iconSection}
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <CheckBoxInput />
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
            <Text size="xl" truncate="end" fw={500}>
              {item.name}
            </Text>
            <Group gap="xl">
              <Box miw="100px">
                <Text span className={classes.label}>
                  Size
                </Text>
                <Text>{formatFileSize(item.size)}</Text>
              </Box>

              <Box miw="100px">
                <Text span className={classes.label}>
                  Last Modified
                </Text>
                <Text>{dayjs(item.lastModified).format(FULL_DATE_TIME_FORMAT)}</Text>
              </Box>
            </Group>
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
          <Menu width={200}>
            <Menu.Target>
              <ActionIcon>
                <Ellipsis />
              </ActionIcon>
            </Menu.Target>

            <Menu.Dropdown>
              <Menu.Item onClick={() => onClickDownload(item.key)}>Download</Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Card.Section>
      </Card>
    ));
  }, [profileId, objectDatas.objectList, objectDatas.connectionId, onClickDownload]);

  return <>{objectDetail}</>;
}
export default ObjectListView;
