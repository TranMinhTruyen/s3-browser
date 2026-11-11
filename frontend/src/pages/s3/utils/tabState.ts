import type { TabState } from '@wails/S3Browser/models/setting';

/** Builds the saved tab layout from `[tabId, profileId]` pairs. Shared by the store and the auto-save hook. */
export const buildTabState = (activeTab: string, tabs: [string, string | null | undefined][]): TabState => ({
  tabs: tabs.map(([id, profileId]) => ({ id, profileId: profileId ?? null })),
  activeTab,
});
