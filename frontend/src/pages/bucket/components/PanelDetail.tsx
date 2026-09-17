import { Divider, Group, Paper } from '@mantine/core';
import { ConnectS3ByProfile } from '@wails/S3Browser/internal/handlers/buckethandler';
import { PlugZap } from 'lucide-react';
import { useState } from 'react';
import { useProfileStore } from '@/common/stores/profileStore';
import { callIPC } from '@/common/utils/ipcUtils';
import { isNullOrEmpty } from '@/common/utils/stringUtils';
import ActionIcon from '@/components/buttons/AcctionIcon';
import Combobox from '@/components/inputs/combobox/Combobox';
import ConnectModal from '@/components/modals/ConnectModal';
import { useTabListStore } from '@/pages/bucket/tabListStore';

type PanelDetailProps = {
  tabId: string;
  profileId: string;
};

function PanelDetail(props: PanelDetailProps) {
  const { tabId, profileId } = props;

  const [selectProfile, setSelectProfile] = useState<string | null>(profileId);

  const connectionProfiles = useProfileStore(s => s.connectionProfiles);
  const updateTab = useTabListStore(s => s.updateTab);
  const updateConnectionProfiles = useProfileStore(s => s.updateConnectionProfiles);
  const optionsData = Object.entries(connectionProfiles).map(([key, value]) => ({
    name: value?.name ?? '',
    value: key,
  }));

  const handleConnect = async () => {
    if (isNullOrEmpty(selectProfile)) return;

    const profile = connectionProfiles[selectProfile];

    if (!profile || profile.isConnected) return;
    if (!profile.savePassword) {
      ConnectModal.show({
        mode: 'manualconnect',
        id: profile.id,
        version: profile.version,
        connectionProfileOutput: { ...profile },
      });
      return;
    }

    const output = await callIPC(ConnectS3ByProfile, [selectProfile]);
    if (output?.isConnected) {
      updateConnectionProfiles(selectProfile, { ...profile, isConnected: true });
      updateTab(tabId, selectProfile);
    }
  };

  return (
    <Paper withBorder h="100%">
      <Group gap="xs" p="4px">
        <Combobox onChange={setSelectProfile} data={optionsData} style={{ width: '200px' }} />

        <ActionIcon onClick={handleConnect}>
          <PlugZap />
        </ActionIcon>
      </Group>

      <Divider />

      <Paper p="8px">{connectionProfiles[profileId]?.name || 'New connection'}</Paper>
    </Paper>
  );
}
export default PanelDetail;
