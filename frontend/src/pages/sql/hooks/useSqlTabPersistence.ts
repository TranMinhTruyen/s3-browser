import type { SaveSqlTabStateInput } from '@wails/S3Browser/models/setting';
import { useEffect } from 'react';
import { useSqlTabStore } from '@/pages/sql/stores/sqlTabStore';
import { isSqlTabRestoreFailed, saveSqlTabState } from '@/pages/sql/utils/sqlTabPersistence';

const SAVE_DELAY_MS = 500;

/** Lưu bố cục và câu SQL sau khi ngừng thay đổi 500ms, hoặc khi cửa sổ sắp đóng. */
export function useSqlTabPersistence(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    let pending: SaveSqlTabStateInput | null = null;
    let lastSaved: string | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      if (isSqlTabRestoreFailed() || pending === null) return;
      const state = pending;
      pending = null;
      const payload = JSON.stringify(state);
      if (payload === lastSaved) return;
      lastSaved = payload;
      void saveSqlTabState(state);
    };

    const schedule = () => {
      pending = useSqlTabStore.getState().serializeTabs();
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(flush, SAVE_DELAY_MS);
    };

    const unsubscribe = useSqlTabStore.subscribe((state, previous) => {
      if (
        state.activeTab !== previous.activeTab ||
        state.tabList !== previous.tabList ||
        state.queryByTab !== previous.queryByTab
      ) {
        schedule();
      }
    });

    window.addEventListener('pagehide', flush);
    return () => {
      if (timer !== null) clearTimeout(timer);
      unsubscribe();
      window.removeEventListener('pagehide', flush);
    };
  }, [enabled]);
}
