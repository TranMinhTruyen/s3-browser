import { useTabListStore } from '@/pages/s3/stores/tabListStore';

/**
 * Trả về true nếu tab vẫn tồn tại nhưng không hoạt động, nghĩa là nội dung chỉ bị ẩn (React `Activity`).
 * Cleanup của effect dùng để phân biệt "bị ẩn" (giữ state và yêu cầu) với việc unmount thật sự (dọn dữ liệu).
 */
export function isTabHidden(tabId: string): boolean {
  const { tabList, activeTab } = useTabListStore.getState();
  return !!tabList[tabId] && activeTab !== tabId;
}

/**
 * Tạo hàm cleanup của effect, chỉ chạy `fn` khi view của tab bị gỡ hẳn.
 * Tab bị ẩn (React `Activity`) cũng chạy cleanup nên hoãn `fn` cho đến khi tab đóng;
 * nếu tab được hiện lại thì kết thúc thời gian chờ mà không chạy `fn`.
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
