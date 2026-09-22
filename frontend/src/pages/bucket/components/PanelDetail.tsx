import { Box, Card, Divider, Group, Paper, Stack, Text } from '@mantine/core';
import { ConnectS3ByProfile, GetListBucket } from '@wails/S3Browser/internal/handlers/buckethandler';
import { ListBucketOutput } from '@wails/S3Browser/models/bucket';
import { Folder, PlugZap } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useProfileStore } from '@/common/stores/profileStore';
import { callIPC } from '@/common/utils/ipcUtils';
import { isNullOrEmpty } from '@/common/utils/stringUtils';
import ActionIcon from '@/components/buttons/AcctionIcon';
import Combobox from '@/components/inputs/combobox/Combobox';
import ConnectModal from '@/components/modals/ConnectModal';
import { useTabListStore } from '@/pages/bucket/tabListStore';

type PanelDetailProps = {
  tabId: string;
  profileId?: string | null;
};

function PanelDetail(props: PanelDetailProps) {
  const { tabId, profileId } = props;

  const [selectProfile, setSelectProfile] = useState<string | null>(profileId ?? null);
  const [bucketDatas, setBucketDatas] = useState<ListBucketOutput | null>({ bucketList: [], nextCursor: '' });

  const connectionProfiles = useProfileStore(s => s.connectionProfiles);
  const updateTab = useTabListStore(s => s.updateTab);
  const updateConnectionProfiles = useProfileStore(s => s.updateConnectionProfiles);
  const optionsData = Object.entries(connectionProfiles).map(([key, value]) => ({
    name: value?.name ?? '',
    value: key,
  }));

  const isConnected = !!selectProfile && !!connectionProfiles[selectProfile]?.isConnected;

  useEffect(() => {
    if (selectProfile) {
      updateTab(tabId, isConnected ? selectProfile : null);
    }
  }, [isConnected, selectProfile, tabId, updateTab]);

  const handleGetBucketList = async (nextCursor: string) => {
    if (selectProfile && connectionProfiles[selectProfile]) {
      const profile = connectionProfiles[selectProfile];
      const output = await callIPC(GetListBucket, [
        {
          connectionId: selectProfile,
          profileName: profile.name,
          nextCursor,
          limit: 10,
        },
      ]);
      if (output) {
        setBucketDatas({ ...output });
      }
    }
  };

  const handleConnect = async () => {
    if (isNullOrEmpty(selectProfile)) return;

    const profile = connectionProfiles[selectProfile];

    if (!profile || profile.isConnected) return;
    if (!profile.savePassword) {
      ConnectModal.show({
        mode: 'manualconnect',
        connectionProfile: { ...profile },
      });
      return;
    }

    const output = await callIPC(ConnectS3ByProfile, [selectProfile]);
    if (output?.isConnected) {
      handleGetBucketList('');
      updateConnectionProfiles(selectProfile, { ...profile, isConnected: true });
    }
  };

  const handleChangeSelectProfile = (value: string | null) => {
    setSelectProfile(value);
    if (value && connectionProfiles[value]?.isConnected) {
      updateTab(tabId, value);
    } else {
      updateTab(tabId, null);
    }
  };

  const bucketDetail = useMemo(() => {
    if (!isConnected) return [];
    return (bucketDatas?.bucketList || []).map((item, idx) => (
      <Card key={idx} padding="sm" orientation="horizontal" style={{ border: '1px solid black' }}>
        <Card.Section
          inheritPadding
          px="xs"
          withBorder
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            minWidth: '56px',
            justifyContent: 'center',
          }}
        >
          <Folder />
        </Card.Section>
        <Card.Section
          inheritPadding
          px="md"
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <Stack>
            <Text size="xl" fw="bold">
              {item.name}
            </Text>
            <Box mt="xs">
              <Text>Create date</Text>
              <Text>{item.creationDate}</Text>
            </Box>
          </Stack>
        </Card.Section>
      </Card>
    ));
  }, [bucketDatas, isConnected]);

  return (
    <Paper withBorder h="100%">
      <Group gap="xs" p="4px">
        <Combobox
          value={selectProfile}
          onChange={handleChangeSelectProfile}
          data={optionsData}
          style={{ width: '200px' }}
        />

        <ActionIcon onClick={handleConnect}>
          <PlugZap />
        </ActionIcon>
      </Group>

      <Divider />

      <Paper p="8px">
        {profileId ? connectionProfiles[profileId]?.name : 'New connection'}
        <Stack gap="8px">{bucketDetail}</Stack>
      </Paper>
    </Paper>
  );
}
export default PanelDetail;
