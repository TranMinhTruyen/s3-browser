import { useSettingStore } from '@/common/stores/settingStore';
import { restoreTabsFromDisk } from '@/pages/s3/utils/tabPersistence';

/**
 * Loads what the first render needs, in parallel: settings (so the UI never flashes the wrong theme, font or
 * language) and the saved tab layout. Neither rejects: failed settings keep the defaults, and a failed tab
 * restore keeps the default tab and disables saving (see `isTabRestoreFailed`), so tabs.json is not overwritten.
 * Profiles are loaded later by `App`, once the toaster is mounted.
 */
export async function loadStartupData(): Promise<void> {
  await Promise.all([useSettingStore.getState().load(), restoreTabsFromDisk()]);
}
