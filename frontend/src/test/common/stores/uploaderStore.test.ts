import { beforeEach, describe, expect, it, vi } from 'vitest';
import { selectUploadingIds, useUploaderStore } from '@/common/stores/uploaderStore';
import { invalidateLoads } from '@/common/utils/ipcUtils';

vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));

const state = () => useUploaderStore.getState();
const started = (uploadId: string) => ({ uploadId, total: 10 }) as never;

describe('uploaderStore', () => {
  beforeEach(() => {
    state().reset();
    vi.clearAllMocks();
  });

  it('startUpload adds an item and ignores an already finished id', () => {
    state().startUpload(started('u1'));
    expect(state().uploadItems.u1).toMatchObject({ uploaded: 0, total: 10 });

    state().finishUpload({ uploadId: 'u1' } as never);
    state().startUpload(started('u1'));
    expect(state().uploadItems).toEqual({});
  });

  it('setUploadProgressBatch overwrites the total only when positive', () => {
    state().startUpload(started('u1'));
    state().setUploadProgressBatch([{ uploadId: 'u1', uploaded: 3, total: 20 }] as never);
    expect(state().uploadItems.u1).toMatchObject({ uploaded: 3, total: 20 });
    state().setUploadProgressBatch([{ uploadId: 'u1', uploaded: 4, total: 0 }] as never);
    expect(state().uploadItems.u1).toMatchObject({ uploaded: 4, total: 20 });
  });

  it('setUploadProgressBatch ignores unknown items', () => {
    state().setUploadProgressBatch([{ uploadId: 'ghost', uploaded: 1, total: 1 }] as never);
    expect(state().uploadItems).toEqual({});
  });

  it('setUploadProgressBatch applies many items with a single store write', () => {
    state().startUpload(started('u1'));
    state().startUpload(started('u2'));
    const listener = vi.fn();
    const stop = useUploaderStore.subscribe(listener);

    state().setUploadProgressBatch([
      { uploadId: 'u1', uploaded: 1, total: 10 },
      { uploadId: 'ghost', uploaded: 9, total: 9 },
      { uploadId: 'u2', uploaded: 2, total: 10 },
    ] as never);
    stop();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(state().uploadItems.u1.uploaded).toBe(1);
    expect(state().uploadItems.u2.uploaded).toBe(2);
  });

  it('setUploadProgressBatch keeps the state reference when nothing changed', () => {
    state().startUpload(started('u1'));
    state().setUploadProgressBatch([{ uploadId: 'u1', uploaded: 3, total: 10 }] as never);
    const before = state().uploadItems;

    state().setUploadProgressBatch([{ uploadId: 'u1', uploaded: 3, total: 10 }] as never);
    state().setUploadProgressBatch([{ uploadId: 'u1', uploaded: 3, total: 0 }] as never);

    expect(state().uploadItems).toBe(before);
  });

  it('finishUpload bounds the finished ids', () => {
    for (let i = 0; i < 205; i++) state().finishUpload({ uploadId: `f${i}` } as never);
    expect(state().finishedIds).toHaveLength(200);
    expect(state().finishedIds[0]).toBe('f5');
  });

  it('selectUploadingIds lists the running uploads', () => {
    state().startUpload(started('u1'));
    expect(selectUploadingIds(state())).toEqual(['u1']);
  });

  it('reset invalidates the scope', () => {
    state().finishUpload({ uploadId: 'x' } as never);
    state().reset();
    expect(state().finishedIds).toEqual([]);
    expect(invalidateLoads).toHaveBeenCalledWith('uploader');
  });
});
