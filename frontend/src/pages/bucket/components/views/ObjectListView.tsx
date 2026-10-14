import { Box, Card, Group, Menu, Stack, Text } from '@mantine/core';
import { DownloadObject, GetListObject } from '@wails/S3Browser/internal/handlers/buckethandler';
import { ConnectionProfileOutput } from '@wails/S3Browser/models';
import { ObjectItem } from '@wails/S3Browser/models/bucket';
import dayjs from 'dayjs';
import { Ellipsis } from 'lucide-react';
import { Ref, useCallback, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { FULL_DATE_TIME_FORMAT } from '@/common/cnst/commonConst';
import { useTabListStore } from '@/common/stores/tabListStore';
import { callIPC } from '@/common/utils/ipcUtils';
import { formatFileSize } from '@/common/utils/stringUtils';
import ActionIcon from '@/components/buttons/AcctionIcon';
import CheckBoxInput from '@/components/inputs/CheckBoxInput';
import classes from '@/pages/bucket/page.module.css';

export type ObjectListViewRef = {
  onRefresh?: () => Promise<void>;
};

type ObjectListViewProps = {
  tabId: string;
  bucket?: string;
  profile?: ConnectionProfileOutput | null;
  ref?: Ref<ObjectListViewRef>;
};

// Stable fallback so the selector doesn't return a new array on every call
const EMPTY_SELECTION: string[] = [];

function ObjectListView(props: ObjectListViewProps) {
  const { tabId, bucket, profile, ref } = props;

  const [objectDatas, setObjectDatas] = useState<ObjectItem[]>([]);

  const connectionId = profile?.id;
  const profileName = profile?.name;
  const selectItems = useTabListStore(s => s.tabList[tabId]?.selectionItem ?? EMPTY_SELECTION);
  const selectedKeys = useMemo(() => new Set(selectItems), [selectItems]);

  const addSelectItem = useTabListStore(s => s.addSelectItem);
  const removeSelectItem = useTabListStore(s => s.removeSelectItem);

  const handleGetListObject = useCallback(() => {
    if (!connectionId || !bucket) return Promise.resolve(undefined);
    return callIPC(GetListObject, [{ connectionId, profileName, bucket, prefix: '', nextCursor: '', limit: 10 }]);
  }, [bucket, profileName, connectionId]);

  useImperativeHandle(
    ref,
    () => ({
      onRefresh: async () => {
        removeSelectItem(tabId, selectItems);
        const output = await handleGetListObject();
        if (output) {
          setObjectDatas(output.objectList);
        }
      },
    }),
    [handleGetListObject, tabId, selectItems, removeSelectItem]
  );

  useEffect(() => {
    if (!connectionId || !bucket) return;

    let cancelled = false;
    handleGetListObject().then(output => {
      if (output && !cancelled) {
        setObjectDatas(output.objectList);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [connectionId, bucket, handleGetListObject]);

  const onClickDownload = useCallback(
    (object: string) => {
      if (!connectionId || !bucket) return;
      callIPC(DownloadObject, [{ connectionId: connectionId, profileName, bucket, objects: [object] }]);
    },
    [bucket, profileName, connectionId]
  );

  const onToggleSelect = useCallback(
    (key: string, checked: boolean) => {
      if (checked) addSelectItem(tabId, [key]);
      else removeSelectItem(tabId, [key]);
    },
    [tabId, addSelectItem, removeSelectItem]
  );

  const objectDetail = useMemo(() => {
    const objectList = connectionId ? objectDatas : [];
    return (objectList || []).map((item, idx) => (
      <Card
        key={`${item.name}-${idx}`}
        padding="8px"
        orientation="horizontal"
        onClick={() => onToggleSelect(item.key, !selectedKeys.has(item.key))}
        className={classes.card}
      >
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
          <CheckBoxInput
            styles={{ input: { cursor: 'pointer' } }}
            checked={selectedKeys.has(item.key)}
            onChange={e => onToggleSelect(item.key, e.currentTarget.checked)}
          />
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
          onClick={e => e.stopPropagation()}
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
  }, [connectionId, objectDatas, onClickDownload, selectedKeys, onToggleSelect]);

  return <>{objectDetail}</>;
}
export default ObjectListView;
