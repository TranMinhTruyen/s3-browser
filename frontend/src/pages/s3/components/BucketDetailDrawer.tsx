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

// `key` là bucket mà state thuộc về; state mang key khác được xem như đang tải.
type DetailState =
  | { key: string; status: 'loading' | 'error' }
  | { key: string; status: 'done'; detail: BucketDetailOutput };

const OBJECT_LOCK_ENABLED = 'Enabled';

/** Ngăn bên phải hiển thị cấu hình bucket đã chọn (tải theo nhu cầu, có thể hủy). */
function BucketDetailDrawer(props: BucketDetailDrawerProps) {
  const { tabId, connectionId, profileName } = props;

  const { t, i18n } = useTranslation('bucketDetailDrawer');

  const bucket = useTabListStore(s => s.tabList[tabId]?.detailBucket);
  const closeBucketDetail = useTabListStore(s => s.closeBucketDetail);

  const [loaded, setLoaded] = useState<DetailState>({ key: '', status: 'loading' });
  // Được nút thử lại tăng lên để chạy lại yêu cầu với cùng key.
  const [reloadCount, setReloadCount] = useState(0);

  const bucketName = bucket?.name;
  // Khi ngăn đóng, bỏ chi tiết đã tải để mở lại cùng bucket không bị lóe dữ liệu cũ.
  if (!bucketName && loaded.key !== '') setLoaded({ key: '', status: 'loading' });
  // Không hiển thị chi tiết bucket trước trong lúc tải bucket mới.
  const state: DetailState = loaded.key === bucketName ? loaded : { key: bucketName ?? '', status: 'loading' };

  // Mỗi bucket có một yêu cầu mới: hàm dọn dẹp hủy yêu cầu trước để kết quả về muộn không ghi đè bucket mới.
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

  // Backend gửi giá trị thô (`Enabled`, `Enabled (GOVERNANCE, 30d)`, `AES256`...): chỉ dịch các từ đã biết,
  // các giá trị khác được hiển thị nguyên dạng.
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
      // Giữ nguyên phần thời hạn lưu giữ, ví dụ `Enabled (GOVERNANCE, 30d)`.
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

  // Thời điểm zero của Go (0001-01-01) nghĩa là backend không có ngày (kết nối ẩn danh).
  const createDate = dayjs(bucket.creationDate);
  const detail = state.status === 'done' ? state.detail : undefined;
  // Mode trong store được cập nhật sau khi lưu policy; chi tiết đã tải có thể cũ hơn trạng thái đó.
  const policyMode = POLICY_MODES.includes(bucket.policyMode as PolicyMode) ? bucket.policyMode : detail?.policyMode;

  return (
    <Box
      w="20rem"
      h="100%"
      style={{
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        borderLeft: '1px solid var(--mantine-color-default-border)',
      }}
    >
      <Group justify="space-between" p="0.5rem" wrap="nowrap" style={{ flexShrink: 0 }}>
        <Text fw={600}>{t('title')}</Text>
        <CloseButton onClick={onClickClose} tooltip={t('tooltip.close')} />
      </Group>

      <ScrollArea style={{ flex: 1, minHeight: 0 }}>
        <Stack gap="sm" p="0.5rem">
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
