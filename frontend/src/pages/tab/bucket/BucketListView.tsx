import { Center, Loader, Text } from '@mantine/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { CheckBucketAccess, GetListBucket, SearchBucket } from '@wails/S3Browser/internal/handlers/buckethandler';
import { ConnectionProfileOutput } from '@wails/S3Browser/models';
import { Bucket } from '@wails/S3Browser/models/bucket';
import { Ref, RefObject, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LIST_ROW_GAP, LIST_ROW_HEIGHT } from '@/common/cnst/commonConst';
import { useTabListStore } from '@/common/stores/tabListStore';
import { isAnonymous } from '@/common/utils/authUtils';
import { callIPC } from '@/common/utils/ipcUtils';
import { onTabGone } from '@/common/utils/tabUtils';
import Button from '@/components/buttons/Button';
import BucketItem from '@/pages/tab/bucket/BucketItem';

// Buckets fetched per page.
const BUCKET_PAGE_SIZE = 1000;
// Wait for the visible range to settle before checking access of the buckets on screen.
const ACCESS_CHECK_DELAY_MS = 150;
// Load the next page once only this many rows are left below the viewport.
const PREFETCH_ROWS = 2;

export type BucketListViewRef = {
  onRefresh?: () => Promise<void>;
  // Patches the policy mode of one bucket, e.g. right after the user saved its policy.
  setPolicyMode?: (bucket: string, mode: string) => void;
};

type BucketListViewProps = {
  tabId: string;
  profile?: ConnectionProfileOutput | null;
  active: boolean;
  scrollRef: RefObject<HTMLElement | null>;
  // Applied search keyword; empty means the normal lazy-loaded list.
  keyword?: string;
  onSelectBucket?: (bucketName: string | undefined) => void;
  onEditPolicy?: (bucketName: string | undefined) => void;
  onDeleteBucket?: (bucketName: string | undefined) => void;
  ref?: Ref<BucketListViewRef>;
};

/** Virtualized bucket list of the active connection; exposes imperative actions via `BucketListViewRef`. */
function BucketListView(props: BucketListViewProps) {
  const { tabId, profile, active, scrollRef, keyword = '', onSelectBucket, onEditPolicy, onDeleteBucket, ref } = props;

  const { t } = useTranslation('bucket', { keyPrefix: 'page' });

  const [bucketDatas, setBucketDatas] = useState<Bucket[]>([]);
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

  const openBucketDetail = useTabListStore(s => s.openBucketDetail);

  const connectionId = profile?.id;
  const canEdit = !!profile && !isAnonymous(profile);
  const profileName = profile?.name;
  const listKey = `${connectionId}|${keyword}`;
  const requestCtrl = useRef<AbortController>(null);
  // The loadFirstPage the list was last loaded for: showing a hidden tab again must not reload it.
  const loadedFor = useRef<unknown>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Access check of the visible buckets: own controller, and names already sent for the current list.
  const checkCtrl = useRef<AbortController>(null);
  const checkedNames = useRef(new Set<string>());

  const resetAccessCheck = useCallback(() => {
    checkCtrl.current?.abort();
    checkCtrl.current = null;
    checkedNames.current.clear();
  }, []);

  const startRequest = useCallback(() => {
    requestCtrl.current?.abort();
    const ctrl = new AbortController();
    requestCtrl.current = ctrl;
    return ctrl;
  }, []);

  // Lists the buckets, or searches them when a keyword is applied. Both return the same shape.
  const handleGetListBucket = useCallback(
    (cursor: string, signal?: AbortSignal) => {
      if (!connectionId) return Promise.resolve(undefined);
      if (keyword) {
        return callIPC(SearchBucket, [{ connectionId, profileName, keyword, nextCursor: cursor, lazyAccess: true }], {
          signal,
        });
      }
      return callIPC(
        GetListBucket,
        [{ connectionId, profileName, nextCursor: cursor, limit: BUCKET_PAGE_SIZE, lazyAccess: true }],
        { signal }
      );
    },
    [profileName, connectionId, keyword]
  );

  const loadFirstPage = useCallback(async () => {
    const ctrl = startRequest();
    resetAccessCheck();
    setNextCursor('');
    setIsLoadingMore(false);
    setLoadMoreError(false);
    setIsLoaded(false);
    setIsLoadingFirst(true);
    // Aborting cancels the request on the Go side too, not only the state update.
    const output = await handleGetListBucket('', ctrl.signal);
    if (ctrl.signal.aborted) return;
    if (output) {
      setBucketDatas(output.bucketList ?? []);
      setNextCursor(output.nextCursor ?? '');
      setCursorKey(listKey);
      setIsLoaded(true);
    }
    setIsLoadingFirst(false);
  }, [handleGetListBucket, startRequest, resetAccessCheck, listKey]);

  const loadNextPage = useCallback(async () => {
    if (!nextCursor) return;
    const ctrl = startRequest();
    setIsLoadingMore(true);
    const output = await handleGetListBucket(nextCursor, ctrl.signal);
    if (ctrl.signal.aborted) return;
    if (output) {
      // A search cursor can overlap the previous page, so drop names already shown.
      setBucketDatas(prev => {
        const seen = new Set(prev.map(item => item.name));
        const added = (output.bucketList ?? []).filter(item => !seen.has(item.name));
        // Nothing new: keep the same array so the list does not re-render.
        return added.length > 0 ? [...prev, ...added] : prev;
      });
      // A cursor equal to the one just sent would make auto-load repeat forever: treat it as the end.
      setNextCursor(output.nextCursor === nextCursor ? '' : (output.nextCursor ?? ''));
    } else {
      setLoadMoreError(true);
    }
    setIsLoadingMore(false);
  }, [nextCursor, handleGetListBucket, startRequest]);

  // Also runs when the keyword changes, because loadFirstPage depends on it.
  useEffect(() => {
    if (!connectionId) {
      // Disconnected: reconnecting to the same profile must load the list again.
      loadedFor.current = null;
      return;
    }
    if (loadedFor.current === loadFirstPage) return;
    loadedFor.current = loadFirstPage;
    setBucketDatas([]);
    loadFirstPage();
  }, [connectionId, loadFirstPage]);

  // Cancel any running request when the view unmounts. A hidden tab (Activity) keeps its request and list.
  useEffect(
    () =>
      onTabGone(tabId, () => {
        requestCtrl.current?.abort();
        resetAccessCheck();
        loadedFor.current = null;
      }),
    [tabId, resetAccessCheck]
  );

  const onRefresh = useCallback(async () => {
    setBucketDatas([]);
    await loadFirstPage();
    scrollRef.current?.scrollTo({ top: 0 });
  }, [scrollRef, loadFirstPage]);

  const onOpenDetail = useCallback((item: Bucket) => openBucketDetail(tabId, item), [openBucketDetail, tabId]);

  const onClickLoadMore = useCallback(() => {
    setLoadMoreError(false);
    return loadNextPage();
  }, [loadNextPage]);

  const setPolicyMode = useCallback((bucket: string, mode: string) => {
    setBucketDatas(prev => {
      const idx = prev.findIndex(item => item.name === bucket);
      if (idx < 0) return prev;
      return prev.map((item, i) => (i === idx ? { ...item, policyMode: mode } : item));
    });
  }, []);

  useImperativeHandle(ref, () => ({ onRefresh, setPolicyMode }), [onRefresh, setPolicyMode]);

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
    estimateSize: () => LIST_ROW_HEIGHT,
    getItemKey: idx => bucketList[idx].name ?? idx,
    gap: LIST_ROW_GAP,
    overscan: 5,
    scrollMargin,
    enabled: active,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const lastVisibleIndex = virtualizer.range?.endIndex ?? -1;
  const firstVisibleIndex = virtualizer.range?.startIndex ?? 0;

  // Merges checked buckets by name; untouched buckets keep their reference so memoized rows do not re-render.
  const mergeAccess = useCallback((checked: Bucket[]) => {
    const byName = new Map(checked.map(item => [item.name ?? '', item]));
    setBucketDatas(prev => {
      let changed = false;
      const next = prev.map(item => {
        const result = byName.get(item.name ?? '');
        if (!result) return item;
        changed = true;
        return {
          ...item,
          inaccessible: result.inaccessible,
          readOnly: result.readOnly,
          deleteDenied: result.deleteDenied,
          accessPending: result.accessPending,
          policyMode: result.policyMode || item.policyMode,
        };
      });
      return changed ? next : prev;
    });
  }, []);

  // Checks access (and policy mode, unless anonymous) of the visible buckets still unknown, once the range stops moving. Each name is sent once per list.
  useEffect(() => {
    if (!active || !connectionId) return;
    const timer = setTimeout(async () => {
      const names = bucketDatas
        .slice(firstVisibleIndex, lastVisibleIndex + 1)
        .flatMap(item =>
          (item.accessPending || (canEdit && !item.policyMode)) && item.name && !checkedNames.current.has(item.name)
            ? [item.name]
            : []
        );
      if (names.length === 0) return;
      names.forEach(name => checkedNames.current.add(name));
      checkCtrl.current ??= new AbortController();
      const { signal } = checkCtrl.current;
      const output = await callIPC(
        CheckBucketAccess,
        [{ connectionId, profileName, bucketNames: names, withPolicy: canEdit }],
        { signal }
      );
      if (signal.aborted) return;
      if (output?.bucketList) mergeAccess(output.bucketList);
    }, ACCESS_CHECK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [active, connectionId, profileName, canEdit, bucketDatas, firstVisibleIndex, lastVisibleIndex, mergeAccess]);

  useEffect(() => {
    // After a failed page, wait for Refresh instead of retrying in a loop.
    if (!active || !nextCursor || isLoadingMore || loadMoreError || cursorKey !== listKey) return;
    // An empty search has nothing to scroll: the user continues it with the "load more" button.
    if (keyword && bucketList.length === 0) return;
    if (lastVisibleIndex >= bucketList.length - 1 - PREFETCH_ROWS) {
      loadNextPage();
    }
  }, [
    active,
    lastVisibleIndex,
    bucketList.length,
    nextCursor,
    isLoadingMore,
    loadMoreError,
    keyword,
    cursorKey,
    listKey,
    loadNextPage,
  ]);

  const isEmpty = bucketList.length === 0;
  // Only once this very list has loaded (not while loading, after an error, or on a stale previous list).
  const showEmpty = !!connectionId && isLoaded && cursorKey === listKey && isEmpty && !nextCursor;
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
          <BucketItem
            item={bucketList[row.index]}
            canEdit={canEdit}
            onSelectBucket={onSelectBucket}
            onOpenDetail={onOpenDetail}
            onEditPolicy={onEditPolicy}
            onDeleteBucket={onDeleteBucket}
          />
        </div>
      ))}
      {isLoadingMore || (isLoadingFirst && keyword && connectionId) ? (
        <Center style={footerStyle} py="8px">
          <Loader size="sm" />
        </Center>
      ) : null}
      {showEmpty ? (
        <Center style={footerStyle} py="8px">
          <Text c="dimmed">{keyword ? t('search.empty') : t('empty')}</Text>
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
export default BucketListView;
