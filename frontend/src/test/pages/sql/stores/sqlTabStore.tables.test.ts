import { CloseDbTab } from '@wails/S3Browser/internal/handlers/dbhandler';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callIPC } from '@/common/utils/ipcUtils';
import { useSqlTabStore } from '@/pages/sql/stores/sqlTabStore';

vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));
vi.mock('@wails/S3Browser/internal/handlers/dbhandler', () => ({ CloseDbTab: vi.fn() }));

const store = () => useSqlTabStore.getState();
const ids = () => Object.keys(store().tabList);
const callIPCMock = vi.mocked(callIPC);

/** ID của tab được mở gần nhất (tab đó trở thành tab đang hoạt động). */
const open = (profileId: string, schema: string, name: string) => {
  store().openTableTab(profileId, schema, name);
  return store().activeTab;
};

describe('sqlTabStore table tabs', () => {
  beforeEach(() => {
    store().reset();
    vi.clearAllMocks();
  });

  describe('openTableTab', () => {
    it('adds a TableStructure tab after the existing ones and activates it', () => {
      const [sql] = ids();
      const tab = open('p1', 'main', 'users');

      expect(ids()).toEqual([sql, tab]);
      expect(store().activeTab).toBe(tab);
      expect(store().tabList[tab]).toEqual({ profileId: 'p1', table: { schema: 'main', name: 'users' } });
    });

    it('switches to the tab that already shows the table instead of adding another', () => {
      const first = open('p1', 'main', 'users');
      open('p1', 'main', 'orders');

      store().openTableTab('p1', 'main', 'users');

      expect(ids()).toHaveLength(3);
      expect(store().activeTab).toBe(first);
    });

    it.each([
      ['another profile', 'p2', 'main', 'users'],
      ['another schema', 'p1', 'other', 'users'],
      ['another table', 'p1', 'main', 'orders'],
    ])('opens a new tab for %s', (_name, profileId, schema, name) => {
      open('p1', 'main', 'users');
      open(profileId, schema, name);
      expect(ids()).toHaveLength(3);
    });

    it('does not mistake a SQL tab of the same profile for a table tab', () => {
      store().setTabProfile(store().activeTab, 'p1');
      open('p1', 'main', 'users');
      expect(ids()).toHaveLength(2);
    });
  });

  describe('closeProfileTables', () => {
    it('does nothing when the profile has no table tab', () => {
      store().setTabProfile(store().activeTab, 'p1');
      open('p2', 'main', 'users');
      const before = store().tabList;

      store().closeProfileTables('p1');

      expect(store().tabList).toBe(before);
      expect(callIPCMock).not.toHaveBeenCalled();
    });

    it('closes the table tabs of the profile, keeps the others and tells the backend for each', () => {
      const [sql] = ids();
      const a = open('p1', 'main', 'a');
      const b = open('p1', 'main', 'b');
      const other = open('p2', 'main', 'c');

      store().closeProfileTables('p1');

      expect(ids()).toEqual([sql, other]);
      expect(store().activeTab).toBe(other);
      expect(callIPCMock).toHaveBeenCalledTimes(2);
      expect(callIPCMock).toHaveBeenCalledWith(CloseDbTab, [{ tabId: a }]);
      expect(callIPCMock).toHaveBeenCalledWith(CloseDbTab, [{ tabId: b }]);
    });

    it('keeps the SQL tab that uses the profile', () => {
      const [sql] = ids();
      store().setTabProfile(sql, 'p1');
      open('p1', 'main', 'a');

      store().closeProfileTables('p1');

      expect(ids()).toEqual([sql]);
      expect(store().tabList[sql].profileId).toBe('p1');
      expect(store().activeTab).toBe(sql);
    });

    it('keeps the active tab when it is not closed', () => {
      const [sql] = ids();
      open('p1', 'main', 'a');
      store().setActiveTab(sql);

      store().closeProfileTables('p1');

      expect(store().activeTab).toBe(sql);
    });

    it('moves the active tab to the next tab that stays', () => {
      const [sql] = ids();
      const a = open('p1', 'main', 'a');
      const other = open('p2', 'main', 'b');
      store().setActiveTab(a);

      store().closeProfileTables('p1');

      expect(ids()).toEqual([sql, other]);
      expect(store().activeTab).toBe(other);
    });

    it('falls back to the previous tab that stays when none is after', () => {
      const [sql] = ids();
      const other = open('p2', 'main', 'b');
      open('p1', 'main', 'a');

      store().closeProfileTables('p1');

      expect(ids()).toEqual([sql, other]);
      expect(store().activeTab).toBe(other);
    });

    it('adds a SQL tab and activates it when only table tabs would be left', () => {
      const [sql] = ids();
      const a = open('p1', 'main', 'a');
      store().closeTab(sql);
      expect(ids()).toEqual([a]);

      store().closeProfileTables('p1');

      expect(ids()).toHaveLength(1);
      const [fresh] = ids();
      expect(fresh).not.toBe(a);
      expect(store().tabList[fresh]).toEqual({ profileId: null });
      expect(store().activeTab).toBe(fresh);
    });

    it('adds a SQL tab but keeps the active tab on the neighbour that stays when only table tabs remain', () => {
      const [sql] = ids();
      const other = open('p2', 'main', 'b');
      const a = open('p1', 'main', 'a');
      store().closeTab(sql);
      callIPCMock.mockClear();

      store().closeProfileTables('p1');

      const tabs = Object.entries(store().tabList);
      expect(tabs.map(([key]) => key)).toHaveLength(2);
      expect(store().tabList[a]).toBeUndefined();
      expect(tabs.filter(([, tab]) => !tab.table)).toHaveLength(1);
      expect(store().activeTab).toBe(other);
    });
  });

  describe('existing behavior with table tabs', () => {
    it('closeTab closes a table tab, moves the active tab and tells the backend', () => {
      const [sql] = ids();
      const tab = open('p1', 'main', 'a');

      store().closeTab(tab);

      expect(ids()).toEqual([sql]);
      expect(store().activeTab).toBe(sql);
      expect(callIPCMock).toHaveBeenCalledWith(CloseDbTab, [{ tabId: tab }]);
    });

    it('moveTab reorders table tabs like any other tab', () => {
      const [sql] = ids();
      const a = open('p1', 'main', 'a');
      const b = open('p1', 'main', 'b');

      store().moveTab(b, sql);

      expect(ids()).toEqual([b, sql, a]);
      expect(store().tabList[b].table).toEqual({ schema: 'main', name: 'b' });
    });

    it('clearProfile also unlinks the table tabs of the profile', () => {
      const tab = open('p1', 'main', 'a');
      store().clearProfile('p1');
      expect(store().tabList[tab].profileId).toBeNull();
    });

    it('setTabProfile closes the backend connection only when the profile really changes', () => {
      const [sql] = ids();
      store().setTabProfile(sql, 'p1');
      expect(callIPCMock).not.toHaveBeenCalled();
      store().setTabProfile(sql, 'p1');
      expect(callIPCMock).not.toHaveBeenCalled();
      store().setTabProfile(sql, 'p2');
      expect(callIPCMock).toHaveBeenCalledWith(CloseDbTab, [{ tabId: sql }]);
    });
  });
});
