import { Center, Loader } from '@mantine/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { GetListBucket } from '@wails/S3Browser/internal/handlers/buckethandler';
import { ConnectionProfileOutput } from '@wails/S3Browser/models';
import { Bucket } from '@wails/S3Browser/models/bucket';
import { Ref, RefObject, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { callIPC } from '@/common/utils/ipcUtils';
import BucketItem from '@/pages/bucket/components/BucketItem';

export type BucketListViewRef = {
  onRefresh?: () => Promise<void>;
};

type BucketListViewProps = {
  profile?: ConnectionProfileOutput | null;
  active: boolean;
  scrollRef: RefObject<HTMLElement | null>;
  onSelectBucket?: (bucketName: string | undefined) => void;
  ref?: Ref<BucketListViewRef>;
};

function BucketListView(props: BucketListViewProps) {
  const { profile, active, scrollRef, onSelectBucket, ref } = props;

  const [bucketDatas, setBucketDatas] = useState<Bucket[]>([]);
  const [nextCursor, setNextCursor] = useState('');
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [scrollMargin, setScrollMargin] = useState(0);

  const connectionId = profile?.id;
  const profileName = profile?.name;
  const requestCtrl = useRef<AbortController>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const startRequest = useCallback(() => {
    requestCtrl.current?.abort();
    const ctrl = new AbortController();
    requestCtrl.current = ctrl;
    return ctrl;
  }, []);

  const handleGetListBucket = useCallback(
    (cursor: string, signal?: AbortSignal) => {
      if (!connectionId) return Promise.resolve(undefined);
      return callIPC(GetListBucket, [{ connectionId, profileName, nextCursor: cursor, limit: 10 }], { signal });
    },
    [profileName, connectionId]
  );

  const loadFirstPage = useCallback(async () => {
    const ctrl = startRequest();
    setNextCursor('');
    setIsLoadingMore(false);
    setLoadMoreError(false);
    // Aborting cancels the request on the Go side too, not only the state update.
    const output = await handleGetListBucket('', ctrl.signal);
    if (output && !ctrl.signal.aborted) {
      setBucketDatas(output.bucketList ?? []);
      setNextCursor(output.nextCursor ?? '');
    }
  }, [handleGetListBucket, startRequest]);

  const loadNextPage = useCallback(async () => {
    if (!nextCursor) return;
    const ctrl = startRequest();
    setIsLoadingMore(true);
    const output = await handleGetListBucket(nextCursor, ctrl.signal);
    if (ctrl.signal.aborted) return;
    if (output) {
      setBucketDatas(prev => [...prev, ...(output.bucketList ?? [])]);
      setNextCursor(output.nextCursor ?? '');
    } else {
      setLoadMoreError(true);
    }
    setIsLoadingMore(false);
  }, [nextCursor, handleGetListBucket, startRequest]);

  useEffect(() => {
    if (!connectionId) return;
    setBucketDatas([]);
    loadFirstPage();
  }, [connectionId, loadFirstPage]);

  // Cancel any running request when the view unmounts.
  useEffect(() => () => requestCtrl.current?.abort(), []);

  const onRefresh = useCallback(async () => {
    setBucketDatas([]);
    await loadFirstPage();
    scrollRef.current?.scrollTo({ top: 0 });
  }, [scrollRef, loadFirstPage]);

  useImperativeHandle(ref, () => ({ onRefresh }), [onRefresh]);

  const bucketList = connectionId ? bucketDatas : [];

  // The list sits below the scroll container's padding, so the virtualizer needs that offset.
  // Re-measure when the view is shown again, since offsetTop is 0 while it is hidden.
  useLayoutEffect(() => {
    if (active) setScrollMargin(listRef.current?.offsetTop ?? 0);
  }, [active]);

  // React Compiler is disabled, so this compiler-only lint does not apply.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: bucketList.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 88,
    getItemKey: idx => bucketList[idx].name ?? idx,
    gap: 8,
    overscan: 5,
    scrollMargin,
    enabled: active,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const lastVisibleIndex = virtualizer.range?.endIndex ?? -1;

  useEffect(() => {
    // After a failed page, wait for Refresh instead of retrying in a loop.
    if (!active || !nextCursor || isLoadingMore || loadMoreError) return;
    // Load the next page once only 2 items are left below the viewport.
    if (lastVisibleIndex >= bucketList.length - 1 - 2) {
      loadNextPage();
    }
  }, [active, lastVisibleIndex, bucketList.length, nextCursor, isLoadingMore, loadMoreError, loadNextPage]);

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
          <BucketItem item={bucketList[row.index]} onSelectBucket={onSelectBucket} />
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
export default BucketListView;
