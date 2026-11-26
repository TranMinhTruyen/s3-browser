import { useSettingStore } from '@/common/stores/settingStore';
import { installDropTargetCleanup } from '@/pages/s3/utils/dropTargetUtils';
import { restoreTabsFromDisk } from '@/pages/s3/utils/tabPersistence';

/**
 * Chuẩn bị dữ liệu cần cho lần render đầu: dọn vùng thả, rồi tải thiết lập (để giao diện không lóe sai theme,
 * phông chữ hoặc ngôn ngữ) và bố cục tab đã lưu song song. Cả hai thao tác tải đều không reject: nếu tải thiết lập
 * thất bại thì giữ mặc định; nếu khôi phục tab thất bại thì giữ tab mặc định và tắt lưu (xem `isTabRestoreFailed`)
 * để không ghi đè tabs.json. `App` sẽ tải profile sau.
 */
export async function loadStartupData(): Promise<void> {
  installDropTargetCleanup();
  await Promise.all([useSettingStore.getState().load(), restoreTabsFromDisk()]);
}
