import { beforeEach, describe, expect, it, vi } from 'vitest';
import { selectDownloadingIds, useDownloaderStore } from '@/common/stores/downloaderStore';
import { invalidateLoads } from '@/common/utils/ipcUtils';

vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));

const state = () => useDownloaderStore.getState();
const history = (over: object) => ({ id: 'd1', status: 'PENDING', ...over }) as never;

describe('downloaderStore', () => {
  beforeEach(() => {
    state().reset();
    vi.clearAllMocks();
  });

  it('opens and closes the window', () => {
    state().openWindow();
    expect(state().windowVisible).toBe(true);
    state().closeWindow();
    expect(state().windowVisible).toBe(false);
  });

  it('setWindowSize ignores an unchanged size', () => {
    const before = state().windowSize;
    state().setWindowSize({ width: 0, height: 0 });
    expect(state().windowSize).toBe(before);
    state().setWindowSize({ width: 0, height: 5 });
    state().setWindowSize({ width: 4, height: 5 });
    expect(state().windowSize).toEqual({ width: 4, height: 5 });
  });

  it('upsertDownloadItems adds an item with zero progress', () => {
    state().upsertDownloadItems([history({ version: 1 })]);
    expect(state().downloadItems.d1).toMatchObject({ downloadId: 'd1', downloaded: 0, total: 0 });
  });

  it('upsertDownloadItems keeps progress and skips older versions', () => {
    state().upsertDownloadItems([history({ version: 2 })]);
    state().setDownloadProgess({ downloadId: 'd1', downloaded: 5, total: 10 } as never);
    state().upsertDownloadItems([history({ version: 1, status: 'OLD' })]);
    expect(state().downloadItems.d1.status).toBe('PENDING');

    state().upsertDownloadItems([history({ version: 3, status: 'DONE' })]);
    expect(state().downloadItems.d1).toMatchObject({ status: 'DONE', downloaded: 5, total: 10 });
  });

  it('upsertDownloadItems treats a missing version as 0', () => {
    state().upsertDownloadItems([history({})]);
    state().upsertDownloadItems([history({ status: 'NEW' })]);
    expect(state().downloadItems.d1.status).toBe('NEW');

    state().upsertDownloadItems([history({ version: 1 })]);
    state().upsertDownloadItems([history({ version: undefined, status: 'OLD' })]);
    expect(state().downloadItems.d1.status).toBe('PENDING');
  });

  it('setDownloadProgess ignores unknown items', () => {
    state().setDownloadProgess({ downloadId: 'ghost', downloaded: 1, total: 2 } as never);
    expect(state().downloadItems).toEqual({});
  });

  it('selectDownloadingIds returns only the downloading ones', () => {
    state().upsertDownloadItems([history({}), history({ id: 'd2', status: 'DOWNLOADING' })]);
    expect(selectDownloadingIds(state())).toEqual(['d2']);
  });

  it('reset restores the state and invalidates the scope', () => {
    state().openWindow();
    state().reset();
    expect(state().windowVisible).toBe(false);
    expect(invalidateLoads).toHaveBeenCalledWith('downloader');
  });
});
