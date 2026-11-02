import { Group, Tooltip } from '@mantine/core';
import { ArrowLeft, BroomSparkles, Download, PlugZap, RefreshCw, Trash, Upload } from 'lucide-react';
import { memo, RefObject, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useTabListStore } from '@/common/stores/tabListStore';
import { tintedColor } from '@/common/theme/tintedColor';
import { formatStringJson } from '@/common/utils/stringUtils';
import ActionIcon from '@/components/buttons/ActionIcon';
import Combobox from '@/components/inputs/combobox/Combobox';
import SearchInput from '@/components/inputs/SearchInput';
import type { ObjectListViewRef } from '@/pages/object/ObjectListView';

// Stable fallback so the selector does not return a new array on every call.
const EMPTY_SELECTION: string[] = [];

type TabActionBarProps = {
  tabId: string;
  currentView: 'bucketList' | 'objectList';
  isConnected: boolean;
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
  onClickBack: () => void;
};

/** Toolbar of a tab: profile picker, connect, refresh, search, upload, back and the selection actions. */
function TabActionBar(props: TabActionBarProps) {
  const {
    tabId,
    currentView,
    isConnected,
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
    onClickBack,
  } = props;

  const { t } = useTranslation('tabLayout');
  const { t: tBucket } = useTranslation('bucket', { keyPrefix: 'page' });
  const { t: tObject } = useTranslation('object', { keyPrefix: 'page' });

  const selectedItems = useTabListStore(s => s.tabList[tabId]?.selectionItem ?? EMPTY_SELECTION);
  const hasDeletingSelected = useTabListStore(s => {
    const tab = s.tabList[tabId];
    return !!tab && tab.selectionItem.some(k => tab.deletingItems.includes(k));
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

        <Tooltip label={t('tooltip.connect')}>
          <ActionIcon
            onClick={onClickConnect}
            aria-label={t('tooltip.connect')}
            disabled={isConnected || !selectedProfileId}
          >
            <PlugZap />
          </ActionIcon>
        </Tooltip>

        <Tooltip label={refreshLabel}>
          <ActionIcon onClick={onClickRefresh} aria-label={refreshLabel} disabled={!isConnected}>
            <RefreshCw />
          </ActionIcon>
        </Tooltip>

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

        <Tooltip label={t('tooltip.upload')}>
          <ActionIcon onClick={onClickUpload} aria-label={t('tooltip.upload')} disabled={!isConnected}>
            <Upload />
          </ActionIcon>
        </Tooltip>

        {currentView === 'objectList' ? (
          <>
            <Tooltip label={backLabel}>
              <ActionIcon onClick={onClickBack} aria-label={backLabel}>
                <ArrowLeft />
              </ActionIcon>
            </Tooltip>

            {selectedItems.length > 0 ? (
              <Group gap="xs" ml="auto">
                <Tooltip label={tObject('tooltip.clearSelected')}>
                  <ActionIcon
                    onClick={onClickClearSelected}
                    aria-label={tObject('tooltip.clearSelected')}
                    disabled={hasDeletingSelected}
                  >
                    <BroomSparkles />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label={tObject('tooltip.downloadSelected')}>
                  <ActionIcon
                    onClick={onClickDownloadSelected}
                    aria-label={tObject('tooltip.downloadSelected')}
                    disabled={hasDeletingSelected}
                  >
                    <Download />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label={tObject('tooltip.deleteSelected')}>
                  <ActionIcon
                    onClick={onClickDeleteSelected}
                    aria-label={tObject('tooltip.deleteSelected')}
                    {...tintedColor('red', 'ai')}
                  >
                    <Trash />
                  </ActionIcon>
                </Tooltip>
              </Group>
            ) : null}
          </>
        ) : null}
      </Group>
    </Group>
  );
}
export default memo(TabActionBar);
