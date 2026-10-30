import { Divider, Group, Paper, Stack } from '@mantine/core';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useConnectProfile } from '@/common/hooks/useConnectProfile';
import { useProfileStore } from '@/common/stores/profileStore';
import { useTabListStore } from '@/common/stores/tabListStore';
import { needsManualInput } from '@/common/utils/authUtils';
import { isNullOrEmpty } from '@/common/utils/stringUtils';
import { ensureUploadIdle, runUpload } from '@/common/utils/uploadUtils';
import ObjectDetailDrawer from '@/components/layouts/tab/components/ObjectDetailDrawer';
import TabActionBar from '@/components/layouts/tab/components/TabActionBar';
import TabBreadcrumb from '@/components/layouts/tab/components/TabBreadcrumb';
import { showConnectModal, showUploadPickerModal } from '@/components/modals/lazyModals';
import BucketListView, { BucketListViewRef } from '@/pages/bucket/BucketListView';
import ObjectListView, { ObjectListViewRef } from '@/pages/object/ObjectListView';
import classes from '@/pages/object/page.module.css';

type TabDetailProps = {
  tabId: string;
};

/** Content of one tab: toolbar, breadcrumb, the bucket or object list and the object detail drawer. */
function TabDetail(props: TabDetailProps) {
  const { tabId } = props;

  const selectedProfileId = useTabListStore(s => s.tabList[tabId]?.profileId ?? null);
  const tabView = useTabListStore(s => s.tabList[tabId]?.currentView ?? 'bucketList');
  const selectedBucket = useTabListStore(s => s.tabList[tabId]?.bucket);
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
  const hasDetail = useTabListStore(s => !!s.tabList[tabId]?.detailItem);
  const bucketListRef = useRef<BucketListViewRef>(null);
  const objectListRef = useRef<ObjectListViewRef>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isConnected = !!selectedProfile?.isConnected;
  const currentView = isConnected ? tabView : 'bucketList';
  const optionsData = useMemo(
    () =>
      Object.entries(profileNames).map(([key, name]) => ({
        name,
        value: key,
      })),
    [profileNames]
  );
  const updateTab = useTabListStore(s => s.updateTab);
  const connectProfile = useConnectProfile();
  const changeCurrentView = useTabListStore(s => s.changeCurrentView);
  const changePrefix = useTabListStore(s => s.changePrefix);
  const clearSelectItem = useTabListStore(s => s.clearSelectItem);

  const onClickConnect = useCallback(async () => {
    if (isNullOrEmpty(selectedProfileId)) return;

    const profile = selectedProfile;

    if (!profile || profile.isConnected) return;
    if (needsManualInput(profile)) {
      showConnectModal({
        mode: 'manualconnect',
        connectionProfile: { ...profile },
      });
      return;
    }

    await connectProfile(selectedProfileId, profile);
  }, [selectedProfile, connectProfile, selectedProfileId]);

  // The keyword only lives in the context (profile, bucket, folder, view) it was entered in. When the context
  // changes it is dropped during render (before commit), so the list loads once and a later return to the
  // same context starts without a keyword.
  const searchContext = `${selectedProfileId}|${selectedBucket}|${prefix}|${currentView}`;
  const [search, setSearch] = useState({ keyword: '', context: searchContext });
  if (search.context !== searchContext) setSearch({ keyword: '', context: searchContext });
  const keyword = search.context === searchContext ? search.keyword : '';

  const onSearch = useCallback(
    (value: string) => {
      // Only the object list has a selection.
      if (currentView === 'objectList') clearSelectItem(tabId);
      // Same keyword: state would not change, so search again from the first page through the refresh path.
      if (value === keyword) {
        (currentView === 'objectList' ? objectListRef : bucketListRef).current?.onRefresh?.();
        return;
      }
      setSearch({ keyword: value, context: searchContext });
    },
    [currentView, clearSelectItem, tabId, searchContext, keyword]
  );

  const onClearSearch = useCallback(() => {
    // Selected files may not be in the unfiltered list's view anymore; skip when there is nothing to clear.
    if (!keyword) return;
    if (currentView === 'objectList') clearSelectItem(tabId);
    setSearch({ keyword: '', context: searchContext });
  }, [keyword, currentView, clearSelectItem, tabId, searchContext]);

  const onClickRefresh = useCallback(() => {
    if (currentView === 'objectList') {
      clearSelectItem(tabId);
      return objectListRef.current?.onRefresh?.();
    }
    return bucketListRef.current?.onRefresh?.();
  }, [currentView, clearSelectItem, tabId]);

  const onChangeSelectProfile = useCallback(
    (value: string | null) => {
      updateTab(tabId, {
        profileId: value,
        currentView: 'bucketList',
        bucket: undefined,
        prefix: '',
        selectionItem: [],
      });
    },
    [tabId, updateTab]
  );

  const onChangeSelectBucket = useCallback(
    (bucketName: string | undefined) => {
      if (bucketName) {
        changeCurrentView(tabId, 'objectList', bucketName);
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

  // Opens the file picker, then uploads the ticked files: into the current folder in the object list, or into the
  // bucket chosen in the picker (at its root) in the bucket list.
  const onClickUpload = useCallback(async () => {
    if (!selectedProfile?.id || !ensureUploadIdle()) return;
    const connectionId = selectedProfile.id;
    const profileName = selectedProfile.name;
    const inBucket = currentView === 'objectList' && !!selectedBucket;
    const uploadPrefix = inBucket ? prefix : '';
    // undefined: the modal chunk failed to load (already toasted) or the user cancelled; either way nothing to upload.
    const picked = await showUploadPickerModal({
      tabId,
      connectionId,
      profileName,
      bucket: inBucket ? selectedBucket : undefined,
      prefix: uploadPrefix,
    });
    if (!picked || picked.files.length === 0) return;

    await runUpload(
      { tabId, connectionId, profileName, bucket: picked.bucket, prefix: uploadPrefix, files: picked.files },
      async () => {
        // The user may have moved on while uploading: refresh only the list the files went to.
        const tab = useTabListStore.getState().tabList[tabId];
        if (tab?.currentView === 'objectList' && tab.bucket === picked.bucket && tab.prefix === uploadPrefix) {
          await objectListRef.current?.onRefresh?.();
        }
      }
    );
  }, [selectedProfile, currentView, selectedBucket, prefix, tabId]);

  const viewContent = (
    <>
      <Stack gap="8px" display={currentView === 'bucketList' ? undefined : 'none'}>
        <BucketListView
          profile={isConnected ? selectedProfile : null}
          active={currentView === 'bucketList'}
          scrollRef={scrollRef}
          keyword={currentView === 'bucketList' ? keyword : ''}
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
            keyword={keyword}
            ref={objectListRef}
          />
        </Stack>
      ) : null}
    </>
  );

  return (
    <Paper withBorder h="100%" display="flex" style={{ flexDirection: 'column', overflow: 'hidden' }}>
      <TabActionBar
        tabId={tabId}
        currentView={currentView}
        isConnected={isConnected}
        selectedProfileId={selectedProfileId}
        profileOptions={optionsData}
        prefix={prefix}
        keyword={keyword}
        searchContext={searchContext}
        objectListRef={objectListRef}
        onChangeSelectProfile={onChangeSelectProfile}
        onClickConnect={onClickConnect}
        onClickRefresh={onClickRefresh}
        onSearch={onSearch}
        onClearSearch={onClearSearch}
        onClickUpload={onClickUpload}
        onClickBack={onClickBack}
      />

      <Divider />

      {currentView === 'objectList' ? (
        <>
          <TabBreadcrumb tabId={tabId} bucket={selectedBucket} prefix={prefix} />
          <Divider />
        </>
      ) : null}

      {/* View: the list scrolls on its own, the detail drawer is a fixed sibling on the right of the tab */}
      <Group gap={0} wrap="nowrap" align="stretch" style={{ flex: 1, minHeight: 0 }}>
        <Paper
          ref={scrollRef}
          p="8px"
          className={classes.dropZone}
          data-file-drop-target={currentView === 'objectList' ? '' : undefined}
          data-tab-id={tabId}
          style={{ flex: 1, minWidth: 0, overflow: 'auto', position: 'relative' }}
        >
          <Stack gap="8px">{viewContent}</Stack>
        </Paper>
        {currentView === 'objectList' && hasDetail && selectedProfile?.id && selectedBucket ? (
          <ObjectDetailDrawer
            tabId={tabId}
            connectionId={selectedProfile.id}
            profileName={selectedProfile.name}
            bucket={selectedBucket}
          />
        ) : null}
      </Group>
    </Paper>
  );
}
export default memo(TabDetail);
