import { Center, Loader, Text } from '@mantine/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { DeleteObject, DeletePrefix, DownloadObject } from '@wails/S3Browser/internal/handlers/buckethandler';
import { ConnectionProfileOutput } from '@wails/S3Browser/models';
import { ObjectItem as ObjectItemData } from '@wails/S3Browser/models/bucket';
import {
  Ref,
  RefObject,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { LIST_ROW_GAP, LIST_ROW_HEIGHT } from '@/common/cnst/commonConst';
import { useFilesDroppedUpload } from '@/common/hooks/useFilesDroppedUpload';
import { useObjectPaging } from '@/common/hooks/useObjectPaging';
import { useTabListStore } from '@/common/stores/tabListStore';
import { callIPC } from '@/common/utils/ipcUtils';
import { onTabGone } from '@/common/utils/tabUtils';
import Button from '@/components/buttons/Button';
import ConfirmModal from '@/components/modals/confirm/ConfirmModal';
import { showDeleteConfirmModal, showDeleteResultModal } from '@/components/modals/lazyModals';
import ObjectItem, { ObjectItemLabels } from '@/pages/object/ObjectItem';

// Download is refused above this many objects at once (delete has no limit).
const MAX_DOWNLOAD_OBJECTS = 5;
// Load the next page once this many screens of rows are left below the viewport (at least PREFETCH_MIN_ROWS rows).
const PREFETCH_SCREENS = 2;
const PREFETCH_MIN_ROWS = 2;

export type ObjectListViewRef = {
  onRefresh?: () => Promise<void>;
  onClickMenuButton?: (object: string[], action: 'download' | 'delete') => Promise<void>;
};

type ObjectListViewProps = {
  tabId: string;
  bucket?: string;
  profile?: ConnectionProfileOutput | null;
  scrollRef: RefObject<HTMLElement | null>;
  // Applied search keyword; empty means the normal lazy-loaded list.
  keyword?: string;
  ref?: Ref<ObjectListViewRef>;
};

/** Virtualized, lazily paged list of the objects (or search results) of the current folder. */
function ObjectListView(props: ObjectListViewProps) {
  const { tabId, bucket, profile, scrollRef, keyword = '', ref } = props;

  const { t } = useTranslation('object', { keyPrefix: 'page' });

  // Rows get their texts from here, so they do not subscribe to i18n themselves.
  const labels = useMemo<ObjectItemLabels>(
    () => ({
      moreActions: t('tooltip.moreActions'),
      download: t('action.download'),
      delete: t('action.delete'),
    }),
    [t]
  );

  const [scrollMargin, setScrollMargin] = useState(0);

  const connectionId = profile?.id;
  const profileName = profile?.name;
  const listRef = useRef<HTMLDivElement>(null);

  const prefix = useTabListStore(s => s.tabList[tabId]?.prefix ?? '');
  const listKey = `${connectionId}|${bucket}|${prefix}|${keyword}`;
  const {
    objectDatas,
    nextCursor,
    cursorKey,
    isLoadingFirst,
    isLoadingMore,
    isLoaded,
    loadMoreError,
    loadNextPage,
    onRefresh,
    onClickLoadMore,
  } = useObjectPaging({ tabId, connectionId, profileName, bucket, prefix, keyword, listKey, scrollRef });
  // Read at click time, so the menu handler keeps its identity when pages load.
  const objectDatasRef = useRef(objectDatas);
  objectDatasRef.current = objectDatas;
  const changePrefix = useTabListStore(s => s.changePrefix);
  const addSelectItem = useTabListStore(s => s.addSelectItem);
  const removeSelectItem = useTabListStore(s => s.removeSelectItem);
  const clearSelectItem = useTabListStore(s => s.clearSelectItem);
  const openDetail = useTabListStore(s => s.openDetail);
  const closeDetail = useTabListStore(s => s.closeDetail);
  const setDeleting = useTabListStore(s => s.setDeleting);

  // Closes the drawer when the object it shows is one of the deleted keys or inside a deleted folder.
  const closeDetailIfDeleted = useCallback(
    (deletedKeys: string[]) => {
      const detailKey = useTabListStore.getState().tabList[tabId]?.detailItem?.key;
      if (detailKey && deletedKeys.some(key => (key.endsWith('/') ? detailKey.startsWith(key) : detailKey === key))) {
        closeDetail(tabId);
      }
    },
    [closeDetail, tabId]
  );

  // The selection does not outlive the view, but survives the tab being hidden (Activity).
  useEffect(() => onTabGone(tabId, () => clearSelectItem(tabId)), [clearSelectItem, tabId]);

  const onClickMenuButton = useCallback(
    async (keys: string[], action: 'download' | 'delete') => {
      if (!connectionId || !bucket) return;
      // Folder keys end with "/". Downloading one fails, and deleting one would remove only
      // the folder marker, not the files in it, so they are never sent.
      const objects = keys.filter(key => !key.endsWith('/'));
      if (objects.length === 0) return;
      if (action === 'download' && objects.length > MAX_DOWNLOAD_OBJECTS) {
        ConfirmModal.show({
          type: 'warning',
          confirmCode: 'C000005',
        });
        return;
      }
      switch (action) {
        case 'download':
          await callIPC(DownloadObject, [{ connectionId: connectionId, profileName, bucket, objects }]);
          break;
        case 'delete': {
          // Sizes are looked up only for the picked keys, from the list as it is now.
          const selectedKeys = new Set(objects);
          const sizes = new Map<string, number>();
          for (const o of objectDatasRef.current) if (selectedKeys.has(o.key)) sizes.set(o.key, o.size);
          const toDelete = await showDeleteConfirmModal({
            files: objects.map(key => ({ key, size: sizes.get(key) ?? 0 })),
          });
          // Canceled, or every file unticked.
          if (toDelete?.length) {
            setDeleting(tabId, toDelete, true);
            try {
              const body = await callIPC(DeleteObject, [{ connectionId, profileName, bucket, objects: toDelete }]);
              if (body) {
                closeDetailIfDeleted(body.deleted ?? []);
                // Opened before the refresh, so a failing refresh cannot hide the result. Not awaited: the
                // selection is cleared and the list is usable while the dialog is open.
                void showDeleteResultModal({
                  deleted: body.deleted?.length ?? 0,
                  failed: body.failed?.length ?? 0,
                  deletedKeys: body.deleted ?? [],
                  failures: body.failed ?? [],
                });
              }
              await onRefresh();
            } finally {
              setDeleting(tabId, toDelete, false);
            }
          }
          break;
        }
      }
      clearSelectItem(tabId);
    },
    [bucket, profileName, connectionId, onRefresh, setDeleting, tabId, clearSelectItem, closeDetailIfDeleted]
  );

  const onClickDeleteFolder = useCallback(
    async (folderKey: string, name: string) => {
      if (!connectionId || !bucket) return;
      // Already being deleted: ignore a repeated click.
      if (useTabListStore.getState().tabList[tabId]?.deletingItems[folderKey] === true) return;
      const confirmed = await ConfirmModal.show({
        type: 'warning',
        confirmCode: 'C000006',
        params: {
          object: name || folderKey,
        },
        size: 'md',
      });
      if (!confirmed) return;
      setDeleting(tabId, [folderKey], true);
      try {
        const body = await callIPC(DeletePrefix, [{ connectionId, profileName, bucket, prefix: folderKey }]);
        // Keep the drawer on failure (even a partial one); the object it shows may still exist.
        if (body?.failed === 0) closeDetailIfDeleted([folderKey]);
        // Opened before the refresh, so a failing refresh cannot hide the result.
        if (body)
          void showDeleteResultModal({ deleted: body.deleted, failed: body.failed, failures: body.failures ?? [] });
        // Refresh even on failure or cancel: part of the folder may already be deleted.
        await onRefresh();
      } finally {
        setDeleting(tabId, [folderKey], false);
      }
    },
    [bucket, profileName, connectionId, onRefresh, setDeleting, tabId, closeDetailIfDeleted]
  );

  const onToggleSelect = useCallback(
    (key: string, checked: boolean) => {
      if (checked) {
        addSelectItem(tabId, [key]);
      } else removeSelectItem(tabId, [key]);
    },
    [tabId, addSelectItem, removeSelectItem]
  );

  const onOpenDetail = useCallback((item: ObjectItemData) => openDetail(tabId, item), [openDetail, tabId]);

  const onOpenFolder = useCallback((folder: string) => changePrefix(tabId, folder), [changePrefix, tabId]);

  useFilesDroppedUpload({ tabId, connectionId, profileName, bucket, prefix, onRefresh });

  useImperativeHandle(
    ref,
    () => ({
      onRefresh,
      onClickMenuButton,
    }),
    [onClickMenuButton, onRefresh]
  );

  const objectList = connectionId ? objectDatas : [];

  // The list sits below the scroll container's padding, so the virtualizer needs that offset.
  useLayoutEffect(() => {
    setScrollMargin(listRef.current?.offsetTop ?? 0);
  }, []);

  // React Compiler is disabled, so this compiler-only lint does not apply.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: objectList.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => LIST_ROW_HEIGHT,
    getItemKey: idx => objectList[idx].key,
    gap: LIST_ROW_GAP,
    overscan: 5,
    scrollMargin,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const lastVisibleIndex = virtualizer.range?.endIndex ?? -1;
  const prefetchRows = Math.max(
    PREFETCH_MIN_ROWS,
    Math.ceil((PREFETCH_SCREENS * (virtualizer.scrollRect?.height ?? 0)) / (LIST_ROW_HEIGHT + LIST_ROW_GAP))
  );

  useEffect(() => {
    // After a failed page, wait for Refresh instead of retrying in a loop.
    if (!nextCursor || isLoadingMore || loadMoreError || cursorKey !== listKey) return;
    // An empty search has nothing to scroll: the user continues it with the "load more" button.
    if (keyword && objectList.length === 0) return;
    if (lastVisibleIndex >= objectList.length - 1 - prefetchRows) {
      loadNextPage();
    }
  }, [
    lastVisibleIndex,
    prefetchRows,
    objectList.length,
    nextCursor,
    isLoadingMore,
    loadMoreError,
    keyword,
    cursorKey,
    listKey,
    loadNextPage,
  ]);

  const isEmpty = objectList.length === 0;
  // Only once this very list has loaded (not while loading, after an error, or on a stale previous list).
  const showEmpty = !!connectionId && !!bucket && isLoaded && cursorKey === listKey && isEmpty && !nextCursor;
  // Retry after a failed page, or continue a search that found nothing yet.
  const showLoadMore = !!keyword && !!nextCursor && !isLoadingMore && (isEmpty || loadMoreError);
  // With no rows the list has no height, so the footer flows normally instead of hanging below the rows.
  const footerStyle = isEmpty ? { width: '100%' } : { position: 'absolute' as const, top: '100%', width: '100%' };

  return (
    <div ref={listRef} style={{ position: 'relative', height: isEmpty ? undefined : virtualizer.getTotalSize() }}>
      {virtualItems.map(row => (
        <div
          key={row.key}
          style={{
            position: 'absolute',
            width: '100%',
            transform: `translateY(${row.start - scrollMargin}px)`,
          }}
        >
          <ObjectItem
            tabId={tabId}
            item={objectList[row.index]}
            labels={labels}
            onOpenDetail={onOpenDetail}
            onToggleSelect={onToggleSelect}
            onClickMenuButton={onClickMenuButton}
            onClickDeleteFolder={onClickDeleteFolder}
            onOpenFolder={onOpenFolder}
          />
        </div>
      ))}
      {isLoadingMore || (isLoadingFirst && keyword && connectionId && bucket) ? (
        <Center style={footerStyle} py="8px">
          <Loader size="sm" />
        </Center>
      ) : null}
      {showEmpty ? (
        <Center style={footerStyle} py="8px">
          <Text c="dimmed">{keyword ? t('search.empty') : t('emptyFolder')}</Text>
        </Center>
      ) : null}
      {showLoadMore ? (
        <Center style={footerStyle} py="8px">
          <Button onClick={onClickLoadMore}>{t('search.loadMore')}</Button>
        </Center>
      ) : null}
    </div>
  );
}
export default ObjectListView;
