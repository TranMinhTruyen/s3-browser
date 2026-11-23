import { CloseDbTab } from '@wails/S3Browser/internal/handlers/dbhandler';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callIPC } from '@/common/utils/ipcUtils';
import ConfirmModal from '@/components/modals/confirm/ConfirmModal';
import { useSqlTabStore } from '@/pages/sql/stores/sqlTabStore';
import { setTableDirty } from '@/pages/sql/utils/dirtyTables';

vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));
vi.mock('@wails/S3Browser/internal/handlers/dbhandler', () => ({ CloseDbTab: vi.fn() }));
vi.mock('@/components/modals/confirm/ConfirmModal', () => ({ default: { show: vi.fn() } }));

const store = () => useSqlTabStore.getState();
const ids = () => Object.keys(store().tabList);
const confirmMock = vi.mocked(ConfirmModal.show);
const callIPCMock = vi.mocked(callIPC);

/** A table tab with uncommitted changes, plus the first SQL tab. */
const openDirty = () => {
  store().openTableTab('p1', 'main', 'users');
  const tab = store().activeTab as string;
  setTableDirty(tab, true);
  return tab;
};

describe('sqlTabStore closeTab with uncommitted row changes', () => {
  let dirtyTab: string | null = null;

  beforeEach(() => {
    store().reset();
    vi.clearAllMocks();
    dirtyTab = null;
  });

  afterEach(() => {
    if (dirtyTab) setTableDirty(dirtyTab, false);
  });

  it('asks first and keeps the tab until the question is answered', async () => {
    let answer!: (value: boolean) => void;
    confirmMock.mockReturnValue(new Promise<boolean>(r => (answer = r)) as never);
    const tab = (dirtyTab = openDirty());

    store().closeTab(tab);

    expect(confirmMock).toHaveBeenCalledWith({ type: 'warning', confirmCode: 'C000012', params: { table: 'users' } });
    expect(ids()).toContain(tab);
    expect(callIPCMock).not.toHaveBeenCalled();

    answer(true);
    await vi.waitFor(() => expect(ids()).not.toContain(tab));
    expect(callIPCMock).toHaveBeenCalledWith(CloseDbTab, [{ tabId: tab }]);
  });

  it('closes the tab, activates the neighbour and closes the connection when confirmed', async () => {
    confirmMock.mockResolvedValue(true as never);
    const [sql] = ids();
    const tab = (dirtyTab = openDirty());

    store().closeTab(tab);

    await vi.waitFor(() => expect(ids()).toEqual([sql]));
    expect(store().activeTab).toBe(sql);
    expect(callIPCMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the tab, the active tab and the connection when declined', async () => {
    confirmMock.mockResolvedValue(false as never);
    const tab = (dirtyTab = openDirty());

    store().closeTab(tab);
    await vi.waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
    await Promise.resolve();

    expect(ids()).toContain(tab);
    expect(store().activeTab).toBe(tab);
    expect(callIPCMock).not.toHaveBeenCalled();
  });

  it('does nothing when the tab was already closed while the question was open', async () => {
    let answer!: (value: boolean) => void;
    confirmMock.mockReturnValue(new Promise<boolean>(r => (answer = r)) as never);
    const tab = (dirtyTab = openDirty());

    store().closeTab(tab);
    store().closeProfileTables('p1');
    callIPCMock.mockClear();
    answer(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(callIPCMock).not.toHaveBeenCalled();
    expect(ids()).not.toContain(tab);
  });

  it('closes a clean tab at once without asking (as before)', () => {
    const [sql] = ids();
    store().openTableTab('p1', 'main', 'clean');
    const tab = store().activeTab as string;

    store().closeTab(tab);

    expect(confirmMock).not.toHaveBeenCalled();
    expect(ids()).toEqual([sql]);
    expect(callIPCMock).toHaveBeenCalledWith(CloseDbTab, [{ tabId: tab }]);
  });

  it('does not ask for the last tab or an unknown tab, even when marked dirty', () => {
    const [only] = ids();
    setTableDirty(only, true);
    setTableDirty('nope', true);
    store().closeTab(only);
    store().closeTab('nope');
    expect(confirmMock).not.toHaveBeenCalled();
    expect(ids()).toEqual([only]);
    setTableDirty(only, false);
    setTableDirty('nope', false);
  });

  it('a dirty SQL tab without a table asks with an undefined table name', async () => {
    confirmMock.mockResolvedValue(false as never);
    store().addTab();
    const tab = (dirtyTab = store().activeTab as string);
    setTableDirty(tab, true);

    store().closeTab(tab);

    expect(confirmMock).toHaveBeenCalledWith({ type: 'warning', confirmCode: 'C000012', params: { table: undefined } });
    await Promise.resolve();
  });
});
