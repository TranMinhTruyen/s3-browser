import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import i18n from '@/locales/i18n';
import type { Provider } from '@/pages/sql/stores/dbProfileStore';
import { fetchTableRows, openTableRows, streamCursorRows } from '@/pages/sql/utils/dbObjectSource';

type RowsState = { columns: string[]; rows: (string | null)[][]; hasMore: boolean; loading: boolean };

const INITIAL_STATE: RowsState = { columns: [], rows: [], hasMore: false, loading: true };

/**
 * Các hàng của một bảng, được tải theo từng trang. State được lưu ở đây thay vì zustand store: bảng có thể có hơn
 * 100.000 hàng và immer sẽ sao chép, đóng băng chúng sau mỗi trang. Trang đầu tải khi mount; nếu tải thất bại thì không hiện hàng.
 * `resetKey` thay đổi theo bảng (và tab), nhờ đó state của từng bảng có thể được reset.
 */
export function useTableRows(tabId: string, provider: Provider, profileId: string, schema: string, table: string) {
  const [state, setState] = useState<RowsState>(INITIAL_STATE);
  const [loadingMore, setLoadingMore] = useState(false);
  const [fetchAll, setFetchAll] = useState(false);
  // Được tăng bởi `refresh` để tải lại trang đầu.
  const [reloadCount, setReloadCount] = useState(0);
  const key = `${tabId}|${provider}|${profileId}|${schema}|${table}`;
  const [stateKey, setStateKey] = useState(key);
  // Bảng khác bắt đầu từ đầu (điều chỉnh state ngay trong lúc render để không hiển thị hàng cũ).
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
    // Hàm dọn dẹp bên dưới đã hủy các lượt tải của bảng trước.
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
    // reloadCount chỉ chạy lại thao tác tải khi được refresh.
  }, [tabId, provider, profileId, schema, table, reloadCount]);

  /** Đọc trang tiếp theo, hoặc toàn bộ hàng còn lại nếu `all`; không làm gì khi đang tải hoặc đã đọc hết. */
  const fetchPage = useCallback(
    async (all: boolean) => {
      const cursorId = cursorRef.current;
      if (cursorId === null || fetchRef.current) return;

      const controller = new AbortController();
      fetchRef.current = controller;
      setLoadingMore(true);
      const measureStream = all && provider === 'sqlite';
      const streamStartedAt = measureStream ? performance.now() : 0;
      let streamedRows = 0;
      try {
        if (measureStream) {
          const completed = await streamCursorRows(tabId, cursorId, controller.signal, page => {
            if (controller.signal.aborted) return;
            streamedRows += page.rows.length;
            loadedRef.current += page.rows.length;
            if (page.done) cursorRef.current = null;
            setState(prev => ({
              ...prev,
              rows: [...prev.rows, ...page.rows],
              hasMore: !page.done,
            }));
          });
          console.info('fetch all stream completed', {
            duration_ms: Math.round(performance.now() - streamStartedAt),
            rows: streamedRows,
            outcome: controller.signal.aborted ? 'cancelled' : completed ? 'completed' : 'incomplete',
          });
          if (controller.signal.aborted) return;
          if (!completed) {
            cursorRef.current = null;
            setState(prev => ({ ...prev, hasMore: false }));
          }
          return;
        }

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

        // Nếu tải thất bại thì con trỏ không còn dùng được, vì vậy grid ngừng yêu cầu thêm dữ liệu.
        const done = page?.done ?? true;
        if (done) cursorRef.current = null;
        loadedRef.current += page?.rows.length ?? 0;
        setState(prev => ({
          ...prev,
          rows: page ? [...prev.rows, ...page.rows] : prev.rows,
          hasMore: !done,
        }));
      } catch (error) {
        if (measureStream) {
          console.info('fetch all stream completed', {
            duration_ms: Math.round(performance.now() - streamStartedAt),
            rows: streamedRows,
            outcome: controller.signal.aborted ? 'cancelled' : 'failed',
          });
        }
        if (!controller.signal.aborted) {
          toast.error(i18n.t('ipcMessage:common.CME001'), {
            description: error instanceof Error ? error.message : String(error),
          });
          if (all) {
            cursorRef.current = null;
            setState(prev => ({ ...prev, hasMore: false }));
          }
        }
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
   * Đánh dấu sẽ đọc toàn bộ phần còn lại của con trỏ trong một lần gọi. Bỏ đánh dấu khi đang chạy sẽ hủy thao tác và giữ
   * các hàng đã tải; lượt đọc bị hủy có thể đã tiêu thụ một phần con trỏ nên sau đó không thể tải thêm hàng.
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

  /** Tải lại trang đầu và bỏ chọn tải tất cả; hàm dọn dẹp của effect tải sẽ hủy lượt đọc đang chạy. */
  const refresh = useCallback(() => {
    setState(INITIAL_STATE);
    setLoadingMore(false);
    setFetchAll(false);
    setReloadCount(count => count + 1);
  }, []);

  return { ...state, loadingMore, fetchAll, loadMore, setFetchAllRows, refresh, resetKey: key };
}
