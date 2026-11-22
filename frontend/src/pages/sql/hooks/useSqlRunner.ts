import { ExecuteSql, FetchRows } from '@wails/S3Browser/internal/handlers/dbhandler';
import type { StatementResult } from '@wails/S3Browser/models';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { callIPC } from '@/common/utils/ipcUtils';
import { useDbProfileStore } from '@/pages/sql/stores/dbProfileStore';
import { runSql } from '@/pages/sql/utils/sqlToast';

/** The statements of the last run. `runId` changes with every run, so the panel can reset its own state. */
type RunState = { runId: number; statements: StatementResult[]; cancelled: boolean };

const INITIAL_STATE: RunState = { runId: 0, statements: [], cancelled: false };

/** True when the statement is a SELECT whose rows are not all loaded yet. */
export const canLoadMore = (statement: StatementResult): boolean =>
  statement.kind === 'rows' && !statement.error && statement.cursorId !== null && !statement.done;

/**
 * Runs the SQL of one tab. SQLite goes to the backend (connecting first when needed); PostgreSQL is still fake.
 * The rows live here, not in a zustand store: a result can hold 100,000+ rows and immer would copy and freeze
 * them on every page. Only the last statement keeps a cursor, so `loadMore` always fetches for that one.
 */
export function useSqlRunner(tabId: string) {
  const { t } = useTranslation('sqlTab');
  const [state, setState] = useState<RunState>(INITIAL_STATE);
  const [running, setRunning] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const runRef = useRef<AbortController | null>(null);
  const fetchRef = useRef<AbortController | null>(null);
  const cursorRef = useRef<number | null>(null);

  // Leaving the tab drops what is in flight; the late results are ignored.
  useEffect(
    () => () => {
      runRef.current?.abort();
      fetchRef.current?.abort();
      runRef.current = null;
      fetchRef.current = null;
    },
    []
  );

  const run = useCallback(
    async (profileId: string | null, sql: string) => {
      const { getDbProfileById, connectDbProfile } = useDbProfileStore.getState();
      const profile = getDbProfileById(profileId);
      if (profile?.provider !== 'sqlite') {
        runSql(profileId, sql);
        return;
      }
      if (!sql.trim()) {
        toast.warning(t('toast.emptySql'));
        return;
      }

      runRef.current?.abort();
      fetchRef.current?.abort();
      fetchRef.current = null;
      cursorRef.current = null;
      setLoadingMore(false);
      const controller = new AbortController();
      runRef.current = controller;
      setRunning(true);

      try {
        if (!profile.isConnected) {
          const connected = await connectDbProfile(profile.id);
          if (connected) toast.success(t('toast.connected', { ns: 'sqlNavbar', name: profile.name }));
          // Cancelled (or the tab left) while connecting: do not run the SQL.
          if (!connected || controller.signal.aborted) return;
        }
        const output = await callIPC(ExecuteSql, [{ profileId: profile.id, tabId, sql }], {
          signal: controller.signal,
        });
        if (runRef.current !== controller) return; // a newer run (or leaving the tab) owns the state now

        const statements = output?.statements ?? [];
        const last = statements[statements.length - 1];
        cursorRef.current = last && canLoadMore(last) ? last.cursorId : null;
        setState(prev => ({ runId: prev.runId + 1, statements, cancelled: controller.signal.aborted }));
      } finally {
        if (runRef.current === controller) {
          runRef.current = null;
          setRunning(false);
        }
      }
    },
    [tabId, t]
  );

  const cancel = useCallback(() => runRef.current?.abort(), []);

  /** The tab moved to another profile: its backend connection is gone, so stop what is in flight and the cursor. */
  const detach = useCallback(() => {
    runRef.current?.abort();
    fetchRef.current?.abort();
    runRef.current = null;
    fetchRef.current = null;
    cursorRef.current = null;
    setRunning(false);
    setLoadingMore(false);
  }, []);

  const loadMore = useCallback(async () => {
    const cursorId = cursorRef.current;
    if (cursorId === null || fetchRef.current) return;

    const controller = new AbortController();
    fetchRef.current = controller;
    setLoadingMore(true);
    try {
      const page = await callIPC(FetchRows, [{ tabId, cursorId }], { signal: controller.signal });
      if (controller.signal.aborted) return;

      // A failed fetch leaves the cursor unusable, so the statement stops asking for more.
      const done = page?.done ?? true;
      if (done) cursorRef.current = null;
      setState(prev => {
        const last = prev.statements[prev.statements.length - 1];
        if (!last) return prev;
        const updated = { ...last, rows: page ? [...last.rows, ...page.rows] : last.rows, done };
        return { ...prev, statements: [...prev.statements.slice(0, -1), updated] };
      });
    } finally {
      if (fetchRef.current === controller) {
        fetchRef.current = null;
        setLoadingMore(false);
      }
    }
  }, [tabId]);

  return { ...state, running, loadingMore, run, cancel, detach, loadMore };
}
