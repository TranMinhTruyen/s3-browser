import { useCallback, useEffect, useRef, useState } from 'react';
import type { Provider } from '@/pages/sql/stores/dbProfileStore';
import { fetchTableRows, openTableRows } from '@/pages/sql/utils/dbObjectSource';

type RowsState = { columns: string[]; rows: (string | null)[][]; hasMore: boolean; loading: boolean };

const INITIAL_STATE: RowsState = { columns: [], rows: [], hasMore: false, loading: true };

/**
 * Rows of one table, loaded page by page. They live here, not in a zustand store: a table can have 100,000+ rows
 * and immer would copy and freeze them on every page. The first page loads on mount; a failed load shows no rows.
 */
export function useTableRows(tabId: string, provider: Provider, profileId: string, schema: string, table: string) {
  const [state, setState] = useState<RowsState>(INITIAL_STATE);
  const [loadingMore, setLoadingMore] = useState(false);
  const key = `${tabId}|${provider}|${profileId}|${schema}|${table}`;
  const [stateKey, setStateKey] = useState(key);
  // A different table starts from scratch (adjusting state during render, so no stale rows are ever painted).
  if (stateKey !== key) {
    setStateKey(key);
    setState(INITIAL_STATE);
    setLoadingMore(false);
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
  }, [tabId, provider, profileId, schema, table]);

  /** Loads the next page; does nothing while a page is loading or when everything was read. */
  const loadMore = useCallback(async () => {
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
        controller.signal
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
  }, [tabId, provider, profileId, schema, table]);

  return { ...state, loadingMore, loadMore };
}
