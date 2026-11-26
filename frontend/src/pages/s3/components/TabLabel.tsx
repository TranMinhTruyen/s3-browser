import { Group } from '@mantine/core';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import StatusDot from '@/components/display/StatusDot';
import TruncatedText from '@/components/display/TruncatedText';
import { useProfileStore } from '@/pages/s3/stores/profileStore';
import { useTabListStore } from '@/pages/s3/stores/tabListStore';

/** Tiêu đề tab: chấm trạng thái (khi tab có hồ sơ) + tên hồ sơ đã kết nối hoặc tên mặc định. */
function TabLabel({ tabId }: { tabId: string }) {
  const { t } = useTranslation('tabLayout');

  const profileId = useTabListStore(s => s.tabList[tabId]?.profileId);
  const name = useProfileStore(s => (profileId ? s.connectionProfiles[profileId]?.name : undefined));
  const isConnected = useProfileStore(s => (profileId ? s.connectionProfiles[profileId]?.isConnected : undefined));

  return (
    <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
      {name === undefined ? null : <StatusDot connected={!!isConnected} />}
      <TruncatedText>{isConnected ? name : t('title.defaultTabName')}</TruncatedText>
    </Group>
  );
}

export default memo(TabLabel);
