import { Center, Loader } from '@mantine/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  DeleteObject,
  DeletePrefix,
  DownloadObject,
  GetListObject,
  UploadObject,
} from '@wails/S3Browser/internal/handlers/buckethandler';
import { ConnectionProfileOutput } from '@wails/S3Browser/models';
import { FilesDroppedOutput, ObjectItem as ObjectItemData } from '@wails/S3Browser/models/bucket';
import { Events } from '@wailsio/runtime';
import { Ref, RefObject, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useTabListStore } from '@/common/stores/tabListStore';
import { callIPC } from '@/common/utils/ipcUtils';
import { formatStringJson } from '@/common/utils/stringUtils';
import ConfirmModal from '@/components/modals/ConfirmModal';
import UploadLimitModal from '@/components/modals/UploadLimitModal';
import i18n from '@/locales/i18n';
import ObjectItem from '@/pages/object/components/ObjectItem';

// Download or delete is refused above this many objects at once.
const MAX_OBJECTS_PER_ACTION = 5;
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
  ref?: Ref<ObjectListViewRef>;
};

function ObjectListView(props: ObjectListViewProps) {
  const { tabId, bucket, profile, scrollRef, ref } = props;

  const [objectDatas, setObjectDatas] = useState<ObjectItemData[]>([]);
  const [nextCursor, setNextCursor] = useState('');
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [scrollMargin, setScrollMargin] = useState(0);

  const connectionId = profile?.id;
  const profileName = profile?.name;
  const requestCtrl = useRef<AbortController>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const prefix = useTabListStore(s => s.tabList[tabId]?.prefix ?? '');
  const changePrefix = useTabListStore(s => s.changePrefix);
  const addSelectItem = useTabListStore(s => s.addSelectItem);
  const removeSelectItem = useTabListStore(s => s.removeSelectItem);
  const clearSelectItem = useTabListStore(s => s.clearSelectItem);
  const setDeleting = useTabListStore(s => s.setDeleting);
  const setUploadingTab = useTabListStore(s => s.setUploadingTab);

  const startRequest = useCallback(() => {
    requestCtrl.current?.abort();
    const ctrl = new AbortController();
    requestCtrl.current = ctrl;
    return ctrl;
  }, []);

  const handleGetListObject = useCallback(
    (cursor: string, signal?: AbortSignal) => {
      if (!connectionId || !bucket) return Promise.resolve(undefined);
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
    [bucket, prefix, profileName, connectionId]
  );

  const loadFirstPage = useCallback(async () => {
    const ctrl = startRequest();
    setNextCursor('');
    setIsLoadingMore(false);
    setLoadMoreError(false);
    // Aborting cancels the request on the Go side too, not only the state update.
    const output = await handleGetListObject('', ctrl.signal);
    if (output && !ctrl.signal.aborted) {
      setObjectDatas(output.objectList);
      setNextCursor(output.nextCursor ?? '');
    }
  }, [handleGetListObject, startRequest]);

  const loadNextPage = useCallback(async () => {
    if (!nextCursor) return;
    const ctrl = startRequest();
    setIsLoadingMore(true);
    const output = await handleGetListObject(nextCursor, ctrl.signal);
    if (ctrl.signal.aborted) return;
    if (output) {
      setObjectDatas(prev => [...prev, ...output.objectList]);
      setNextCursor(output.nextCursor ?? '');
    } else {
      setLoadMoreError(true);
    }
    setIsLoadingMore(false);
  }, [nextCursor, handleGetListObject, startRequest]);

  // Also runs when the prefix changes, because loadFirstPage depends on it.
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
              await callIPC(DeleteObject, [{ connectionId, profileName, bucket, objects }]);
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
    [bucket, profileName, connectionId, onRefresh, setDeleting, tabId, clearSelectItem]
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
        await callIPC(DeletePrefix, [{ connectionId, profileName, bucket, prefix: folderKey }]);
        // Refresh even on failure or cancel: part of the folder may already be deleted.
        await onRefresh();
      } finally {
        setDeleting(tabId, [folderKey], false);
      }
    },
    [bucket, profileName, connectionId, onRefresh, setDeleting, tabId]
  );

  const onToggleSelect = useCallback(
    (key: string, checked: boolean) => {
      if (checked) {
        addSelectItem(tabId, [key]);
      } else removeSelectItem(tabId, [key]);
    },
    [tabId, addSelectItem, removeSelectItem]
  );

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
    if (!nextCursor || isLoadingMore || loadMoreError) return;
    // Load the next page once only 2 items are left below the viewport.
    if (lastVisibleIndex >= objectList.length - 1 - 2) {
      loadNextPage();
    }
  }, [lastVisibleIndex, objectList.length, nextCursor, isLoadingMore, loadMoreError, loadNextPage]);

  return (
    <div ref={listRef} style={{ position: 'relative', height: virtualizer.getTotalSize() }}>
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
            onToggleSelect={onToggleSelect}
            onClickMenuButton={onClickMenuButton}
            onClickDeleteFolder={onClickDeleteFolder}
            onOpenFolder={onOpenFolder}
          />
        </div>
      ))}
      {isLoadingMore ? (
        <Center style={{ position: 'absolute', top: '100%', width: '100%' }} py="8px">
          <Loader size="sm" />
        </Center>
      ) : null}
    </div>
  );
}
export default ObjectListView;
