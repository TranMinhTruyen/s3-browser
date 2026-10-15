import { Group, Stack, Tooltip } from '@mantine/core';
import { ListPlus, PlugZap, RefreshCw } from 'lucide-react';
import { useProfileStore } from '@/common/stores/profileStore';
import ActionIcon from '@/components/buttons/ActionIcon';
import ConnectModal from '@/components/modals/ConnectModal';

function HeaderButtonGroup() {
  const loadConnectionProfiles = useProfileStore(s => s.loadConnectionProfiles);

  const handleAddConnectionProfile = (mode: 'connect' | 'createProfile') => () => {
    ConnectModal.show({ mode: mode });
  };

  const handleRefresh = async () => {
    await loadConnectionProfiles();
  };

  return (
    <Stack p="8px">
      <Group gap="xs">
        <Tooltip label="Connect">
          <ActionIcon onClick={handleAddConnectionProfile('connect')}>
            <PlugZap />
          </ActionIcon>
        </Tooltip>

        <Tooltip label="Create connection profile">
          <ActionIcon onClick={handleAddConnectionProfile('createProfile')}>
            <ListPlus />
          </ActionIcon>
        </Tooltip>

        <Tooltip label="Refresh connection profile list">
          <ActionIcon onClick={handleRefresh} ml="auto">
            <RefreshCw />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Stack>
  );
}
export default HeaderButtonGroup;
