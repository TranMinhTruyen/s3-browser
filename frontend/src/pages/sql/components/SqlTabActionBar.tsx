import { Group } from '@mantine/core';
import { Play, PlugZap } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import ActionIcon from '@/components/buttons/ActionIcon';
import Combobox from '@/components/inputs/combobox/Combobox';

type SqlTabActionBarProps = {
  isConnected: boolean;
  selectedProfileId: string | null;
  profileOptions: { name: string; value: string }[];
  onChangeSelectProfile: (value: string | null) => void;
  onClickConnect: () => void;
  onClickExecute: () => void;
};

/** Toolbar of a SQL tab: profile picker, connect and execute. */
function SqlTabActionBar(props: SqlTabActionBarProps) {
  const { isConnected, selectedProfileId, profileOptions, onChangeSelectProfile, onClickConnect, onClickExecute } =
    props;
  const { t } = useTranslation('sqlTab');

  return (
    <Group gap="xs" p="4px" style={{ flexShrink: 0 }}>
      <Combobox
        value={selectedProfileId}
        onChange={onChangeSelectProfile}
        data={profileOptions}
        searchPlaceholder={t('search.placeholderProfile')}
        emptyText={t('search.emptyProfile')}
        style={{ width: '200px' }}
      />

      <ActionIcon onClick={onClickConnect} tooltip={t('tooltip.connect')} disabled={isConnected || !selectedProfileId}>
        <PlugZap />
      </ActionIcon>

      {/* Running only needs a chosen profile, not a connection. */}
      <ActionIcon onClick={onClickExecute} tooltip={t('tooltip.execute')} disabled={!selectedProfileId}>
        <Play />
      </ActionIcon>
    </Group>
  );
}
export default memo(SqlTabActionBar);
