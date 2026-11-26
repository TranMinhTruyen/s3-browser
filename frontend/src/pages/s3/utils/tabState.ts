import type { TabState } from '@wails/S3Browser/models/setting';

/** Tạo bố cục tab đã lưu từ các cặp `[tabId, profileId]`. Store và hook tự lưu cùng sử dụng hàm này. */
export const buildTabState = (activeTab: string, tabs: [string, string | null | undefined][]): TabState => ({
  tabs: tabs.map(([id, profileId]) => ({ id, profileId: profileId ?? null })),
  activeTab,
});
