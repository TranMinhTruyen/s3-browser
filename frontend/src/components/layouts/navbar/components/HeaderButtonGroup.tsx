import { Group, Stack, Tooltip } from '@mantine/core';
import { ListPlus, PlugZap, RefreshCw } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useProfileStore } from '@/common/stores/profileStore';
import ActionIcon from '@/components/buttons/ActionIcon';
import ConnectModal from '@/components/modals/ConnectModal';

function HeaderButtonGroup() {
  const { t } = useTranslation('connectionProfiles');
  const loadConnectionProfiles = useProfileStore(s => s.loadConnectionProfiles);

  const onClickConnect = useCallback(() => {
    ConnectModal.show({ mode: 'connect' });
  }, []);

  const onClickCreateProfile = useCallback(() => {
    ConnectModal.show({ mode: 'createProfile' });
  }, []);

  const onClickRefresh = useCallback(async () => {
    await loadConnectionProfiles();
  }, [loadConnectionProfiles]);

  return (
    <Stack p="8px">
      <Group gap="xs">
        <Tooltip label={t('tooltip.connect')}>
          <ActionIcon onClick={onClickConnect} aria-label={t('tooltip.connect')}>
            <PlugZap />
          </ActionIcon>
        </Tooltip>

        <Tooltip label={t('tooltip.createProfile')}>
          <ActionIcon onClick={onClickCreateProfile} aria-label={t('tooltip.createProfile')}>
            <ListPlus />
          </ActionIcon>
        </Tooltip>

        <Tooltip label={t('tooltip.refresh')}>
          <ActionIcon onClick={onClickRefresh} aria-label={t('tooltip.refresh')} ml="auto">
            <RefreshCw />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Stack>
  );
}
export default HeaderButtonGroup;
