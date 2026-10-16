import { Center, Loader } from '@mantine/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { DeleteObject, DownloadObject, GetListObject } from '@wails/S3Browser/internal/handlers/buckethandler';
import { ConnectionProfileOutput } from '@wails/S3Browser/models';
import { ObjectItem as ObjectItemData } from '@wails/S3Browser/models/bucket';
import { Ref, RefObject, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { useTabListStore } from '@/common/stores/tabListStore';
import { callIPC } from '@/common/utils/ipcUtils';
import ObjectItem from '@/pages/bucket/components/ObjectItem';

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

  const addSelectItem = useTabListStore(s => s.addSelectItem);
  const removeSelectItem = useTabListStore(s => s.removeSelectItem);
  const clearSelectItem = useTabListStore(s => s.clearSelectItem);

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
            prefix: '',
            nextCursor: cursor,
            limit: 10,
          },
        ],
        {
          signal,
        }
      );
    },
    [bucket, profileName, connectionId]
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

  useEffect(() => {
    if (!connectionId || !bucket) return;
    setObjectDatas([]);
    loadFirstPage();
  }, [connectionId, bucket, loadFirstPage]);

  // Cancel any running request when the view unmounts.
  useEffect(
    () => () => {
      requestCtrl.current?.abort();
      clearSelectItem(tabId);
    },
    [clearSelectItem, tabId]
  );

  const onClickMenuButton = useCallback(
    async (objects: string[], action: 'download' | 'delete' | 'detail') => {
      if (!connectionId || !bucket) return;
      switch (action) {
        case 'download':
          await callIPC(DownloadObject, [{ connectionId: connectionId, profileName, bucket, objects }]);
          break;
        default:
          await callIPC(DeleteObject, [{ connectionId: connectionId, profileName, bucket, objects }]);
          break;
      }
    },
    [bucket, profileName, connectionId]
  );

  const onToggleSelect = useCallback(
    (key: string, checked: boolean) => {
      if (checked) addSelectItem(tabId, [key]);
      else removeSelectItem(tabId, [key]);
    },
    [tabId, addSelectItem, removeSelectItem]
  );

  useImperativeHandle(
    ref,
    () => ({
      onRefresh: async () => {
        setObjectDatas([]);
        await loadFirstPage();
        scrollRef.current?.scrollTo({ top: 0 });
      },
      onClickMenuButton,
    }),
    [loadFirstPage, scrollRef, onClickMenuButton]
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
    estimateSize: () => 104,
    getItemKey: idx => objectList[idx].key,
    gap: 8,
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
