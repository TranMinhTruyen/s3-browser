import { GetTabState, SaveTabState } from '@wails/S3Browser/internal/handlers/settinghandler';
import type { TabState } from '@wails/S3Browser/models/setting';
import { callIPC } from '@/common/utils/ipcUtils';
import { useProfileStore } from '@/pages/s3/stores/profileStore';
import { useTabListStore } from '@/pages/s3/stores/tabListStore';

/**
 * Saving and restoring of the open tabs (tabs.json) and cleanup of tabs whose profile was deleted.
 * Every call is silent: failures never toast, they only disable saving where overwriting would lose data.
 */

let restoreFailed = false;

/** True when the saved layout could not be read; saving is then disabled so tabs.json is never overwritten. */
export const isTabRestoreFailed = (): boolean => restoreFailed;

/**
 * Loads the saved tab layout and applies it. Returns false if the load failed (the default tab is kept
 * and saving is disabled for this session); a missing or empty file counts as success.
 */
export async function restoreTabsFromDisk(): Promise<boolean> {
  const saved = await callIPC(GetTabState, [], { showMessage: false });
  restoreFailed = !saved;
  if (!saved) return false;
  useTabListStore.getState().restoreTabs(saved);
  return true;
}

/** Saves the tab layout in the background; failures are silent. */
export async function saveTabState(state: TabState): Promise<void> {
  await callIPC(SaveTabState, [state], { showMessage: false });
}

/** Tabs whose profile no longer exists keep their place but lose the profile. */
export function normalizeTabProfiles(profileIds: string[]): void {
  const { tabList, clearProfile } = useTabListStore.getState();
  const known = new Set(profileIds);
  const missing = new Set(Object.values(tabList).map(tab => tab.profileId));
  missing.forEach(id => {
    if (id && !known.has(id)) clearProfile(id);
  });
}

/**
 * Loads the profiles into the profile store (a load error is toasted), then clears the deleted ones from the tabs.
 * If loading fails the tabs are left as they are. Never rejects.
 */
export async function normalizeTabProfilesFromDisk(): Promise<void> {
  const { loadConnectionProfiles } = useProfileStore.getState();
  if (await loadConnectionProfiles()) {
    normalizeTabProfiles(Object.keys(useProfileStore.getState().connectionProfiles));
  }
}
