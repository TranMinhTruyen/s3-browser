import { Anchor, Breadcrumbs, Divider, Group, Paper, Stack, Text, Tooltip } from '@mantine/core';
import { ConnectS3ByProfile } from '@wails/S3Browser/internal/handlers/buckethandler';
import { ArrowLeft, BroomSparkles, Download, PlugZap, RefreshCw, Trash } from 'lucide-react';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useProfileStore } from '@/common/stores/profileStore';
import { useTabListStore } from '@/common/stores/tabListStore';
import { callIPC } from '@/common/utils/ipcUtils';
import { formatStringJson, isNullOrEmpty } from '@/common/utils/stringUtils';
import ActionIcon from '@/components/buttons/ActionIcon';
import Combobox from '@/components/inputs/combobox/Combobox';
import ConnectModal from '@/components/modals/ConnectModal';
import BucketListView, { BucketListViewRef } from '@/pages/bucket/components/views/BucketListView';
import ObjectListView, { ObjectListViewRef } from '@/pages/object/components/views/ObjectListView';
import classes from '@/pages/object/page.module.css';

// Stable fallback so the selector does not return a new array on every call.
const EMPTY_SELECTION: string[] = [];

type TabDetailProps = {
  tabId: string;
};

function TabDetail(props: TabDetailProps) {
  const { tabId } = props;

  const { t } = useTranslation('tabLayout');
  const { t: tBucket } = useTranslation('bucket', { keyPrefix: 'page' });
  const { t: tObject } = useTranslation('object', { keyPrefix: 'page' });

  const [selectedBucket, setSelectedBucket] = useState<string | undefined>(undefined);

  const selectedProfileId = useTabListStore(s => s.tabList[tabId]?.profileId ?? null);
  const tabView = useTabListStore(s => s.tabList[tabId]?.currentView ?? 'bucketList');
  const prefix = useTabListStore(s => s.tabList[tabId]?.prefix ?? '');
  // Only id -> name, so a profile change that keeps its name does not re-render every tab.
  const profileNames = useProfileStore(
    useShallow(s =>
      Object.fromEntries(Object.entries(s.connectionProfiles).map(([key, value]) => [key, value?.name ?? '']))
    )
  );
  const selectedProfile = useProfileStore(s =>
    selectedProfileId ? s.connectionProfiles[selectedProfileId] : undefined
  );
  const bucketListRef = useRef<BucketListViewRef>(null);
  const objectListRef = useRef<ObjectListViewRef>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isConnected = !!selectedProfile?.isConnected;
  const currentView = isConnected ? tabView : 'bucketList';
  const selectedItems = useTabListStore(s => s.tabList[tabId]?.selectionItem ?? EMPTY_SELECTION);
  const optionsData = useMemo(
    () =>
      Object.entries(profileNames).map(([key, name]) => ({
        name,
        value: key,
      })),
    [profileNames]
  );
  const hasDeletingSelected = useTabListStore(s => {
    const tab = s.tabList[tabId];
    return !!tab && tab.selectionItem.some(k => tab.deletingItems.includes(k));
  });

  const updateTab = useTabListStore(s => s.updateTab);
  const updateConnectionProfiles = useProfileStore(s => s.updateConnectionProfiles);
  const changeCurrentView = useTabListStore(s => s.changeCurrentView);
  const changePrefix = useTabListStore(s => s.changePrefix);
  const clearSelectItem = useTabListStore(s => s.clearSelectItem);

  const onClickConnect = useCallback(async () => {
    if (isNullOrEmpty(selectedProfileId)) return;

    const profile = selectedProfile;

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
  }, [selectedProfile, updateConnectionProfiles, selectedProfileId]);

  const onClickRefresh = useCallback(() => {
    if (currentView === 'objectList') {
      clearSelectItem(tabId);
      return objectListRef.current?.onRefresh?.();
    }
    return bucketListRef.current?.onRefresh?.();
  }, [currentView, clearSelectItem, tabId]);

  const onChangeSelectProfile = useCallback(
    (value: string | null) => {
      updateTab(tabId, { profileId: value, currentView: 'bucketList', prefix: '', selectionItem: [] });
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

  // Go up one folder; at the bucket root, go back to the bucket list.
  const onClickBack = useCallback(() => {
    if (!prefix) {
      changeCurrentView(tabId, 'bucketList');
      return;
    }
    // "a/b/" -> "a/", "a/" -> "". Only the last "/" is dropped, so "a//" -> "a/" keeps the empty-named folder.
    const parent = prefix.slice(0, -1);
    changePrefix(tabId, parent.slice(0, parent.lastIndexOf('/') + 1));
  }, [prefix, tabId, changeCurrentView, changePrefix]);

  // One crumb per folder in the prefix, each pointing to that folder's own prefix.
  const breadcrumbs = useMemo(() => {
    const parts = prefix ? prefix.slice(0, -1).split('/') : [];
    return parts.map((name, i) => ({ name: name || '/', prefix: parts.slice(0, i + 1).join('/') + '/' }));
  }, [prefix]);

  const onClickClearSelected = useCallback(() => {
    clearSelectItem(tabId);
  }, [clearSelectItem, tabId]);

  const onClickBreadcrumb = useCallback(
    (crumbPrefix: string) => {
      changePrefix(tabId, crumbPrefix);
    },
    [changePrefix, tabId]
  );

  const onClickDownloadSelected = useCallback(() => {
    return objectListRef.current?.onClickMenuButton?.(selectedItems, 'download');
  }, [selectedItems]);

  const onClickDeleteSelected = useCallback(async () => {
    return objectListRef.current?.onClickMenuButton?.(selectedItems, 'delete');
  }, [selectedItems]);

  const renderView = (
    <>
      <Stack gap="8px" display={currentView === 'bucketList' ? undefined : 'none'}>
        <BucketListView
          profile={isConnected ? selectedProfile : null}
          active={currentView === 'bucketList'}
          scrollRef={scrollRef}
          onSelectBucket={onChangeSelectBucket}
          ref={bucketListRef}
        />
      </Stack>
      {currentView === 'objectList' ? (
        <Stack gap="8px">
          <ObjectListView
            tabId={tabId}
            profile={isConnected ? selectedProfile : null}
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
        <Group gap="xs">
          <Combobox
            value={selectedProfileId}
            onChange={onChangeSelectProfile}
            data={optionsData}
            style={{ width: '200px' }}
          />

          <Tooltip label={t('tooltip.connect')}>
            <ActionIcon onClick={onClickConnect} disabled={isConnected || !selectedProfileId}>
              <PlugZap />
            </ActionIcon>
          </Tooltip>

          <Tooltip
            label={formatStringJson(t('tooltip.refresh'), {
              target: currentView === 'objectList' ? tObject('tooltip.objectList') : tBucket('tooltip.bucketList'),
            })}
          >
            <ActionIcon onClick={onClickRefresh} disabled={!isConnected}>
              <RefreshCw />
            </ActionIcon>
          </Tooltip>

          {currentView === 'objectList' ? (
            <>
              <Tooltip label={prefix ? tObject('tooltip.backToParent') : tObject('tooltip.backToBucket')}>
                <ActionIcon onClick={onClickBack}>
                  <ArrowLeft />
                </ActionIcon>
              </Tooltip>

              {selectedItems.length > 0 ? (
                <Group gap="xs" ml="auto">
                  <Tooltip label={tObject('tooltip.clearSelected')}>
                    <ActionIcon onClick={onClickClearSelected} disabled={hasDeletingSelected}>
                      <BroomSparkles />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label={tObject('tooltip.downloadSelected')}>
                    <ActionIcon onClick={onClickDownloadSelected} disabled={hasDeletingSelected}>
                      <Download />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label={tObject('tooltip.deleteSelected')}>
                    <ActionIcon onClick={onClickDeleteSelected} color="red">
                      <Trash />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              ) : null}
            </>
          ) : null}
        </Group>
      </Group>

      <Divider />

      {currentView === 'objectList' ? (
        <>
          <Group gap="xs" p="4px" style={{ flexShrink: 0 }}>
            <Breadcrumbs separatorMargin="4px" style={{ minWidth: 0, flexWrap: 'wrap' }}>
              {prefix ? (
                <Anchor onClick={() => onClickBreadcrumb('')}>{selectedBucket}</Anchor>
              ) : (
                <Text fw={500}>{selectedBucket}</Text>
              )}
              {breadcrumbs.map((crumb, i) =>
                i === breadcrumbs.length - 1 ? (
                  <Text key={crumb.prefix} fw={500}>
                    {crumb.name}
                  </Text>
                ) : (
                  <Anchor key={crumb.prefix} onClick={() => onClickBreadcrumb(crumb.prefix)}>
                    {crumb.name}
                  </Anchor>
                )
              )}
            </Breadcrumbs>
          </Group>

          <Divider />
        </>
      ) : null}

      {/* View */}
      <Paper
        ref={scrollRef}
        p="8px"
        className={classes.dropZone}
        data-file-drop-target={currentView === 'objectList' ? '' : undefined}
        data-tab-id={tabId}
        style={{ flex: 1, minHeight: 0, overflow: 'auto', position: 'relative' }}
      >
        <Stack gap="8px">{renderView}</Stack>
      </Paper>
    </Paper>
  );
}
export default memo(TabDetail);
