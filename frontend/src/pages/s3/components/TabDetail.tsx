import { Divider, Group, Paper, Stack } from '@mantine/core';
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { isNullOrEmpty } from '@/common/utils/stringUtils';
import {
  showBucketPolicyModal,
  showConnectModal,
  showCreateBucketModal,
  showDeleteBucketModal,
  showUploadPickerModal,
} from '@/components/modals/lazyModals';
import BucketListView, { BucketListViewRef } from '@/pages/s3/bucket/BucketListView';
import BucketDetailDrawer from '@/pages/s3/components/BucketDetailDrawer';
import ObjectDetailDrawer from '@/pages/s3/components/ObjectDetailDrawer';
import TabActionBar from '@/pages/s3/components/TabActionBar';
import TabBreadcrumb from '@/pages/s3/components/TabBreadcrumb';
import { useConnectProfile } from '@/pages/s3/hooks/useConnectProfile';
import ObjectListView, { ObjectListViewRef } from '@/pages/s3/object/ObjectListView';
import classes from '@/pages/s3/object/page.module.css';
import { useProfileStore } from '@/pages/s3/stores/profileStore';
import { useTabListStore } from '@/pages/s3/stores/tabListStore';
import { isAnonymous, needsManualInput } from '@/pages/s3/utils/authUtils';
import { ensureUploadIdle, runUpload } from '@/pages/s3/utils/uploadUtils';

type TabDetailProps = {
  tabId: string;
};

/** Nội dung của một tab: thanh công cụ, đường dẫn, danh sách bucket hoặc đối tượng và ngăn chi tiết. */
function TabDetail(props: TabDetailProps) {
  const { tabId } = props;

  const selectedProfileId = useTabListStore(s => s.tabList[tabId]?.profileId ?? null);
  const tabView = useTabListStore(s => s.tabList[tabId]?.currentView ?? 'bucketList');
  const selectedBucket = useTabListStore(s => s.tabList[tabId]?.bucket);
  const prefix = useTabListStore(s => s.tabList[tabId]?.prefix ?? '');
  // Chỉ ánh xạ id -> tên, để thay đổi profile mà vẫn giữ nguyên tên không khiến mọi tab render lại.
  const profileNames = useProfileStore(
    useShallow(s =>
      Object.fromEntries(Object.entries(s.connectionProfiles).map(([key, value]) => [key, value?.name ?? '']))
    )
  );
  const selectedProfile = useProfileStore(s =>
    selectedProfileId ? s.connectionProfiles[selectedProfileId] : undefined
  );
  const hasDetail = useTabListStore(s => !!s.tabList[tabId]?.detailItem);
  const hasBucketDetail = useTabListStore(s => !!s.tabList[tabId]?.detailBucket);
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
  const removeBucket = useTabListStore(s => s.removeBucket);
  const setBucketDetailPolicyMode = useTabListStore(s => s.setBucketDetailPolicyMode);

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

  // Từ khóa chỉ thuộc ngữ cảnh (profile, bucket, thư mục, view) nơi nó được nhập. Khi ngữ cảnh thay đổi,
  // từ khóa được xóa ngay trong lúc render (trước khi commit), nên danh sách chỉ tải một lần và lần sau
  // quay lại cùng ngữ cảnh sẽ không còn từ khóa đó.
  const searchContext = `${selectedProfileId}|${selectedBucket}|${prefix}|${currentView}`;
  const [search, setSearch] = useState({ keyword: '', context: searchContext });
  if (search.context !== searchContext) setSearch({ keyword: '', context: searchContext });
  const keyword = search.context === searchContext ? search.keyword : '';

  const onSearch = useCallback(
    (value: string) => {
      // Chỉ danh sách đối tượng có lựa chọn.
      if (currentView === 'objectList') clearSelectItem(tabId);
      // Từ khóa không đổi nên state cũng không đổi; tìm lại từ trang đầu thông qua luồng làm mới.
      if (value === keyword) {
        (currentView === 'objectList' ? objectListRef : bucketListRef).current?.onRefresh?.();
        return;
      }
      setSearch({ keyword: value, context: searchContext });
    },
    [currentView, clearSelectItem, tabId, searchContext, keyword]
  );

  const onClearSearch = useCallback(() => {
    // Các file đã chọn có thể không còn trong danh sách chưa lọc; bỏ qua nếu không có lựa chọn nào cần xóa.
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
        selectionItem: {},
        detailBucket: undefined,
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

  // Lùi lên một thư mục; nếu đang ở gốc bucket thì quay lại danh sách bucket.
  const onClickBack = useCallback(() => {
    if (!prefix) {
      changeCurrentView(tabId, 'bucketList');
      return;
    }
    // "a/b/" -> "a/", "a/" -> "". Chỉ bỏ dấu "/" cuối cùng, nên "a//" -> "a/" vẫn giữ thư mục có tên rỗng.
    const parent = prefix.slice(0, -1);
    changePrefix(tabId, parent.slice(0, parent.lastIndexOf('/') + 1));
  }, [prefix, tabId, changeCurrentView, changePrefix]);

  // Mở hộp chọn file rồi tải các file đã đánh dấu lên: vào thư mục hiện tại nếu đang xem danh sách đối tượng,
  // hoặc vào bucket được chọn trong hộp thoại (tại thư mục gốc) nếu đang xem danh sách bucket.
  const onClickUpload = useCallback(async () => {
    if (!selectedProfile?.id || !ensureUploadIdle()) return;
    const connectionId = selectedProfile.id;
    const profileName = selectedProfile.name;
    const inBucket = currentView === 'objectList' && !!selectedBucket;
    const uploadPrefix = inBucket ? prefix : '';
    // undefined nghĩa là không tải được phần modal (đã hiện thông báo) hoặc người dùng đã hủy; cả hai đều không tải gì.
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
        // Người dùng có thể đã chuyển sang nơi khác trong lúc tải; chỉ làm mới danh sách nhận các file đó.
        const tab = useTabListStore.getState().tabList[tabId];
        if (tab?.currentView === 'objectList' && tab.bucket === picked.bucket && tab.prefix === uploadPrefix) {
          await objectListRef.current?.onRefresh?.();
        }
      }
    );
  }, [selectedProfile, currentView, selectedBucket, prefix, tabId]);

  const onClickCreateBucket = useCallback(async () => {
    if (!selectedProfile?.id) return;
    // Chỉ AWS thật (không dùng endpoint tùy chỉnh) mới cho phép chọn region của bucket mới.
    const withRegion = selectedProfile.provider === 'aws' && !selectedProfile.endpoint;
    const created = await showCreateBucketModal({
      connectionId: selectedProfile.id,
      profileName: selectedProfile.name,
      withRegion,
      defaultRegion: withRegion ? selectedProfile.region : undefined,
    });
    if (created) await bucketListRef.current?.onRefresh?.();
  }, [selectedProfile]);

  const onEditBucketPolicy = useCallback(
    (bucket: string | undefined) => {
      if (!selectedProfile?.id || !bucket) return;
      return showBucketPolicyModal({
        connectionId: selectedProfile.id,
        profileName: selectedProfile.name,
        bucket,
        onSaved: mode => {
          bucketListRef.current?.setPolicyMode?.(bucket, mode);
          setBucketDetailPolicyMode(tabId, bucket, mode);
        },
      });
    },
    [selectedProfile, tabId, setBucketDetailPolicyMode]
  );

  const onDeleteBucket = useCallback(
    async (bucket: string | undefined) => {
      if (!selectedProfile?.id || !bucket) return;
      const result = await showDeleteBucketModal({
        connectionId: selectedProfile.id,
        profileName: selectedProfile.name,
        bucket,
      });
      if (!result) return;
      if (result.bucketDeleted) removeBucket(selectedProfile.id, bucket);
      // Chỉ làm mới danh sách của tab này; các tab khác vẫn hiện bucket cho đến khi được làm mới.
      await bucketListRef.current?.onRefresh?.();
    },
    [selectedProfile, removeBucket]
  );

  // Activity ẩn tab bằng display none khiến vị trí cuộn bị đặt lại: lưu khi ẩn và khôi phục khi hiện.
  const savedScrollTop = useRef(0);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && savedScrollTop.current) el.scrollTop = savedScrollTop.current;
    return () => {
      if (el) savedScrollTop.current = el.scrollTop;
    };
  }, []);

  const viewContent = (
    <>
      <Stack gap="0.5rem" display={currentView === 'bucketList' ? undefined : 'none'}>
        <BucketListView
          tabId={tabId}
          profile={isConnected ? selectedProfile : null}
          active={currentView === 'bucketList'}
          scrollRef={scrollRef}
          keyword={currentView === 'bucketList' ? keyword : ''}
          onSelectBucket={onChangeSelectBucket}
          onEditPolicy={onEditBucketPolicy}
          onDeleteBucket={onDeleteBucket}
          ref={bucketListRef}
        />
      </Stack>
      {currentView === 'objectList' ? (
        <Stack gap="0.5rem">
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
        isAnonymous={!!selectedProfile && isAnonymous(selectedProfile)}
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
        onClickCreateBucket={onClickCreateBucket}
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
          p="0.5rem"
          className={classes.dropZone}
          data-file-drop-target={currentView === 'objectList' ? '' : undefined}
          data-tab-id={tabId}
          style={{ flex: 1, minWidth: 0, overflow: 'auto', position: 'relative' }}
        >
          <Stack gap="0.5rem">{viewContent}</Stack>
        </Paper>
        {currentView === 'objectList' && hasDetail && selectedProfile?.id && selectedBucket ? (
          <ObjectDetailDrawer
            tabId={tabId}
            connectionId={selectedProfile.id}
            profileName={selectedProfile.name}
            bucket={selectedBucket}
          />
        ) : null}
        {currentView === 'bucketList' && hasBucketDetail && selectedProfile?.id ? (
          <BucketDetailDrawer tabId={tabId} connectionId={selectedProfile.id} profileName={selectedProfile.name} />
        ) : null}
      </Group>
    </Paper>
  );
}
export default memo(TabDetail);
