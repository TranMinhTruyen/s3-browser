import { Box, DataList, Divider, Group, Loader, ScrollArea, Stack, Text } from '@mantine/core';
import { GetBucketDetail } from '@wails/S3Browser/internal/handlers/buckethandler';
import { BucketDetailOutput } from '@wails/S3Browser/models/bucket';
import dayjs from 'dayjs';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FULL_DATE_TIME_FORMAT } from '@/common/cnst/commonConst';
import { callIPC } from '@/common/utils/ipcUtils';
import Button from '@/components/buttons/Button';
import CloseButton from '@/components/buttons/CloseButton';
import DetailRow, { EMPTY_VALUE } from '@/pages/s3/components/DetailRow';
import { useTabListStore } from '@/pages/s3/stores/tabListStore';
import { POLICY_MODES, type PolicyMode } from '@/pages/s3/utils/bucketUtils';

type BucketDetailDrawerProps = {
  tabId: string;
  connectionId: string;
  profileName?: string;
};

// `key` is the bucket the state belongs to; a state of another key counts as loading.
type DetailState =
  | { key: string; status: 'loading' | 'error' }
  | { key: string; status: 'done'; detail: BucketDetailOutput };

const OBJECT_LOCK_ENABLED = 'Enabled';

/** Right-side drawer showing the configuration of the selected bucket (loaded lazily, cancelable). */
function BucketDetailDrawer(props: BucketDetailDrawerProps) {
  const { tabId, connectionId, profileName } = props;

  const { t, i18n } = useTranslation('bucketDetailDrawer');

  const bucket = useTabListStore(s => s.tabList[tabId]?.detailBucket);
  const closeBucketDetail = useTabListStore(s => s.closeBucketDetail);

  const [loaded, setLoaded] = useState<DetailState>({ key: '', status: 'loading' });
  // Bumped by the retry button to run the request again for the same key.
  const [reloadCount, setReloadCount] = useState(0);

  const bucketName = bucket?.name;
  // Drawer closed: forget the loaded detail, so reopening the same bucket does not flash stale data.
  if (!bucketName && loaded.key !== '') setLoaded({ key: '', status: 'loading' });
  // Never show the previous bucket's detail while the new one loads.
  const state: DetailState = loaded.key === bucketName ? loaded : { key: bucketName ?? '', status: 'loading' };

  // A new request per bucket: the cleanup aborts the previous one, so a late result never overwrites the new bucket.
  useEffect(() => {
    if (!bucketName) return;
    const ctrl = new AbortController();
    callIPC(GetBucketDetail, [{ connectionId, profileName, bucket: bucketName }], { signal: ctrl.signal }).then(
      output => {
        if (ctrl.signal.aborted) return;
        setLoaded(output ? { key: bucketName, status: 'done', detail: output } : { key: bucketName, status: 'error' });
      }
    );
    return () => ctrl.abort();
  }, [connectionId, profileName, bucketName, reloadCount]);

  const onClickClose = useCallback(() => closeBucketDetail(tabId), [closeBucketDetail, tabId]);
  const onClickRetry = useCallback(() => {
    setLoaded({ key: bucketName ?? '', status: 'loading' });
    setReloadCount(c => c + 1);
  }, [bucketName]);

  // The backend sends raw values (`Enabled`, `Enabled (GOVERNANCE, 30d)`, `AES256`...): only the known words are
  // translated, anything else is shown as it is.
  const formatVersioning = useCallback(
    (value: string) =>
      value === 'Enabled' || value === 'Suspended' || value === 'Off'
        ? t(`value.versioning.${value.toLowerCase()}`)
        : value,
    [t]
  );
  const formatEncryption = useCallback((value: string) => (value === 'None' ? t('value.encryption.none') : value), [t]);
  const formatObjectLock = useCallback(
    (value: string) => {
      if (value === 'Disabled') return t('value.objectLock.disabled');
      // Keep the retention part, e.g. `Enabled (GOVERNANCE, 30d)`.
      return value.startsWith(OBJECT_LOCK_ENABLED)
        ? `${t('value.objectLock.enabled')}${value.slice(OBJECT_LOCK_ENABLED.length)}`
        : value;
    },
    [t]
  );
  const formatRootCount = useCallback(
    (detail: BucketDetailOutput) => {
      if (detail.rootCount == null) return undefined;
      const count = detail.rootCount.toLocaleString(i18n.language);
      return detail.rootCountCapped ? t('value.rootCountCapped', { count }) : count;
    },
    [t, i18n.language]
  );

  const tags = useMemo(
    () =>
      loaded.status === 'done' ? Object.entries(loaded.detail.tags ?? {}).sort(([a], [b]) => a.localeCompare(b)) : [],
    [loaded]
  );

  if (!bucket) return null;

  // Go's zero time (0001-01-01) means the backend has no date (anonymous connection).
  const createDate = dayjs(bucket.creationDate);
  const detail = state.status === 'done' ? state.detail : undefined;
  // The mode kept in the store follows a save of the policy; the loaded detail can be older than that.
  const policyMode = POLICY_MODES.includes(bucket.policyMode as PolicyMode) ? bucket.policyMode : detail?.policyMode;

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
          <Divider label={t('section.basic')} labelPosition="left" />
          <DataList orientation="vertical" withDivider>
            <DetailRow label={t('label.name')} value={bucket.name} />
            {createDate.year() > 1 ? (
              <DetailRow label={t('label.createDate')} value={createDate.format(FULL_DATE_TIME_FORMAT)} />
            ) : null}
            {detail ? (
              <>
                <DetailRow label={t('label.region')} value={detail.region ?? undefined} />
                <DetailRow label={t('label.arn')} value={detail.arn} copyable />
                <DetailRow label={t('label.endpointUrl')} value={detail.endpointUrl} copyable />
              </>
            ) : null}
          </DataList>

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

          {detail ? (
            <>
              <Divider label={t('section.access')} labelPosition="left" />
              <DataList orientation="vertical" withDivider>
                <DetailRow label={t('label.policy')} value={policyMode ? t(`value.policy.${policyMode}`) : undefined} />
                <DetailRow
                  label={t('label.publicBlock')}
                  value={
                    detail.publicBlocked == null
                      ? undefined
                      : t(`value.publicBlock.${detail.publicBlocked ? 'on' : 'off'}`)
                  }
                />
              </DataList>

              <Divider label={t('section.config')} labelPosition="left" />
              <DataList orientation="vertical" withDivider>
                <DetailRow
                  label={t('label.versioning')}
                  value={detail.versioning ? formatVersioning(detail.versioning) : undefined}
                />
                <DetailRow
                  label={t('label.encryption')}
                  value={detail.encryption ? formatEncryption(detail.encryption) : undefined}
                />
                <DetailRow
                  label={t('label.objectLock')}
                  value={detail.objectLock ? formatObjectLock(detail.objectLock) : undefined}
                />
                <DataList.Item>
                  <DataList.ItemLabel>{t('label.tags')}</DataList.ItemLabel>
                  <DataList.ItemValue>
                    {tags.length === 0 ? (
                      EMPTY_VALUE
                    ) : (
                      <DataList labelWidth="40%">
                        {tags.map(([key, value]) => (
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
                <DetailRow label={t('label.rootCount')} value={formatRootCount(detail)} />
              </DataList>
            </>
          ) : null}
        </Stack>
      </ScrollArea>
    </Box>
  );
}
export default memo(BucketDetailDrawer);
