import { Group } from '@mantine/core';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import StatusDot from '@/components/display/StatusDot';
import TruncatedText from '@/components/display/TruncatedText';
import { useProfileStore } from '@/pages/s3/stores/profileStore';
import { useTabListStore } from '@/pages/s3/stores/tabListStore';

/** Tab title: status dot (when the tab has a profile) + the connected profile's name, or the default name. */
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
