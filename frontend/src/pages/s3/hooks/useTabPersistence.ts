import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useTabListStore } from '@/pages/s3/stores/tabListStore';
import { isTabRestoreFailed, saveTabState } from '@/pages/s3/utils/tabPersistence';
import { buildTabState } from '@/pages/s3/utils/tabState';

const SAVE_DELAY_MS = 500;

type TabListState = ReturnType<typeof useTabListStore.getState>;

/** Danh sách phẳng `[activeTab, id1, profileId1, id2, profileId2, ...]`: shallow-equal trừ khi bố cục đã lưu thay đổi. */
const selectLayout = (s: TabListState): (string | null)[] => [
  s.activeTab,
  ...Object.entries(s.tabList).flatMap(([id, tab]) => [id, tab.profileId ?? null]),
];

/** Dựng lại bố cục đã lưu từ danh sách phẳng rồi tuần tự hóa. */
const toPayload = (layout: (string | null)[]): string => {
  const [activeTab, ...rest] = layout as [string, ...(string | null)[]];
  const tabs: [string, string | null][] = [];
  for (let i = 0; i < rest.length; i += 2) tabs.push([rest[i] as string, rest[i + 1] ?? null]);
  return JSON.stringify(buildTabState(activeTab, tabs));
};

/**
 * Lưu thứ tự tab, tab đang hoạt động và profile sau 500ms kể từ khi chúng ngừng thay đổi, hoặc ngay khi `pagehide`.
 * Không lưu nếu không tải được bố cục đã lưu (`isTabRestoreFailed`) để không ghi đè tabs.json.
 * Chỉ gọi sau khi đã khôi phục bố cục đã lưu, nếu không tabs.json sẽ bị ghi đè bằng tab mặc định.
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
    // Payload đầu tiên vừa được khôi phục (hoặc là tab mặc định): dữ liệu đó đã có trên đĩa.
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
