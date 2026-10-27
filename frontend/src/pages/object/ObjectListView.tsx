import { Center, Loader, Text } from '@mantine/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  DeleteObject,
  DeletePrefix,
  DownloadObject,
  GetListObject,
  SearchObject,
  UploadObject,
} from '@wails/S3Browser/internal/handlers/buckethandler';
import { ConnectionProfileOutput } from '@wails/S3Browser/models';
import { FilesDroppedOutput, ObjectItem as ObjectItemData } from '@wails/S3Browser/models/bucket';
import { Output } from '@wails/S3Browser/models/common';
import { Events } from '@wailsio/runtime';
import { Ref, RefObject, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useTabListStore } from '@/common/stores/tabListStore';
import { callIPC } from '@/common/utils/ipcUtils';
import { formatStringJson } from '@/common/utils/stringUtils';
import Button from '@/components/buttons/Button';
import ConfirmModal from '@/components/modals/ConfirmModal';
import UploadLimitModal from '@/components/modals/UploadLimitModal';
import i18n from '@/locales/i18n';
import ObjectItem from '@/pages/object/ObjectItem';

// Download or delete is refused above this many objects at once.
const MAX_OBJECTS_PER_ACTION = 5;
// Backend message code of a key deleted successfully (its `params.object` is the key).
const DELETE_OBJECT_SUCCESS_CODE = 'S3S005';
// Objects fetched per page.
const OBJECT_PAGE_SIZE = 10;
// Row height before measuring, and the gap between rows.
const ROW_ESTIMATE_SIZE = 104;
const ROW_GAP = 8;

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

function ObjectListView(props: ObjectListViewProps) {
  const { tabId, bucket, profile, scrollRef, keyword = '', ref } = props;

  const { t } = useTranslation('object', { keyPrefix: 'page' });

  const [objectDatas, setObjectDatas] = useState<ObjectItemData[]>([]);
  const [nextCursor, setNextCursor] = useState('');
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  // The list the cursor belongs to. Right after the source changes, nextCursor still holds the old list's
  // cursor until the new first page lands, and sending it to the new source would break the request.
  const [cursorKey, setCursorKey] = useState('');
  const [isLoadingFirst, setIsLoadingFirst] = useState(false);
  // True once the first page of the current list has loaded, so an empty search result can be told from loading.
  const [isLoaded, setIsLoaded] = useState(false);
  const [scrollMargin, setScrollMargin] = useState(0);

  const connectionId = profile?.id;
  const profileName = profile?.name;
  const requestCtrl = useRef<AbortController>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const prefix = useTabListStore(s => s.tabList[tabId]?.prefix ?? '');
  const listKey = `${connectionId}|${bucket}|${prefix}|${keyword}`;
  const changePrefix = useTabListStore(s => s.changePrefix);
  const addSelectItem = useTabListStore(s => s.addSelectItem);
  const removeSelectItem = useTabListStore(s => s.removeSelectItem);
  const clearSelectItem = useTabListStore(s => s.clearSelectItem);
  const openDetail = useTabListStore(s => s.openDetail);
  const closeDetail = useTabListStore(s => s.closeDetail);
  const setDeleting = useTabListStore(s => s.setDeleting);
  const setUploadingTab = useTabListStore(s => s.setUploadingTab);

  const startRequest = useCallback(() => {
    requestCtrl.current?.abort();
    const ctrl = new AbortController();
    requestCtrl.current = ctrl;
    return ctrl;
  }, []);

  // Lists the folder, or searches it when a keyword is applied. Both return the same shape.
  const handleGetListObject = useCallback(
    (cursor: string, signal?: AbortSignal) => {
      if (!connectionId || !bucket) return Promise.resolve(undefined);
      if (keyword) {
        return callIPC(SearchObject, [{ connectionId, profileName, bucket, prefix, keyword, nextCursor: cursor }], {
          signal,
        });
      }
      return callIPC(
        GetListObject,
        [
          {
            connectionId,
            profileName,
            bucket,
            prefix,
            nextCursor: cursor,
            limit: OBJECT_PAGE_SIZE,
          },
        ],
        {
          signal,
        }
      );
    },
    [bucket, prefix, profileName, connectionId, keyword]
  );

  const loadFirstPage = useCallback(async () => {
    const ctrl = startRequest();
    setNextCursor('');
    setIsLoadingMore(false);
    setLoadMoreError(false);
    setIsLoaded(false);
    setIsLoadingFirst(true);
    // Aborting cancels the request on the Go side too, not only the state update.
    const output = await handleGetListObject('', ctrl.signal);
    if (ctrl.signal.aborted) return;
    if (output) {
      setObjectDatas(output.objectList);
      setNextCursor(output.nextCursor ?? '');
      setCursorKey(listKey);
      setIsLoaded(true);
    }
    setIsLoadingFirst(false);
  }, [handleGetListObject, startRequest, listKey]);

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

  // Runs on success and on partial failure: only keys reported as S3S005 are actually deleted. Output may be undefined.
  const closeDetailIfDeletedByOutput = useCallback(
    (output?: Output<unknown>) =>
      closeDetailIfDeleted(
        (output?.messageList ?? [])
          .filter(message => message.messageCode === DELETE_OBJECT_SUCCESS_CODE)
          .map(message => message.params?.object)
          .filter(object => object !== undefined && object !== null && object !== '')
          .map(String)
      ),
    [closeDetailIfDeleted]
  );

  const loadNextPage = useCallback(async () => {
    if (!nextCursor) return;
    const ctrl = startRequest();
    setIsLoadingMore(true);
    const output = await handleGetListObject(nextCursor, ctrl.signal);
    if (ctrl.signal.aborted) return;
    if (output) {
      // A search cursor can overlap the previous page, so drop keys already shown.
      setObjectDatas(prev => {
        const seen = new Set(prev.map(item => item.key));
        const added = output.objectList.filter(item => !seen.has(item.key));
        // Nothing new: keep the same array so the list does not re-render.
        return added.length > 0 ? [...prev, ...added] : prev;
      });
      // A cursor equal to the one just sent would make auto-load repeat forever: treat it as the end.
      setNextCursor(output.nextCursor === nextCursor ? '' : (output.nextCursor ?? ''));
    } else {
      setLoadMoreError(true);
    }
    setIsLoadingMore(false);
  }, [nextCursor, handleGetListObject, startRequest]);

  // Also runs when the prefix or keyword changes, because loadFirstPage depends on them.
  useEffect(() => {
    if (!connectionId || !bucket) return;
    setObjectDatas([]);
    scrollRef.current?.scrollTo({ top: 0 });
    loadFirstPage();
  }, [connectionId, bucket, loadFirstPage, scrollRef]);

  // Cancel any running request when the view unmounts.
  useEffect(
    () => () => {
      requestCtrl.current?.abort();
      clearSelectItem(tabId);
    },
    [clearSelectItem, tabId]
  );

  const onRefresh = useCallback(async () => {
    setObjectDatas([]);
    await loadFirstPage();
    scrollRef.current?.scrollTo({ top: 0 });
  }, [scrollRef, loadFirstPage]);

  const onClickLoadMore = useCallback(() => {
    setLoadMoreError(false);
    return loadNextPage();
  }, [loadNextPage]);

  const onClickMenuButton = useCallback(
    async (keys: string[], action: 'download' | 'delete') => {
      if (!connectionId || !bucket) return;
      // Folder keys end with "/". Downloading one fails, and deleting one would remove only
      // the folder marker, not the files in it, so they are never sent.
      const objects = keys.filter(key => !key.endsWith('/'));
      if (objects.length === 0) return;
      if (objects.length > MAX_OBJECTS_PER_ACTION) {
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
          const confirmModal = await ConfirmModal.show({
            type: 'warning',
            confirmCode: 'C000004',
            params: {
              object: objects.join(', '),
            },
            size: 'md',
          });
          if (confirmModal) {
            setDeleting(tabId, objects, true);
            try {
              // Result is false if any key failed; each key reports its own result: S3S005 deleted, S3E013 failed.
              await callIPC(DeleteObject, [{ connectionId, profileName, bucket, objects }], {
                resolveAction: closeDetailIfDeletedByOutput,
                rejectAction: closeDetailIfDeletedByOutput,
              });
              await onRefresh();
            } finally {
              setDeleting(tabId, objects, false);
            }
          }
          break;
        }
      }
      clearSelectItem(tabId);
    },
    [bucket, profileName, connectionId, onRefresh, setDeleting, tabId, clearSelectItem, closeDetailIfDeletedByOutput]
  );

  const onClickDeleteFolder = useCallback(
    async (folderKey: string, name: string) => {
      if (!connectionId || !bucket) return;
      // Already being deleted: ignore a repeated click.
      if (useTabListStore.getState().tabList[tabId]?.deletingItems?.includes(folderKey)) return;
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
        if (body) closeDetailIfDeleted([folderKey]);
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

  // An upload can outlive this render (the user may open another folder meanwhile) or the
  // view itself, so it refreshes through these refs: the list currently shown, if still mounted.
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const onFilesDropped = useCallback(
    async ({
      groups,
      skipped,
      overMaxTotal,
      capped,
      maxFilesPerFolder,
      largeFileSize,
      largeFileMaxCount,
      maxTotalFiles,
    }: FilesDroppedOutput) => {
      if (!connectionId || !bucket) return;
      if (skipped > 0) {
        toast.warning(formatStringJson(i18n.t('ipcMessage:bucket.S3W006'), { count: skipped }));
      }
      if (overMaxTotal) {
        toast.warning(formatStringJson(i18n.t('ipcMessage:bucket.S3W007'), { max: maxTotalFiles }));
      }
      let files = groups.flatMap(group => group.files);
      if (files.length === 0) return;

      const isBusy = () => useTabListStore.getState().uploadingTabId !== null;
      const warnBusy = () => toast.warning(i18n.t('ipcMessage:bucket.S3W005'));
      if (isBusy()) {
        warnBusy();
        return;
      }

      // A group over a limit needs the user to choose which files to upload.
      if (groups.some(group => group.overMaxFiles || group.overLargeCount)) {
        const chosen = await UploadLimitModal.show({
          groups,
          maxFilesPerFolder,
          largeFileSize,
          largeFileMaxCount,
          capped,
        });
        if (!chosen || chosen.length === 0) return;
        files = chosen;
        // Another tab may have started an upload while the modal was open.
        if (isBusy()) {
          warnBusy();
          return;
        }
      } else if (capped) {
        toast.warning(i18n.t('uploadLimitModal:cappedWarning'));
      }

      setUploadingTab(tabId);
      try {
        // The backend sends one success / canceled / error message per file, shown by callIPC.
        await callIPC(UploadObject, [
          { connectionId, profileName, bucket, prefix, objList: files.map(({ path, relKey }) => ({ path, relKey })) },
        ]);
        if (isMountedRef.current) {
          await onRefreshRef.current();
        }
      } finally {
        setUploadingTab(null);
      }
    },
    [bucket, connectionId, prefix, profileName, setUploadingTab, tabId]
  );

  useEffect(() => {
    const unsubscribe = Events.On('uploader:files-dropped', e => {
      // Every open tab listens; only the tab the files were dropped on handles them.
      if (e.data?.tabId === tabId) {
        onFilesDropped(e.data);
      }
    });
    return () => {
      unsubscribe();
    };
  }, [onFilesDropped, tabId]);

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
    estimateSize: () => ROW_ESTIMATE_SIZE,
    getItemKey: idx => objectList[idx].key,
    gap: ROW_GAP,
    overscan: 5,
    scrollMargin,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const lastVisibleIndex = virtualizer.range?.endIndex ?? -1;

  useEffect(() => {
    // After a failed page, wait for Refresh instead of retrying in a loop.
    if (!nextCursor || isLoadingMore || loadMoreError || cursorKey !== listKey) return;
    // An empty search has nothing to scroll: the user continues it with the "load more" button.
    if (keyword && objectList.length === 0) return;
    // Load the next page once only 2 items are left below the viewport.
    if (lastVisibleIndex >= objectList.length - 1 - 2) {
      loadNextPage();
    }
  }, [
    lastVisibleIndex,
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
  const showEmpty = !!keyword && isLoaded && isEmpty && !nextCursor;
  // Retry after a failed page, or continue a search that found nothing yet.
  const showLoadMore = !!keyword && !!nextCursor && !isLoadingMore && (isEmpty || loadMoreError);
  // With no rows the list has no height, so the footer flows normally instead of hanging below the rows.
  const footerStyle = isEmpty ? { width: '100%' } : { position: 'absolute' as const, top: '100%', width: '100%' };

  return (
    <div ref={listRef} style={{ position: 'relative', height: isEmpty ? undefined : virtualizer.getTotalSize() }}>
      {virtualItems.map(row => (
        <div
          key={row.key}
          data-index={row.index}
          ref={virtualizer.measureElement}
          style={{
            position: 'absolute',
            width: '100%',
            transform: `translateY(${row.start - scrollMargin}px)`,
          }}
        >
          <ObjectItem
            tabId={tabId}
            item={objectList[row.index]}
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
          <Text c="dimmed">{t('search.empty')}</Text>
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
