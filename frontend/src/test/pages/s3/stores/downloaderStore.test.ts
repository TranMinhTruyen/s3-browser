import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidateLoads } from '@/common/utils/ipcUtils';
import { selectDownloadingIds, useDownloaderStore } from '@/pages/s3/stores/downloaderStore';

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
    state().setDownloadProgressBatch([{ downloadId: 'd1', downloaded: 5, total: 10 }] as never);
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

  it('setDownloadProgressBatch ignores unknown items', () => {
    const before = state().downloadItems;
    state().setDownloadProgressBatch([{ downloadId: 'ghost', downloaded: 1, total: 2 }] as never);
    expect(state().downloadItems).toEqual({});
    expect(state().downloadItems).toBe(before);
  });

  it('setDownloadProgressBatch applies many items with a single store write', () => {
    state().upsertDownloadItems([history({ id: 'd1' }), history({ id: 'd2' })]);
    const listener = vi.fn();
    const stop = useDownloaderStore.subscribe(listener);

    state().setDownloadProgressBatch([
      { downloadId: 'd1', downloaded: 1, total: 10 },
      { downloadId: 'ghost', downloaded: 9, total: 9 },
      { downloadId: 'd2', downloaded: 2, total: 20 },
    ] as never);
    stop();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(state().downloadItems.d1).toMatchObject({ downloaded: 1, total: 10 });
    expect(state().downloadItems.d2).toMatchObject({ downloaded: 2, total: 20 });
  });

  it('setDownloadProgressBatch keeps the state reference when nothing changed', () => {
    state().upsertDownloadItems([history({})]);
    state().setDownloadProgressBatch([{ downloadId: 'd1', downloaded: 5, total: 10 }] as never);
    const before = state().downloadItems;
    const item = state().downloadItems.d1;

    state().setDownloadProgressBatch([{ downloadId: 'd1', downloaded: 5, total: 10 }] as never);

    expect(state().downloadItems).toBe(before);
    expect(state().downloadItems.d1).toBe(item);
  });

  it('setDownloadProgressBatch updates only the field that changed', () => {
    state().upsertDownloadItems([history({})]);
    state().setDownloadProgressBatch([{ downloadId: 'd1', downloaded: 5, total: 10 }] as never);
    state().setDownloadProgressBatch([{ downloadId: 'd1', downloaded: 5, total: 12 }] as never);
    expect(state().downloadItems.d1).toMatchObject({ downloaded: 5, total: 12 });
    state().setDownloadProgressBatch([{ downloadId: 'd1', downloaded: 7, total: 12 }] as never);
    expect(state().downloadItems.d1).toMatchObject({ downloaded: 7, total: 12 });
  });

  it('selectDownloadingIds returns only the downloading ones', () => {
    state().upsertDownloadItems([history({}), history({ id: 'd2', status: 'DOWNLOADING' })]);
    expect(selectDownloadingIds(state())).toEqual(['d2']);
  });

  it('downloadingIds does not duplicate an id upserted twice', () => {
    state().upsertDownloadItems([history({ status: 'DOWNLOADING', version: 1 })]);
    state().upsertDownloadItems([history({ status: 'DOWNLOADING', version: 2 })]);
    expect(state().downloadingIds).toEqual(['d1']);
  });

  it.each(['DONE', 'FAILED', 'CANCELLED'])('downloadingIds drops an id when the status becomes %s', status => {
    state().upsertDownloadItems([history({ id: 'a', status: 'DOWNLOADING', version: 1 })]);
    state().upsertDownloadItems([history({ id: 'b', status: 'DOWNLOADING', version: 1 })]);
    state().upsertDownloadItems([history({ id: 'a', status, version: 2 })]);
    expect(state().downloadingIds).toEqual(['b']);
  });

  it('downloadingIds drops every id when all downloads are cancelled', () => {
    state().upsertDownloadItems([
      history({ id: 'a', status: 'DOWNLOADING', version: 1 }),
      history({ id: 'b', status: 'DOWNLOADING', version: 1 }),
    ]);
    state().upsertDownloadItems([
      history({ id: 'a', status: 'CANCELLED', version: 2 }),
      history({ id: 'b', status: 'CANCELLED', version: 2 }),
    ]);
    expect(state().downloadingIds).toEqual([]);
  });

  it('downloadingIds ignores an older version', () => {
    state().upsertDownloadItems([history({ status: 'DOWNLOADING', version: 2 })]);
    state().upsertDownloadItems([history({ status: 'DONE', version: 1 })]);
    expect(state().downloadingIds).toEqual(['d1']);

    state().upsertDownloadItems([history({ id: 'd2', status: 'DONE', version: 2 })]);
    state().upsertDownloadItems([history({ id: 'd2', status: 'DOWNLOADING', version: 1 })]);
    expect(state().downloadingIds).toEqual(['d1']);
  });

  it('selectDownloadingIds keeps the same reference until the list changes', () => {
    state().upsertDownloadItems([history({ status: 'DOWNLOADING', version: 1 })]);
    const before = selectDownloadingIds(state());

    state().setDownloadProgressBatch([{ downloadId: 'd1', downloaded: 3, total: 9 }] as never);
    state().upsertDownloadItems([history({ status: 'DOWNLOADING', version: 2 })]);
    expect(selectDownloadingIds(state())).toBe(before);

    state().upsertDownloadItems([history({ status: 'DONE', version: 3 })]);
    expect(selectDownloadingIds(state())).not.toBe(before);
  });

  it('reset restores the state and invalidates the scope', () => {
    state().openWindow();
    state().upsertDownloadItems([history({ status: 'DOWNLOADING' })]);
    state().reset();
    expect(state().windowVisible).toBe(false);
    expect(state().downloadingIds).toEqual([]);
    expect(state().downloadItems).toEqual({});
    expect(invalidateLoads).toHaveBeenCalledWith('downloader');
  });
});
