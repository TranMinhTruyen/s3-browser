import { ExecuteSql, FetchRows } from '@wails/S3Browser/internal/handlers/dbhandler';
import type { StatementResult } from '@wails/S3Browser/models';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { callIPC } from '@/common/utils/ipcUtils';
import i18n from '@/locales/i18n';
import { useDbProfileStore } from '@/pages/sql/stores/dbProfileStore';
import { streamCursorRows } from '@/pages/sql/utils/dbObjectSource';
import { runSql } from '@/pages/sql/utils/sqlToast';

/** Các câu lệnh của lần chạy gần nhất. `runId` thay đổi sau mỗi lần chạy để panel có thể reset state riêng. */
type RunState = { runId: number; statements: StatementResult[]; cancelled: boolean };

const INITIAL_STATE: RunState = { runId: 0, statements: [], cancelled: false };

/** Trả về true nếu câu lệnh là SELECT và chưa tải hết các hàng. */
export const canLoadMore = (statement: StatementResult): boolean =>
  statement.kind === 'rows' && !statement.error && statement.cursorId !== null && !statement.done;

/**
 * Chạy SQL của một tab. SQLite gọi backend (kết nối trước nếu cần); PostgreSQL hiện vẫn dùng dữ liệu giả.
 * Các hàng được lưu ở đây thay vì zustand store: kết quả có thể chứa hơn 100.000 hàng và immer sẽ sao chép, đóng băng
 * chúng sau mỗi trang. Chỉ câu lệnh cuối cùng giữ con trỏ nên `loadMore` luôn tải thêm dữ liệu cho câu đó.
 */
export function useSqlRunner(tabId: string) {
  const { t } = useTranslation('sqlTab');
  const [state, setState] = useState<RunState>(INITIAL_STATE);
  const [running, setRunning] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [fetchAll, setFetchAll] = useState(false);
  const runRef = useRef<AbortController | null>(null);
  const fetchRef = useRef<AbortController | null>(null);
  const cursorRef = useRef<number | null>(null);

  const updateLastStatement = useCallback((update: (statement: StatementResult) => StatementResult) => {
    setState(prev => {
      const lastIndex = prev.statements.length - 1;
      const last = prev.statements[lastIndex];
      if (!last) return prev;
      return { ...prev, statements: [...prev.statements.slice(0, -1), update(last)] };
    });
  }, []);

  // Rời tab sẽ hủy thao tác đang chạy; kết quả trả về muộn sẽ bị bỏ qua.
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
      setFetchAll(false);
      const controller = new AbortController();
      runRef.current = controller;
      setRunning(true);

      try {
        if (!profile.isConnected) {
          const connected = await connectDbProfile(profile.id);
          if (connected) toast.success(t('toast.connected', { ns: 'sqlNavbar', name: profile.name }));
          // Đã hủy (hoặc đã rời tab) trong lúc kết nối: không chạy câu SQL.
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

  /** Tab đã chuyển sang profile khác: kết nối backend cũ không còn, nên dừng thao tác đang chạy và bỏ con trỏ. */
  const detach = useCallback(() => {
    runRef.current?.abort();
    fetchRef.current?.abort();
    runRef.current = null;
    fetchRef.current = null;
    cursorRef.current = null;
    setRunning(false);
    setLoadingMore(false);
    setFetchAll(false);
  }, []);

  const loadMore = useCallback(async () => {
    const cursorId = cursorRef.current;
    if (cursorId === null || fetchRef.current) return;

    const controller = new AbortController();
    fetchRef.current = controller;
    setLoadingMore(true);
    try {
      const page = await callIPC(FetchRows, [{ tabId, cursorId, all: false }], { signal: controller.signal });
      if (controller.signal.aborted) return;

      const done = page?.done ?? true;
      if (done) cursorRef.current = null;
      updateLastStatement(last => ({
        ...last,
        rows: page ? [...last.rows, ...page.rows] : last.rows,
        done,
        cursorId: done ? null : last.cursorId,
      }));
    } finally {
      if (fetchRef.current === controller) {
        fetchRef.current = null;
        setLoadingMore(false);
      }
    }
  }, [tabId, updateLastStatement]);

  const fetchAllRows = useCallback(async () => {
    const cursorId = cursorRef.current;
    if (cursorId === null || fetchRef.current) return;

    const controller = new AbortController();
    fetchRef.current = controller;
    setLoadingMore(true);
    const streamStartedAt = performance.now();
    let streamedRows = 0;
    try {
      const completed = await streamCursorRows(tabId, cursorId, controller.signal, page => {
        if (controller.signal.aborted) return;
        streamedRows += page.rows.length;
        if (page.done) cursorRef.current = null;
        updateLastStatement(last => ({
          ...last,
          rows: [...last.rows, ...page.rows],
          done: page.done,
          cursorId: page.done ? null : last.cursorId,
        }));
      });
      console.info('SQL Fetch All stream completed', {
        duration_ms: Math.round(performance.now() - streamStartedAt),
        rows: streamedRows,
        outcome: controller.signal.aborted ? 'cancelled' : completed ? 'completed' : 'incomplete',
      });
      if (controller.signal.aborted) return;
      if (!completed) {
        cursorRef.current = null;
        updateLastStatement(last => ({ ...last, done: true, cursorId: null }));
      }
    } catch (error) {
      console.info('SQL Fetch All stream completed', {
        duration_ms: Math.round(performance.now() - streamStartedAt),
        rows: streamedRows,
        outcome: controller.signal.aborted ? 'cancelled' : 'failed',
      });
      if (!controller.signal.aborted) {
        toast.error(i18n.t('ipcMessage:common.CME001'), {
          description: error instanceof Error ? error.message : String(error),
        });
        cursorRef.current = null;
        updateLastStatement(last => ({ ...last, done: true, cursorId: null }));
      }
    } finally {
      if (fetchRef.current === controller) {
        fetchRef.current = null;
        setLoadingMore(false);
      }
    }
  }, [tabId, updateLastStatement]);

  const setFetchAllRows = useCallback(
    (checked: boolean) => {
      setFetchAll(checked);
      if (checked) {
        void fetchAllRows();
        return;
      }
      if (!fetchRef.current) return;
      fetchRef.current.abort();
      fetchRef.current = null;
      cursorRef.current = null;
      setLoadingMore(false);
      updateLastStatement(last => ({ ...last, done: true, cursorId: null }));
    },
    [fetchAllRows, updateLastStatement]
  );

  return { ...state, running, loadingMore, fetchAll, run, cancel, detach, loadMore, setFetchAllRows };
}
