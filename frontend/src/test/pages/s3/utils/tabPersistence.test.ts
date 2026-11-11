import { GetTabState, SaveTabState } from '@wails/S3Browser/internal/handlers/settinghandler';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callIPC } from '@/common/utils/ipcUtils';
import { useProfileStore } from '@/pages/s3/stores/profileStore';
import { useTabListStore } from '@/pages/s3/stores/tabListStore';
import {
  isTabRestoreFailed,
  normalizeTabProfiles,
  normalizeTabProfilesFromDisk,
  restoreTabsFromDisk,
  saveTabState,
} from '@/pages/s3/utils/tabPersistence';

vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));
vi.mock('@wails/S3Browser/internal/handlers/settinghandler', () => ({ GetTabState: vi.fn(), SaveTabState: vi.fn() }));
vi.mock('@wails/S3Browser/internal/handlers/profilehandler', () => ({ GetAllConnectionProfile: vi.fn() }));

const callIPCMock = vi.mocked(callIPC);
const tabs = () => useTabListStore.getState();

const setTabs = (list: Record<string, string | null>) => {
  const tabList = Object.fromEntries(
    Object.entries(list).map(([id, profileId]) => [
      id,
      { profileId, currentView: 'objectList', bucket: 'b', prefix: 'x/', selectionItem: {}, deletingItems: {} },
    ])
  );
  useTabListStore.setState({ tabList: tabList as never, activeTab: Object.keys(list)[0] });
};

describe('tabPersistence', () => {
  beforeEach(() => {
    tabs().reset();
    useProfileStore.setState({ connectionProfiles: {} });
    vi.clearAllMocks();
  });

  describe('restoreTabsFromDisk', () => {
    it('applies the saved layout silently and reports success', async () => {
      callIPCMock.mockResolvedValueOnce({ tabs: [{ id: 'a', profileId: 'p1' }], activeTab: 'a' });
      await expect(restoreTabsFromDisk()).resolves.toBe(true);
      expect(callIPCMock).toHaveBeenCalledWith(GetTabState, [], { showMessage: false });
      expect(Object.keys(tabs().tabList)).toEqual(['a']);
      expect(tabs().tabList.a.profileId).toBe('p1');
      expect(isTabRestoreFailed()).toBe(false);
    });

    it('treats an empty saved layout as success and still applies it', async () => {
      const restoreTabs = vi.spyOn(tabs(), 'restoreTabs');
      useTabListStore.setState({ restoreTabs });
      callIPCMock.mockResolvedValueOnce({ tabs: [], activeTab: '' });
      await expect(restoreTabsFromDisk()).resolves.toBe(true);
      expect(restoreTabs).toHaveBeenCalledWith({ tabs: [], activeTab: '' });
      expect(isTabRestoreFailed()).toBe(false);
    });

    it('keeps the default tab, reports failure and flags the restore when the load fails', async () => {
      const restoreTabs = vi.fn();
      useTabListStore.setState({ restoreTabs });
      const before = tabs().serializeTabs();
      callIPCMock.mockResolvedValueOnce(null);
      await expect(restoreTabsFromDisk()).resolves.toBe(false);
      expect(restoreTabs).not.toHaveBeenCalled();
      expect(tabs().serializeTabs()).toEqual(before);
      expect(isTabRestoreFailed()).toBe(true);
    });

    it('clears the failed flag after a later successful restore', async () => {
      callIPCMock.mockResolvedValueOnce(null);
      await restoreTabsFromDisk();
      expect(isTabRestoreFailed()).toBe(true);
      callIPCMock.mockResolvedValueOnce({ tabs: [{ id: 'a', profileId: null }], activeTab: 'a' });
      await restoreTabsFromDisk();
      expect(isTabRestoreFailed()).toBe(false);
    });
  });

  it('saveTabState sends the state silently', async () => {
    const state = { tabs: [{ id: 'a', profileId: null }], activeTab: 'a' };
    await saveTabState(state);
    expect(callIPCMock).toHaveBeenCalledWith(SaveTabState, [state], { showMessage: false });
  });

  describe('normalizeTabProfiles', () => {
    it('clears only profiles that no longer exist', () => {
      setTabs({ a: 'gone', b: 'p1', c: null, d: 'gone' });
      normalizeTabProfiles(['p1']);
      expect(tabs().tabList.a).toMatchObject({ profileId: null, currentView: 'bucketList', prefix: '' });
      expect(tabs().tabList.d.profileId).toBeNull();
      expect(tabs().tabList.b).toMatchObject({ profileId: 'p1', currentView: 'objectList' });
      expect(tabs().tabList.c.profileId).toBeNull();
    });

    it('does nothing when every profile exists', () => {
      setTabs({ a: 'p1' });
      normalizeTabProfiles(['p1']);
      expect(tabs().tabList.a.currentView).toBe('objectList');
    });
  });

  describe('normalizeTabProfilesFromDisk', () => {
    it('clears deleted profiles after a successful load', async () => {
      setTabs({ a: 'gone', b: 'p1' });
      useProfileStore.setState({
        loadConnectionProfiles: vi.fn(async () => {
          useProfileStore.setState({ connectionProfiles: { p1: { id: 'p1' } as never } });
          return true;
        }),
      });
      await normalizeTabProfilesFromDisk();
      expect(tabs().tabList.a.profileId).toBeNull();
      expect(tabs().tabList.b.profileId).toBe('p1');
    });

    it('leaves the tabs alone when loading fails', async () => {
      setTabs({ a: 'p1' });
      useProfileStore.setState({ loadConnectionProfiles: vi.fn(async () => false) });
      await normalizeTabProfilesFromDisk();
      expect(tabs().tabList.a.profileId).toBe('p1');
    });
  });
});
