import { Box, DataList, Divider, Group, Loader, ScrollArea, Stack, Text } from '@mantine/core';
import { GetObjectDetail } from '@wails/S3Browser/internal/handlers/buckethandler';
import { ObjectDetailOutput } from '@wails/S3Browser/models/bucket';
import dayjs from 'dayjs';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FULL_DATE_TIME_FORMAT } from '@/common/cnst/commonConst';
import { useTabListStore } from '@/common/stores/tabListStore';
import { callIPC } from '@/common/utils/ipcUtils';
import { formatFileSize } from '@/common/utils/stringUtils';
import Button from '@/components/buttons/Button';
import CloseButton from '@/components/buttons/CloseButton';
import DetailRow, { EMPTY_VALUE } from '@/components/display/DetailRow';

// Go's zero time (0001-01-01) means the backend has no date.
const formatDate = (value: string) => {
  const date = dayjs(value);
  return date.isValid() && date.year() > 1 ? date.format(FULL_DATE_TIME_FORMAT) : undefined;
};

type ObjectDetailDrawerProps = {
  tabId: string;
  connectionId: string;
  profileName?: string;
  bucket: string;
};

// `key` is the object the state belongs to; a state of another key counts as loading.
type DetailState =
  | { key: string; status: 'loading' | 'error' }
  | { key: string; status: 'done'; detail: ObjectDetailOutput };

/** Right-side drawer showing metadata of the selected object (loaded lazily, cancelable). */
function ObjectDetailDrawer(props: ObjectDetailDrawerProps) {
  const { tabId, connectionId, profileName, bucket } = props;

  const { t } = useTranslation('objectDetailDrawer');

  const item = useTabListStore(s => s.tabList[tabId]?.detailItem);
  const closeDetail = useTabListStore(s => s.closeDetail);

  const [loaded, setLoaded] = useState<DetailState>({ key: '', status: 'loading' });
  // Bumped by the retry button to run the request again for the same key.
  const [reloadCount, setReloadCount] = useState(0);

  const itemKey = item?.key;
  // Drawer closed: forget the loaded detail, so reopening the same key does not flash stale data.
  if (!itemKey && loaded.key !== '') setLoaded({ key: '', status: 'loading' });
  // Never show the previous item's detail while the new one loads.
  const state: DetailState = loaded.key === itemKey ? loaded : { key: itemKey ?? '', status: 'loading' };

  // A new request per item: the cleanup aborts the previous one, so a late result never overwrites the new item.
  useEffect(() => {
    if (!itemKey) return;
    const ctrl = new AbortController();
    callIPC(GetObjectDetail, [{ connectionId, profileName, bucket, key: itemKey }], { signal: ctrl.signal }).then(
      output => {
        if (ctrl.signal.aborted) return;
        setLoaded(output ? { key: itemKey, status: 'done', detail: output } : { key: itemKey, status: 'error' });
      }
    );
    return () => ctrl.abort();
  }, [connectionId, profileName, bucket, itemKey, reloadCount]);

  const onClickClose = useCallback(() => closeDetail(tabId), [closeDetail, tabId]);
  const onClickRetry = useCallback(() => {
    setLoaded({ key: itemKey ?? '', status: 'loading' });
    setReloadCount(c => c + 1);
  }, [itemKey]);

  const metadata = useMemo(
    () =>
      loaded.status === 'done' ? Object.entries(loaded.detail.metadata).sort(([a], [b]) => a.localeCompare(b)) : [],
    [loaded]
  );

  if (!item) return null;

  return (
    <Box
      w={320}
      h="100%"
      style={{
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        borderLeft: '1px solid var(--mantine-color-default-border)',
      }}
    >
      <Group justify="space-between" p="8px" wrap="nowrap" style={{ flexShrink: 0 }}>
        <Text fw={600}>{t('title')}</Text>
        <CloseButton onClick={onClickClose} tooltip={t('tooltip.close')} />
      </Group>

      <ScrollArea style={{ flex: 1, minHeight: 0 }}>
        <Stack gap="sm" p="8px">
          <DataList orientation="vertical" withDivider>
            <DetailRow label={t('label.name')} value={item.name} />
            <DetailRow label={t('label.key')} value={item.key} copyable />
            <DetailRow
              label={t('label.size')}
              value={`${formatFileSize(item.size)} (${t('unit.bytes', { size: item.size })})`}
            />
            <DetailRow label={t('label.lastModified')} value={formatDate(item.lastModified)} />
            <DetailRow label={t('label.etag')} value={item.etag} copyable />
          </DataList>
          {/* The lists are separate, so draw the divider between them; Stack's gap matches the list's gap. */}
          <Divider />

          {state.status === 'loading' ? (
            <Group justify="center" py="md">
              <Loader size="sm" />
            </Group>
          ) : null}

          {state.status === 'error' ? (
            <Stack gap="xs" align="flex-start">
              <Text c="var(--mantine-color-red-filled)">{t('status.loadError')}</Text>
              <Button onClick={onClickRetry}>{t('status.retry')}</Button>
            </Stack>
          ) : null}

          {state.status === 'done' ? (
            <DataList orientation="vertical" withDivider>
              <DetailRow label={t('label.contentType')} value={state.detail.contentType} />
              {state.detail.storageClass ? (
                <DetailRow label={t('label.storageClass')} value={state.detail.storageClass} />
              ) : null}
              <DataList.Item>
                <DataList.ItemLabel>{t('label.metadata')}</DataList.ItemLabel>
                <DataList.ItemValue>
                  {metadata.length === 0 ? (
                    EMPTY_VALUE
                  ) : (
                    <DataList labelWidth="40%">
                      {metadata.map(([key, value]) => (
                        <DataList.Item key={key}>
                          <DataList.ItemLabel style={{ overflowWrap: 'anywhere' }}>{key}</DataList.ItemLabel>
                          <DataList.ItemValue style={{ overflowWrap: 'anywhere' }}>
                            {value || EMPTY_VALUE}
                          </DataList.ItemValue>
                        </DataList.Item>
                      ))}
                    </DataList>
                  )}
                </DataList.ItemValue>
              </DataList.Item>
            </DataList>
          ) : null}
        </Stack>
      </ScrollArea>
    </Box>
  );
}
export default memo(ObjectDetailDrawer);
