import { GetTabState, SaveTabState } from '@wails/S3Browser/internal/handlers/settinghandler';
import type { TabState } from '@wails/S3Browser/models/setting';
import { callIPC } from '@/common/utils/ipcUtils';
import { useProfileStore } from '@/pages/s3/stores/profileStore';
import { useTabListStore } from '@/pages/s3/stores/tabListStore';

/**
 * Lưu, khôi phục các tab đang mở (tabs.json) và dọn các tab có profile đã bị xóa.
 * Mọi lời gọi đều im lặng: lỗi không hiện toast, chỉ tắt chức năng lưu khi việc ghi đè có thể làm mất dữ liệu.
 */

let restoreFailed = false;

/** Trả về true nếu không đọc được bố cục đã lưu; khi đó tắt chức năng lưu để không ghi đè tabs.json. */
export const isTabRestoreFailed = (): boolean => restoreFailed;

/**
 * Tải và áp dụng bố cục tab đã lưu. Trả về false nếu tải thất bại (giữ tab mặc định và tắt lưu trong phiên này);
 * file không tồn tại hoặc rỗng vẫn được xem là thành công.
 */
export async function restoreTabsFromDisk(): Promise<boolean> {
  const saved = await callIPC(GetTabState, [], { showMessage: false });
  restoreFailed = !saved;
  if (!saved) return false;
  useTabListStore.getState().restoreTabs(saved);
  return true;
}

/** Lưu bố cục tab ở chế độ nền; lỗi không hiện thông báo. */
export async function saveTabState(state: TabState): Promise<void> {
  await callIPC(SaveTabState, [state], { showMessage: false });
}

/** Tab có profile không còn tồn tại vẫn giữ nguyên vị trí nhưng bỏ liên kết đến profile đó. */
export function normalizeTabProfiles(profileIds: string[]): void {
  const { tabList, clearProfile } = useTabListStore.getState();
  const known = new Set(profileIds);
  const missing = new Set(Object.values(tabList).map(tab => tab.profileId));
  missing.forEach(id => {
    if (id && !known.has(id)) clearProfile(id);
  });
}

/**
 * Tải profile vào store (lỗi tải sẽ hiện toast), sau đó bỏ các profile đã xóa khỏi tab.
 * Nếu tải thất bại thì giữ nguyên các tab. Hàm không bao giờ reject.
 */
export async function normalizeTabProfilesFromDisk(): Promise<void> {
  const { loadConnectionProfiles } = useProfileStore.getState();
  if (await loadConnectionProfiles()) {
    normalizeTabProfiles(Object.keys(useProfileStore.getState().connectionProfiles));
  }
}
