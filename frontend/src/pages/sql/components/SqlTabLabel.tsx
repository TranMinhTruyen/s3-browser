import { Group } from '@mantine/core';
import { Table2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import StatusDot from '@/components/display/StatusDot';
import TruncatedText from '@/components/display/TruncatedText';
import { useDbProfileStore } from '@/pages/sql/stores/dbProfileStore';
import { useSqlTabStore } from '@/pages/sql/stores/sqlTabStore';

/**
 * Tab title: a table icon and the table name for a TableStructure tab; for a SQL tab the chosen profile's name
 * with its connection status dot, or the default name.
 */
function SqlTabLabel({ tabId }: { tabId: string }) {
  const { t } = useTranslation('sqlTab');

  const tableName = useSqlTabStore(s => s.tabList[tabId]?.table?.name);
  const profileId = useSqlTabStore(s => s.tabList[tabId]?.profileId);
  const name = useDbProfileStore(s => (profileId ? s.dbProfiles[profileId]?.name : undefined));
  const isConnected = useDbProfileStore(s => (profileId ? s.dbProfiles[profileId]?.isConnected : undefined));

  if (tableName !== undefined) {
    return (
      <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
        <Table2 size="1rem" style={{ flexShrink: 0 }} />
        <TruncatedText>{tableName}</TruncatedText>
      </Group>
    );
  }

  return (
    <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
      {name === undefined ? null : <StatusDot connected={!!isConnected} />}
      <TruncatedText>{name ?? t('title.defaultTabName')}</TruncatedText>
    </Group>
  );
}

export default memo(SqlTabLabel);
