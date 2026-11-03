import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useProfileStore } from '@/common/stores/profileStore';
import { useTabListStore } from '@/common/stores/tabListStore';
import TruncatedText from '@/components/TruncatedText';

/** Tab title: the connected profile's name, or the default name. Subscribes only to its own tab/profile. */
function TabLabel({ tabId }: { tabId: string }) {
  const { t } = useTranslation('tabLayout');

  const profileId = useTabListStore(s => s.tabList[tabId]?.profileId);
  const profile = useProfileStore(s => (profileId ? s.connectionProfiles[profileId] : undefined));

  return <TruncatedText>{profile?.isConnected ? profile.name : t('title.defaultTabName')}</TruncatedText>;
}

export default memo(TabLabel);
