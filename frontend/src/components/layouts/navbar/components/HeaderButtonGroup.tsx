import { Group, Stack } from '@mantine/core';
import { ListPlus, PlugZap, RefreshCw } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useProfileStore } from '@/common/stores/profileStore';
import ActionIcon from '@/components/buttons/ActionIcon';
import { showConnectModal } from '@/components/modals/lazyModals';

function HeaderButtonGroup() {
  const { t } = useTranslation('connectionProfiles');
  const loadConnectionProfiles = useProfileStore(s => s.loadConnectionProfiles);

  const onClickConnect = useCallback(() => {
    showConnectModal({ mode: 'connect' });
  }, []);

  const onClickCreateProfile = useCallback(() => {
    showConnectModal({ mode: 'createProfile' });
  }, []);

  const onClickRefresh = useCallback(async () => {
    await loadConnectionProfiles();
  }, [loadConnectionProfiles]);

  return (
    <Stack p="8px">
      <Group gap="xs">
        <ActionIcon onClick={onClickConnect} tooltip={t('tooltip.connect')}>
          <PlugZap />
        </ActionIcon>

        <ActionIcon onClick={onClickCreateProfile} tooltip={t('tooltip.createProfile')}>
          <ListPlus />
        </ActionIcon>

        <ActionIcon onClick={onClickRefresh} tooltip={t('tooltip.refresh')} ml="auto">
          <RefreshCw />
        </ActionIcon>
      </Group>
    </Stack>
  );
}
export default HeaderButtonGroup;
