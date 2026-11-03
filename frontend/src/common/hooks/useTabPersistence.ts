import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useTabListStore } from '@/common/stores/tabListStore';
import { isTabRestoreFailed, saveTabState } from '@/common/utils/tabPersistence';
import { buildTabState } from '@/common/utils/tabState';

const SAVE_DELAY_MS = 500;

type TabListState = ReturnType<typeof useTabListStore.getState>;

/** Flat list `[activeTab, id1, profileId1, id2, profileId2, ...]`: shallow-equal unless the saved layout changes. */
const selectLayout = (s: TabListState): (string | null)[] => [
  s.activeTab,
  ...Object.entries(s.tabList).flatMap(([id, tab]) => [id, tab.profileId ?? null]),
];

/** Rebuilds the saved layout from the flat list and serializes it. */
const toPayload = (layout: (string | null)[]): string => {
  const [activeTab, ...rest] = layout as [string, ...(string | null)[]];
  const tabs: [string, string | null][] = [];
  for (let i = 0; i < rest.length; i += 2) tabs.push([rest[i] as string, rest[i + 1] ?? null]);
  return JSON.stringify(buildTabState(activeTab, tabs));
};

/**
 * Saves the tab order, active tab and profiles 500ms after they stop changing, and right away on `pagehide`.
 * Nothing is saved when the saved layout failed to load (`isTabRestoreFailed`), so tabs.json is never overwritten.
 * Call after the saved layout was restored, otherwise tabs.json would be overwritten by the default tab.
 */
export function useTabPersistence(): void {
  const layout = useTabListStore(useShallow(selectLayout));
  const payload = useMemo(() => toPayload(layout), [layout]);
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
