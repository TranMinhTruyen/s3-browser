import { GetSettings, GetTabState } from '@wails/S3Browser/internal/handlers/settinghandler';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/common/cnst/settingConst';
import { useSettingStore } from '@/common/stores/settingStore';
import { useTabListStore } from '@/common/stores/tabListStore';
import { callIPC } from '@/common/utils/ipcUtils';
import { loadStartupData } from '@/common/utils/startup';
import { isTabRestoreFailed } from '@/common/utils/tabPersistence';

vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));
vi.mock('@/common/utils/settingUtils', async importOriginal => ({
  ...(await importOriginal<typeof import('@/common/utils/settingUtils')>()),
  applySettings: vi.fn(),
}));
vi.mock('@wails/S3Browser/internal/handlers/settinghandler', () => ({
  GetSettings: vi.fn(),
  GetTabState: vi.fn(),
  SaveSettings: vi.fn(),
  SaveTabState: vi.fn(),
}));

const callIPCMock = vi.mocked(callIPC);
const dark = { theme: 'dark', font: 'arial', language: 'vi', launchOnStartup: true } as const;

/** Resolves each backend call by binding. */
const backend = (results: { settings: unknown; tabs: unknown }) =>
  callIPCMock.mockImplementation((async (binding: unknown) =>
    binding === GetSettings ? results.settings : results.tabs) as never);

describe('loadStartupData', () => {
  beforeEach(() => {
    useSettingStore.getState().reset();
    useTabListStore.getState().reset();
  });

  it('loads the settings and restores the saved tabs', async () => {
    backend({
      settings: { settings: dark, autostartSupported: true },
      tabs: { tabs: [{ id: 'saved', profileId: 'p1' }], activeTab: 'saved' },
    });

    await loadStartupData();

    expect(useSettingStore.getState().saved).toEqual(dark);
    expect(Object.keys(useTabListStore.getState().tabList)).toEqual(['saved']);
    expect(useTabListStore.getState().activeTab).toBe('saved');
    expect(isTabRestoreFailed()).toBe(false);
  });

  it('keeps the default tab and marks the restore failed when GetTabState fails, without rejecting', async () => {
    const before = Object.keys(useTabListStore.getState().tabList);
    backend({ settings: { settings: dark, autostartSupported: false }, tabs: null });

    await expect(loadStartupData()).resolves.toBeUndefined();

    expect(isTabRestoreFailed()).toBe(true);
    expect(Object.keys(useTabListStore.getState().tabList)).toEqual(before);
    expect(useSettingStore.getState().saved).toEqual(dark);
  });

  it('uses the default settings when the settings call fails, and still restores the tabs', async () => {
    backend({ settings: null, tabs: { tabs: [{ id: 'saved', profileId: null }], activeTab: 'saved' } });

    await expect(loadStartupData()).resolves.toBeUndefined();

    expect(useSettingStore.getState().saved).toEqual(DEFAULT_SETTINGS);
    expect(Object.keys(useTabListStore.getState().tabList)).toEqual(['saved']);
    expect(isTabRestoreFailed()).toBe(false);
  });

  it('starts both loads before either of them finishes', async () => {
    const pending: Record<string, (v: unknown) => void> = {};
    callIPCMock.mockImplementation(
      ((binding: unknown) =>
        new Promise(resolve => {
          pending[binding === GetSettings ? 'settings' : 'tabs'] = resolve;
        })) as never
    );

    const done = loadStartupData();

    expect(callIPCMock).toHaveBeenCalledTimes(2);
    expect(callIPCMock.mock.calls.map(c => c[0])).toEqual(expect.arrayContaining([GetSettings, GetTabState]));

    let finished = false;
    void done.then(() => {
      finished = true;
    });
    pending.tabs({ tabs: [{ id: 'saved', profileId: null }], activeTab: 'saved' });
    await Promise.resolve();
    await Promise.resolve();
    expect(finished).toBe(false);

    pending.settings({ settings: dark, autostartSupported: true });
    await done;

    expect(useSettingStore.getState().saved).toEqual(dark);
    expect(Object.keys(useTabListStore.getState().tabList)).toEqual(['saved']);
  });
});
