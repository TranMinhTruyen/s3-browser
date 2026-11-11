import { Group } from '@mantine/core';
import { ArrowLeft, BroomSparkles, Download, FolderPlus, PlugZap, RefreshCw, Trash, Upload } from 'lucide-react';
import { memo, RefObject, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { tintedColor } from '@/common/theme/tintedColor';
import { formatStringJson } from '@/common/utils/stringUtils';
import ActionIcon from '@/components/buttons/ActionIcon';
import Combobox from '@/components/inputs/combobox/Combobox';
import SearchInput from '@/components/inputs/SearchInput';
import type { ObjectListViewRef } from '@/pages/s3/object/ObjectListView';
import { useTabListStore } from '@/pages/s3/stores/tabListStore';

// Stable fallback so the selector does not return a new array on every call.
const EMPTY_SELECTION: Record<string, true> = {};

type TabActionBarProps = {
  tabId: string;
  currentView: 'bucketList' | 'objectList';
  isConnected: boolean;
  // An anonymous connection cannot create buckets, so the button is hidden.
  isAnonymous: boolean;
  selectedProfileId: string | null;
  profileOptions: { name: string; value: string }[];
  prefix: string;
  keyword: string;
  // Changes with the list context; remounts the search input so its text resets.
  searchContext: string;
  objectListRef: RefObject<ObjectListViewRef | null>;
  onChangeSelectProfile: (value: string | null) => void;
  onClickConnect: () => void;
  onClickRefresh: () => void;
  onSearch: (value: string) => void;
  onClearSearch: () => void;
  onClickUpload: () => void;
  onClickCreateBucket: () => void;
  onClickBack: () => void;
};

/** Toolbar of a tab: profile picker, connect, refresh, search, upload, back and the selection actions. */
function TabActionBar(props: TabActionBarProps) {
  const {
    tabId,
    currentView,
    isConnected,
    isAnonymous,
    selectedProfileId,
    profileOptions,
    prefix,
    keyword,
    searchContext,
    objectListRef,
    onChangeSelectProfile,
    onClickConnect,
    onClickRefresh,
    onSearch,
    onClearSearch,
    onClickUpload,
    onClickCreateBucket,
    onClickBack,
  } = props;

  const { t } = useTranslation('tabLayout');
  const { t: tBucket } = useTranslation('bucket', { keyPrefix: 'page' });
  const { t: tObject } = useTranslation('object', { keyPrefix: 'page' });

  const selection = useTabListStore(s => s.tabList[tabId]?.selectionItem ?? EMPTY_SELECTION);
  const selectedItems = useMemo(() => Object.keys(selection), [selection]);
  const hasDeletingSelected = useTabListStore(s => {
    const tab = s.tabList[tabId];
    return !!tab && Object.keys(tab.selectionItem).some(k => tab.deletingItems[k] === true);
  });
  const clearSelectItem = useTabListStore(s => s.clearSelectItem);

  const refreshLabel = formatStringJson(t('tooltip.refresh'), {
    target: currentView === 'objectList' ? tObject('tooltip.objectList') : tBucket('tooltip.bucketList'),
  });
  const backLabel = prefix ? tObject('tooltip.backToParent') : tObject('tooltip.backToBucket');

  const onClickClearSelected = useCallback(() => {
    clearSelectItem(tabId);
  }, [clearSelectItem, tabId]);

  const onClickDownloadSelected = useCallback(() => {
    return objectListRef.current?.onClickMenuButton?.(selectedItems, 'download');
  }, [objectListRef, selectedItems]);

  const onClickDeleteSelected = useCallback(() => {
    return objectListRef.current?.onClickMenuButton?.(selectedItems, 'delete');
  }, [objectListRef, selectedItems]);

  return (
    <Group gap="xs" p="4px" style={{ flexShrink: 0 }}>
      <Group gap="xs">
        <Combobox
          value={selectedProfileId}
          onChange={onChangeSelectProfile}
          data={profileOptions}
          searchPlaceholder={t('search.placeholderProfile')}
          emptyText={t('search.emptyProfile')}
          style={{ width: '200px' }}
        />

        <ActionIcon
          onClick={onClickConnect}
          tooltip={t('tooltip.connect')}
          disabled={isConnected || !selectedProfileId}
        >
          <PlugZap />
        </ActionIcon>

        <ActionIcon onClick={onClickRefresh} tooltip={refreshLabel} disabled={!isConnected}>
          <RefreshCw />
        </ActionIcon>

        <SearchInput
          key={searchContext}
          value={keyword}
          placeholder={currentView === 'objectList' ? t('search.placeholderObject') : t('search.placeholderBucket')}
          searchLabel={t('tooltip.search')}
          clearLabel={t('tooltip.clearSearch')}
          disabled={!isConnected}
          onSearch={onSearch}
          onClear={onClearSearch}
        />

        <ActionIcon onClick={onClickUpload} tooltip={t('tooltip.upload')} disabled={!isConnected}>
          <Upload />
        </ActionIcon>

        {currentView === 'bucketList' && !isAnonymous ? (
          <ActionIcon onClick={onClickCreateBucket} tooltip={t('tooltip.createBucket')} disabled={!isConnected}>
            <FolderPlus />
          </ActionIcon>
        ) : null}

        {currentView === 'objectList' ? (
          <>
            <ActionIcon onClick={onClickBack} tooltip={backLabel}>
              <ArrowLeft />
            </ActionIcon>

            {selectedItems.length > 0 ? (
              <Group gap="xs" ml="auto">
                <ActionIcon
                  onClick={onClickClearSelected}
                  tooltip={tObject('tooltip.clearSelected')}
                  disabled={hasDeletingSelected}
                >
                  <BroomSparkles />
                </ActionIcon>
                <ActionIcon
                  onClick={onClickDownloadSelected}
                  tooltip={tObject('tooltip.downloadSelected')}
                  disabled={hasDeletingSelected}
                >
                  <Download />
                </ActionIcon>
                <ActionIcon
                  onClick={onClickDeleteSelected}
                  tooltip={tObject('tooltip.deleteSelected')}
                  {...tintedColor('red', 'ai')}
                >
                  <Trash />
                </ActionIcon>
              </Group>
            ) : null}
          </>
        ) : null}
      </Group>
    </Group>
  );
}
export default memo(TabActionBar);
