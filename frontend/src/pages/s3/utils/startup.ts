import { useSettingStore } from '@/common/stores/settingStore';
import { installDropTargetCleanup } from '@/pages/s3/utils/dropTargetUtils';
import { restoreTabsFromDisk } from '@/pages/s3/utils/tabPersistence';

/**
 * Prepares what the first render needs: drop-target cleanup, then settings (so the UI never flashes the wrong
 * theme, font or language) and the saved tab layout, loaded in parallel. Neither load rejects: failed settings
 * keep the defaults, and a failed tab restore keeps the default tab and disables saving (see
 * `isTabRestoreFailed`), so tabs.json is not overwritten. Profiles are loaded later by `App`.
 */
export async function loadStartupData(): Promise<void> {
  installDropTargetCleanup();
  await Promise.all([useSettingStore.getState().load(), restoreTabsFromDisk()]);
}
