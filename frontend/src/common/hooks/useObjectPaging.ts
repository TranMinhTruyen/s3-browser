import { GetListObject, SearchObject } from '@wails/S3Browser/internal/handlers/buckethandler';
import { ObjectItem as ObjectItemData } from '@wails/S3Browser/models/bucket';
import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { callIPC } from '@/common/utils/ipcUtils';
import { onTabGone } from '@/common/utils/tabUtils';

// Objects fetched per page: a small first page shows up fast, later pages are big to keep scrolling smooth.
export const FIRST_PAGE_SIZE = 200;
export const NEXT_PAGE_SIZE = 1000;

type UseObjectPagingParams = {
  tabId: string;
  connectionId?: string;
  profileName?: string;
  bucket?: string;
  prefix: string;
  // Applied search keyword; empty means the normal folder listing.
  keyword: string;
  // Identifies the list (connection, bucket, prefix, keyword) the cursor belongs to.
  listKey: string;
  scrollRef: RefObject<HTMLElement | null>;
};

/**
 * Cursor-based paging of an object list (folder listing or search) with request cancellation.
 * Loads the first page whenever the list source changes and aborts the running request on unmount.
 */
export function useObjectPaging(params: UseObjectPagingParams) {
  const { tabId, connectionId, profileName, bucket, prefix, keyword, listKey, scrollRef } = params;

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
  const requestCtrl = useRef<AbortController>(null);
  // The loadFirstPage the list was last loaded for: showing a hidden tab again must not reload it.
  const loadedFor = useRef<unknown>(null);

  const startRequest = useCallback(() => {
    requestCtrl.current?.abort();
    const ctrl = new AbortController();
    requestCtrl.current = ctrl;
    return ctrl;
  }, []);

  // Lists the folder, or searches it when a keyword is applied. Both return the same shape.
  const handleGetListObject = useCallback(
    (cursor: string, signal?: AbortSignal) => {
      const limit = cursor ? NEXT_PAGE_SIZE : FIRST_PAGE_SIZE;
      if (!connectionId || !bucket) return Promise.resolve(undefined);
      if (keyword) {
        return callIPC(SearchObject, [{ connectionId, profileName, bucket, prefix, keyword, nextCursor: cursor }], {
          signal,
        });
      }
      return callIPC(GetListObject, [{ connectionId, profileName, bucket, prefix, nextCursor: cursor, limit }], {
        signal,
      });
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

  const loadNextPage = useCallback(async () => {
    if (!nextCursor) return;
    const ctrl = startRequest();
    setIsLoadingMore(true);
    const output = await handleGetListObject(nextCursor, ctrl.signal);
    if (ctrl.signal.aborted) return;
    if (output) {
      setObjectDatas(prev => {
        // A search cursor can overlap the previous page, so drop keys already shown. A folder listing cannot.
        const seen = new Set(keyword ? prev.map(item => item.key) : []);
        const added = keyword ? output.objectList.filter(item => !seen.has(item.key)) : output.objectList;
        // Nothing new: keep the same array so the list does not re-render.
        return added.length > 0 ? [...prev, ...added] : prev;
      });
      // A cursor equal to the one just sent would make auto-load repeat forever: treat it as the end.
      setNextCursor(output.nextCursor === nextCursor ? '' : (output.nextCursor ?? ''));
    } else {
      setLoadMoreError(true);
    }
    setIsLoadingMore(false);
  }, [nextCursor, keyword, handleGetListObject, startRequest]);

  // Also runs when the prefix or keyword changes, because loadFirstPage depends on them.
  useEffect(() => {
    if (!connectionId || !bucket) {
      // Disconnected: reconnecting to the same source must load the list again.
      loadedFor.current = null;
      return;
    }
    if (loadedFor.current === loadFirstPage) return;
    loadedFor.current = loadFirstPage;
    // oxlint-disable-next-line react/set-state-in-effect -- reset the list before the new source loads
    setObjectDatas([]);
    scrollRef.current?.scrollTo({ top: 0 });
    loadFirstPage();
  }, [connectionId, bucket, loadFirstPage, scrollRef]);

  // Cancel any running request when the view unmounts. A hidden tab (Activity) keeps its request and list.
  useEffect(
    () =>
      onTabGone(tabId, () => {
        requestCtrl.current?.abort();
        loadedFor.current = null;
      }),
    [tabId]
  );

  const onRefresh = useCallback(async () => {
    setObjectDatas([]);
    await loadFirstPage();
    scrollRef.current?.scrollTo({ top: 0 });
  }, [scrollRef, loadFirstPage]);

  // Retry after a failed page, or continue a search that found nothing yet.
  const onClickLoadMore = useCallback(() => {
    setLoadMoreError(false);
    return loadNextPage();
  }, [loadNextPage]);

  return {
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
  };
}
