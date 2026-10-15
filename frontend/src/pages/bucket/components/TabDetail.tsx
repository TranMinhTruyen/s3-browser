import { Divider, Group, Paper, Stack, Tooltip } from '@mantine/core';
import { ConnectS3ByProfile } from '@wails/S3Browser/internal/handlers/buckethandler';
import { ArrowLeft, PlugZap, RefreshCw } from 'lucide-react';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useProfileStore } from '@/common/stores/profileStore';
import { useTabListStore } from '@/common/stores/tabListStore';
import { callIPC } from '@/common/utils/ipcUtils';
import { isNullOrEmpty } from '@/common/utils/stringUtils';
import ActionIcon from '@/components/buttons/ActionIcon';
import Combobox from '@/components/inputs/combobox/Combobox';
import ConnectModal from '@/components/modals/ConnectModal';
import BucketListView from '@/pages/bucket/components/views/BucketListView';
import ObjectListView, { ObjectListViewRef } from '@/pages/bucket/components/views/ObjectListView';

type TabDetailProps = {
  tabId: string;
};

function TabDetail(props: TabDetailProps) {
  const { tabId } = props;

  const { t } = useTranslation('bucket', { keyPrefix: 'page' });

  const [selectedBucket, setSelectedBucket] = useState<string | undefined>(undefined);

  // Narrow selectors: selection changes must not re-render the whole tab.
  const selectedProfileId = useTabListStore(s => s.tabList[tabId]?.profileId ?? null);
  const tabView = useTabListStore(s => s.tabList[tabId]?.currentView ?? 'bucketList');
  const connectionProfiles = useProfileStore(s => s.connectionProfiles);
  const objectListRef = useRef<ObjectListViewRef>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isConnected = !!selectedProfileId && !!connectionProfiles[selectedProfileId]?.isConnected;
  const currentView = isConnected ? tabView : 'bucketList';
  // Memoized so Combobox options keep stable item references across renders.
  const optionsData = useMemo(
    () =>
      Object.entries(connectionProfiles).map(([key, value]) => ({
        name: value?.name ?? '',
        value: key,
      })),
    [connectionProfiles]
  );

  const updateTab = useTabListStore(s => s.updateTab);
  const updateConnectionProfiles = useProfileStore(s => s.updateConnectionProfiles);
  const changeCurrentView = useTabListStore(s => s.changeCurrentView);

  const onCLickConnect = useCallback(async () => {
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
  }, [connectionProfiles, updateConnectionProfiles, selectedProfileId]);

  const onClickRefresh = useCallback(() => {
    if (currentView === 'objectList') {
      return objectListRef.current?.onRefresh?.();
    }
  }, [currentView]);

  const onChangeSelectProfile = useCallback(
    (value: string | null) => {
      updateTab(tabId, { profileId: value, currentView: 'bucketList' });
    },
    [tabId, updateTab]
  );

  const onChangeSelectBucket = useCallback(
    (bucketName: string | undefined) => {
      if (bucketName) {
        changeCurrentView(tabId, 'objectList');
        setSelectedBucket(bucketName);
      }
    },
    [tabId, changeCurrentView]
  );

  const renderView = (
    <>
      <Stack gap="8px" display={currentView === 'bucketList' ? undefined : 'none'}>
        <BucketListView
          profile={isConnected ? connectionProfiles[selectedProfileId] : null}
          onSelectBucket={onChangeSelectBucket}
        />
      </Stack>
      {currentView === 'objectList' ? (
        <Stack gap="8px">
          <ObjectListView
            tabId={tabId}
            profile={isConnected ? connectionProfiles[selectedProfileId] : null}
            bucket={selectedBucket}
            scrollRef={scrollRef}
            ref={objectListRef}
          />
        </Stack>
      ) : null}
    </>
  );

  return (
    <Paper withBorder h="100%" display="flex" style={{ flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <Group gap="xs" p="4px" style={{ flexShrink: 0 }}>
        <Combobox
          value={selectedProfileId}
          onChange={onChangeSelectProfile}
          data={optionsData}
          style={{ width: '200px' }}
        />

        <Tooltip label="Connect">
          <ActionIcon onClick={onCLickConnect} disabled={isConnected || !selectedProfileId}>
            <PlugZap />
          </ActionIcon>
        </Tooltip>

        <Tooltip label={`Refresh ${t(`tooltip.${currentView}`)}`}>
          <ActionIcon onClick={onClickRefresh} disabled={!isConnected}>
            <RefreshCw />
          </ActionIcon>
        </Tooltip>

        {currentView === 'objectList' ? (
          <Tooltip label="Back to bucket">
            <ActionIcon onClick={() => changeCurrentView(tabId, 'bucketList')}>
              <ArrowLeft />
            </ActionIcon>
          </Tooltip>
        ) : null}
      </Group>

      <Divider />

      <Paper ref={scrollRef} p="8px" style={{ flex: 1, minHeight: 0, overflow: 'auto', position: 'relative' }}>
        <Stack gap="8px">{renderView}</Stack>
      </Paper>
    </Paper>
  );
}
export default memo(TabDetail);
