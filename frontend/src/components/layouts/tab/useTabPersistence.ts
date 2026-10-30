import { useCallback, useEffect, useRef } from 'react';
import { useTabListStore } from '@/common/stores/tabListStore';
import { isTabRestoreFailed, saveTabState } from '@/common/utils/tabPersistence';

const SAVE_DELAY_MS = 500;

/** Selector returning a stable string, so the hook only re-renders when the saved layout changes. */
const selectPayload = (s: ReturnType<typeof useTabListStore.getState>) => JSON.stringify(s.serializeTabs());

/**
 * Saves the tab order, active tab and profiles 500ms after they stop changing, and right away on `pagehide`.
 * Nothing is saved when the saved layout failed to load (`isTabRestoreFailed`), so tabs.json is never overwritten.
 * Call after the saved layout was restored, otherwise tabs.json would be overwritten by the default tab.
 */
export function useTabPersistence(): void {
  const payload = useTabListStore(selectPayload);
  const lastSaved = useRef<string | null>(null);
  const pending = useRef<string | null>(null);

  const flush = useCallback(() => {
    if (isTabRestoreFailed() || pending.current === null || pending.current === lastSaved.current) return;
    lastSaved.current = pending.current;
    saveTabState(JSON.parse(pending.current));
  }, []);

  useEffect(() => {
    // The first payload is what was just restored (or the default tab): it is already on disk.
    if (lastSaved.current === null) {
      lastSaved.current = payload;
      return;
    }
    pending.current = payload;
    const timer = setTimeout(flush, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [payload, flush]);

  useEffect(() => {
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [flush]);
}
