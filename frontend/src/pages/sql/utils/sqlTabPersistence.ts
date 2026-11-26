import { GetTabState, SaveSqlTabState } from '@wails/S3Browser/internal/handlers/settinghandler';
import type { SaveSqlTabStateInput } from '@wails/S3Browser/models/setting';
import { callIPC } from '@/common/utils/ipcUtils';
import { useSqlTabStore } from '@/pages/sql/stores/sqlTabStore';

let restoreFailed = false;
let saveChain: Promise<void> = Promise.resolve();

/** Tải bố cục SQL đã lưu; lỗi sẽ tắt lưu trong phiên để tránh ghi đè dữ liệu trên đĩa. */
export async function restoreSqlTabsFromDisk(): Promise<boolean> {
  const saved = await callIPC(GetTabState, [], { showMessage: false });
  restoreFailed = !saved;
  if (!saved) return false;
  useSqlTabStore.getState().restoreTabs(saved);
  return true;
}

/** Lưu bố cục SQL ở chế độ nền; lỗi không hiện thông báo. */
export function saveSqlTabState(state: SaveSqlTabStateInput): Promise<void> {
  saveChain = saveChain
    .then(() => callIPC(SaveSqlTabState, [state], { showMessage: false }).then(() => undefined))
    .catch(() => undefined);
  return saveChain;
}

/** Tab có profile đã xóa vẫn giữ nguyên nhưng bỏ liên kết đến profile đó. */
export function normalizeSqlTabProfiles(profileIds: string[]): boolean {
  const { tabList, clearProfile } = useSqlTabStore.getState();
  const known = new Set(profileIds);
  const missing = new Set(Object.values(tabList).map(tab => tab.profileId));
  let changed = false;
  missing.forEach(id => {
    if (id && !known.has(id)) {
      clearProfile(id);
      changed = true;
    }
  });
  return changed;
}

/** Trả về true nếu không đọc được bố cục; khi đó không được phép ghi đè file tab. */
export const isSqlTabRestoreFailed = (): boolean => restoreFailed;
