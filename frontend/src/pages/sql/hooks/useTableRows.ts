import { useCallback, useEffect, useRef, useState } from 'react';
import type { Provider } from '@/pages/sql/stores/dbProfileStore';
import { fetchTableRows, openTableRows } from '@/pages/sql/utils/dbObjectSource';

type RowsState = { columns: string[]; rows: (string | null)[][]; hasMore: boolean; loading: boolean };

const INITIAL_STATE: RowsState = { columns: [], rows: [], hasMore: false, loading: true };

/**
 * Rows of one table, loaded page by page. They live here, not in a zustand store: a table can have 100,000+ rows
 * and immer would copy and freeze them on every page. The first page loads on mount; a failed load shows no rows.
 * `resetKey` changes with the table (and tab), so state kept per table can reset with it.
 */
export function useTableRows(tabId: string, provider: Provider, profileId: string, schema: string, table: string) {
  const [state, setState] = useState<RowsState>(INITIAL_STATE);
  const [loadingMore, setLoadingMore] = useState(false);
  const [fetchAll, setFetchAll] = useState(false);
  // Bumped by `refresh` to run the first-page load again.
  const [reloadCount, setReloadCount] = useState(0);
  const key = `${tabId}|${provider}|${profileId}|${schema}|${table}`;
  const [stateKey, setStateKey] = useState(key);
  // A different table starts from scratch (adjusting state during render, so no stale rows are ever painted).
  if (stateKey !== key) {
    setStateKey(key);
    setState(INITIAL_STATE);
    setLoadingMore(false);
    setFetchAll(false);
  }
  const cursorRef = useRef<number | null>(null);
  const loadedRef = useRef(0);
  const fetchRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // The cleanup below already cancelled the previous table's loads.
    cursorRef.current = null;
    loadedRef.current = 0;

    const controller = new AbortController();
    void (async () => {
      const page = await openTableRows(provider, tabId, { profileId, schema, table }, controller.signal);
      if (controller.signal.aborted) return;

      cursorRef.current = page && !page.done ? page.cursorId : null;
      loadedRef.current = page?.rows.length ?? 0;
      setState({
        columns: page?.columns ?? [],
        rows: page?.rows ?? [],
        hasMore: cursorRef.current !== null,
        loading: false,
      });
    })();
    return () => {
      controller.abort();
      fetchRef.current?.abort();
      fetchRef.current = null;
    };
    // reloadCount only re-runs the load on refresh.
  }, [tabId, provider, profileId, schema, table, reloadCount]);

  /** Reads the next page, or every remaining row when `all`; does nothing while a fetch runs or all was read. */
  const fetchPage = useCallback(
    async (all: boolean) => {
      const cursorId = cursorRef.current;
      if (cursorId === null || fetchRef.current) return;

      const controller = new AbortController();
      fetchRef.current = controller;
      setLoadingMore(true);
      try {
        const page = await fetchTableRows(
          provider,
          tabId,
          { profileId, schema, table },
          cursorId,
          loadedRef.current,
          controller.signal,
          all
        );
        if (controller.signal.aborted) return;

        // A failed fetch leaves the cursor unusable, so the grid stops asking for more.
        const done = page?.done ?? true;
        if (done) cursorRef.current = null;
        loadedRef.current += page?.rows.length ?? 0;
        setState(prev => ({
          ...prev,
          rows: page ? [...prev.rows, ...page.rows] : prev.rows,
          hasMore: !done,
        }));
      } finally {
        if (fetchRef.current === controller) {
          fetchRef.current = null;
          setLoadingMore(false);
        }
      }
    },
    [tabId, provider, profileId, schema, table]
  );

  const loadMore = useCallback(() => fetchPage(false), [fetchPage]);

  /**
   * Ticking reads the rest of the cursor in one call. Unticking while it runs cancels it and keeps the rows already
   * loaded; the cancelled read may have consumed part of the cursor, so no more rows can be fetched afterwards.
   */
  const setFetchAllRows = useCallback(
    (checked: boolean) => {
      setFetchAll(checked);
      if (checked) {
        void fetchPage(true);
        return;
      }
      if (!fetchRef.current) return;
      fetchRef.current.abort();
      fetchRef.current = null;
      cursorRef.current = null;
      setLoadingMore(false);
      setState(prev => ({ ...prev, hasMore: false }));
    },
    [fetchPage]
  );

  /** Reloads the first page and unticks fetch all; the cleanup of the load effect cancels any running read. */
  const refresh = useCallback(() => {
    setState(INITIAL_STATE);
    setLoadingMore(false);
    setFetchAll(false);
    setReloadCount(count => count + 1);
  }, []);

  return { ...state, loadingMore, fetchAll, loadMore, setFetchAllRows, refresh, resetKey: key };
}
