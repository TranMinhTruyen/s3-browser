import { Divider, Group, Paper, Stack, Tooltip } from '@mantine/core';
import { ConnectS3ByProfile } from '@wails/S3Browser/internal/handlers/buckethandler';
import { ArrowLeft, PlugZap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useProfileStore } from '@/common/stores/profileStore';
import { callIPC } from '@/common/utils/ipcUtils';
import { isNullOrEmpty } from '@/common/utils/stringUtils';
import ActionIcon from '@/components/buttons/AcctionIcon';
import Combobox from '@/components/inputs/combobox/Combobox';
import ConnectModal from '@/components/modals/ConnectModal';
import BucketListView from '@/pages/bucket/components/views/BucketListView';
import ObjectListView from '@/pages/bucket/components/views/ObjectListView';
import { useTabListStore } from '@/pages/bucket/tabListStore';

type PanelDetailProps = {
  tabId: string;
  profileId?: string | null;
};

function PanelDetail(props: PanelDetailProps) {
  const { tabId, profileId } = props;

  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(profileId ?? null);
  const [selectedBucket, setSelectedBucket] = useState<string | undefined>(undefined);
  const [currentView, setCurrentView] = useState<'bucketList' | 'objectList'>('bucketList');

  const connectionProfiles = useProfileStore(s => s.connectionProfiles);
  const updateTab = useTabListStore(s => s.updateTab);
  const updateConnectionProfiles = useProfileStore(s => s.updateConnectionProfiles);
  const optionsData = Object.entries(connectionProfiles).map(([key, value]) => ({
    name: value?.name ?? '',
    value: key,
  }));

  const isConnected = !!selectedProfileId && !!connectionProfiles[selectedProfileId]?.isConnected;

  useEffect(() => {
    if (selectedProfileId) {
      updateTab(tabId, isConnected ? selectedProfileId : null);
    }
  }, [isConnected, selectedProfileId, tabId, updateTab]);

  const handleConnect = async () => {
    if (isNullOrEmpty(selectedProfileId)) return;

    const profile = connectionProfiles[selectedProfileId];

    if (!profile || profile.isConnected) return;
    if (!profile.accessKey) {
      ConnectModal.show({
        mode: 'manualconnect',
        connectionProfile: { ...profile },
      });
      return;
    }

    const output = await callIPC(ConnectS3ByProfile, [selectedProfileId]);
    if (output?.isConnected) {
      updateConnectionProfiles(selectedProfileId, { ...profile, isConnected: true });
    }
  };

  const handleChangeSelectProfile = (value: string | null) => {
    setSelectedProfileId(value);
    if (value && connectionProfiles[value]?.isConnected) {
      updateTab(tabId, value);
    } else {
      updateTab(tabId, null);
    }
  };

  const handleSelectBucket = (bucketName: string | undefined) => {
    if (bucketName) {
      setCurrentView('objectList');
      setSelectedBucket(bucketName);
    }
  };

  const renderView = (
    <>
      <Stack gap="8px" display={currentView === 'bucketList' ? undefined : 'none'}>
        <BucketListView
          profile={isConnected ? connectionProfiles[selectedProfileId] : null}
          onSelectBucket={handleSelectBucket}
        />
      </Stack>
      {currentView === 'objectList' ? (
        <Stack gap="8px">
          <ObjectListView
            profile={isConnected ? connectionProfiles[selectedProfileId] : null}
            bucket={selectedBucket}
          />
        </Stack>
      ) : null}
    </>
  );

  return (
    <Paper withBorder h="100%">
      <Group gap="xs" p="4px">
        <Combobox
          value={selectedProfileId}
          onChange={handleChangeSelectProfile}
          data={optionsData}
          style={{ width: '200px' }}
        />

        <ActionIcon onClick={handleConnect} disabled={isConnected}>
          <PlugZap />
        </ActionIcon>

        {currentView === 'objectList' ? (
          <Tooltip withArrow label="Back to bucket">
            <ActionIcon onClick={() => setCurrentView('bucketList')}>
              <ArrowLeft />
            </ActionIcon>
          </Tooltip>
        ) : null}
      </Group>

      <Divider />

      <Paper p="8px">
        <Stack gap="8px">{renderView}</Stack>
      </Paper>
    </Paper>
  );
}
export default PanelDetail;
