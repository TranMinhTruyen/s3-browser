import { useTabListStore } from '@/common/stores/tabListStore';

/**
 * True when the tab still exists but is not the active one, i.e. its content is only hidden (React `Activity`).
 * Effect cleanups use it to tell "hidden" (keep state and requests) from a real unmount (clean up).
 */
export function isTabHidden(tabId: string): boolean {
  const { tabList, activeTab } = useTabListStore.getState();
  return !!tabList[tabId] && activeTab !== tabId;
}

/**
 * Builds an effect cleanup that runs `fn` when the tab's view goes away for good.
 * A hidden tab (React `Activity`) runs its cleanups too, so there `fn` is deferred until the tab is closed;
 * the wait ends without running `fn` as soon as the tab is shown again.
 */
export function onTabGone(tabId: string, fn: () => void): () => void {
  return () => {
    if (!isTabHidden(tabId)) return fn();
    const unsubscribe = useTabListStore.subscribe(({ tabList, activeTab }) => {
      if (tabList[tabId] && activeTab !== tabId) return;
      unsubscribe();
      if (!tabList[tabId]) fn();
    });
  };
}
