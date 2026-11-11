import { UploadObject } from '@wails/S3Browser/internal/handlers/buckethandler';
import { DroppedFile, DroppedGroup } from '@wails/S3Browser/models/bucket';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callIPC } from '@/common/utils/ipcUtils';
import { useTabListStore } from '@/pages/s3/stores/tabListStore';
import {
  ensureUploadIdle,
  mergePickedFiles,
  type PickerLimits,
  type PickerList,
  removePickedFiles,
  runUpload,
} from '@/pages/s3/utils/uploadUtils';

vi.mock('sonner', () => ({ toast: { warning: vi.fn() } }));
vi.mock('@/locales/i18n', () => ({ default: { t: (key: string) => key } }));
vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn() }));
vi.mock('@wails/S3Browser/internal/handlers/buckethandler', () => ({ UploadObject: vi.fn() }));

const uploading = () => useTabListStore.getState().uploadingTabId;

describe('ensureUploadIdle', () => {
  beforeEach(() => {
    useTabListStore.setState({ uploadingTabId: null });
  });

  it('returns true without a warning when no upload is running', () => {
    expect(ensureUploadIdle()).toBe(true);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('warns S3W005 and returns false while an upload is running', () => {
    useTabListStore.setState({ uploadingTabId: 'other' });
    expect(ensureUploadIdle()).toBe(false);
    expect(toast.warning).toHaveBeenCalledExactlyOnceWith('ipcMessage:bucket.S3W005');
  });
});

describe('runUpload', () => {
  const params = {
    tabId: 't1',
    connectionId: 'c1',
    profileName: 'Prof',
    bucket: 'b',
    prefix: 'dir/',
    files: [
      { path: '/a/x.txt', relKey: 'x.txt' },
      { path: '/a/y.txt', relKey: 'y.txt', extra: 1 },
    ],
  };

  beforeEach(() => {
    useTabListStore.setState({ uploadingTabId: null });
    vi.mocked(callIPC).mockResolvedValue({} as never);
  });

  it('does nothing and warns when another upload is running', async () => {
    useTabListStore.setState({ uploadingTabId: 'other' });
    const onDone = vi.fn();
    await runUpload(params, onDone);
    expect(callIPC).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledWith('ipcMessage:bucket.S3W005');
    expect(uploading()).toBe('other');
  });

  it('marks the tab while uploading, sends only path/relKey, runs onDone while marked, then resets', async () => {
    let markedInIPC: string | null = null;
    let markedInDone: string | null = null;
    vi.mocked(callIPC).mockImplementation((async () => {
      markedInIPC = uploading();
      return {};
    }) as never);
    await runUpload(params, () => {
      markedInDone = uploading();
    });
    expect(callIPC).toHaveBeenCalledExactlyOnceWith(UploadObject, [
      {
        connectionId: 'c1',
        profileName: 'Prof',
        bucket: 'b',
        prefix: 'dir/',
        objList: [
          { path: '/a/x.txt', relKey: 'x.txt' },
          { path: '/a/y.txt', relKey: 'y.txt' },
        ],
      },
    ]);
    expect(markedInIPC).toBe('t1');
    expect(markedInDone).toBe('t1');
    expect(uploading()).toBeNull();
  });

  it('works without onDone and with an empty prefix', async () => {
    await runUpload({ ...params, prefix: '' });
    expect(vi.mocked(callIPC).mock.calls[0][1]).toEqual([expect.objectContaining({ prefix: '' })]);
    expect(uploading()).toBeNull();
  });

  it('still runs onDone and resets when callIPC returns null', async () => {
    vi.mocked(callIPC).mockResolvedValue(null as never);
    const onDone = vi.fn();
    await runUpload(params, onDone);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(uploading()).toBeNull();
  });

  it('resets the marker when callIPC throws', async () => {
    vi.mocked(callIPC).mockRejectedValue(new Error('boom'));
    await expect(runUpload(params)).rejects.toThrow('boom');
    expect(uploading()).toBeNull();
  });

  it('resets the marker when onDone throws', async () => {
    await expect(
      runUpload(params, () => {
        throw new Error('refresh failed');
      })
    ).rejects.toThrow('refresh failed');
    expect(uploading()).toBeNull();
  });
});

describe('mergePickedFiles', () => {
  const limits: PickerLimits = { maxFilesPerFolder: 2, largeFileMaxCount: 1, maxTotalFiles: 5 };
  const file = (path: string, isLarge = false) => new DroppedFile({ path, relKey: path, size: 1, isLarge });
  const group = (name: string, files: DroppedFile[]) =>
    new DroppedGroup({
      name,
      files,
      totalFiles: files.length,
      largeCount: 0,
      overMaxFiles: false,
      overLargeCount: false,
    });
  const empty: PickerList = { groups: [], selected: new Set() };
  const paths = (list: PickerList) => list.groups.map(g => [g.name, g.files.map(f => f.path)]);

  it('ticks new files in order until the group is full and flags autoUnselected', () => {
    const r = mergePickedFiles(empty, [group('', [file('a'), file('b'), file('c')])], limits);
    expect([...r.selected]).toEqual(['a', 'b']);
    expect(r.autoUnselected).toBe(true);
    expect(r.overTotal).toBe(false);
    expect(r.groups[0]).toMatchObject({
      name: '',
      totalFiles: 3,
      largeCount: 0,
      overMaxFiles: true,
      overLargeCount: false,
    });
  });

  it('limits ticked large files per group and computes group flags', () => {
    const r = mergePickedFiles(empty, [group('g', [file('l1', true), file('l2', true), file('n1')])], limits);
    expect([...r.selected]).toEqual(['l1', 'n1']);
    expect(r.autoUnselected).toBe(true);
    expect(r.groups[0]).toMatchObject({ largeCount: 2, overLargeCount: true, overMaxFiles: true });
  });

  it('does not flag autoUnselected when everything fits', () => {
    const r = mergePickedFiles(empty, [group('g', [file('a', true), file('b')])], limits);
    expect([...r.selected]).toEqual(['a', 'b']);
    expect(r.autoUnselected).toBe(false);
    expect(r.groups[0]).toMatchObject({ largeCount: 1, overMaxFiles: false, overLargeCount: false });
  });

  it('skips duplicate paths, merges same-name groups and counts previously ticked files', () => {
    const first = mergePickedFiles(empty, [group('g', [file('a', true), file('b')])], limits);
    // b is unticked: only a (large) is ticked, so one more file fits but no more large ones.
    const prev: PickerList = { groups: first.groups, selected: new Set(['a']) };
    const r = mergePickedFiles(
      prev,
      [group('g', [file('a'), file('c', true), file('d')]), group('h', [file('e')])],
      limits
    );
    expect(paths(r)).toEqual([
      ['g', ['a', 'b', 'c', 'd']],
      ['h', ['e']],
    ]);
    expect([...r.selected].sort()).toEqual(['a', 'd', 'e']);
    expect(r.autoUnselected).toBe(true);
  });

  it('caps the list at maxTotalFiles and flags overTotal', () => {
    const r = mergePickedFiles(
      empty,
      [group('a', [file('1'), file('2')]), group('b', [file('3'), file('4')]), group('c', [file('5'), file('6')])],
      limits
    );
    expect(r.groups.flatMap(g => g.files).map(f => f.path)).toEqual(['1', '2', '3', '4', '5']);
    expect(r.overTotal).toBe(true);
  });

  it('does not mutate the previous list', () => {
    const prev = mergePickedFiles(empty, [group('g', [file('a')])], limits);
    const snapshot = [...prev.selected];
    mergePickedFiles(prev, [group('g', [file('b')])], limits);
    expect([...prev.selected]).toEqual(snapshot);
    expect(prev.groups[0].files).toHaveLength(1);
  });

  it('merges many files into one group without mutating the input', () => {
    const maxed: PickerLimits = { maxFilesPerFolder: 5000, largeFileMaxCount: 5, maxTotalFiles: 5000 };
    const base = mergePickedFiles(empty, [group('g', [file('seed')])], maxed);
    const baseFiles = [...base.groups[0].files];
    const incomingFiles = Array.from({ length: 1000 }, (_, i) => file(`f${i}`));
    const incoming = [group('g', incomingFiles)];

    const r = mergePickedFiles(base, incoming, maxed);

    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].files).toHaveLength(1001);
    expect(r.groups[0].files[0].path).toBe('seed');
    expect(r.groups[0].files[1000].path).toBe('f999');
    expect(r.groups[0]).toMatchObject({ totalFiles: 1001, overMaxFiles: false });
    expect(r.selected.size).toBe(1001);
    expect(r.autoUnselected).toBe(false);
    // Neither the previous list nor the incoming group changed.
    expect(base.groups[0].files).toEqual(baseFiles);
    expect(base.groups[0].files).not.toBe(r.groups[0].files);
    expect(incoming[0].files).toBe(incomingFiles);
    expect(incomingFiles).toHaveLength(1000);
    expect(base.selected.size).toBe(1);
  });
});

describe('removePickedFiles', () => {
  const file = (path: string, isLarge = false) => new DroppedFile({ path, relKey: path, size: 1, isLarge });
  const group = (name: string, files: DroppedFile[]) =>
    new DroppedGroup({
      name,
      files,
      totalFiles: files.length,
      largeCount: files.filter(f => f.isLarge).length,
      overMaxFiles: true,
      overLargeCount: true,
    });
  const build = (): PickerList => ({
    groups: [group('g', [file('a'), file('b', true), file('c', true)]), group('h', [file('d')])],
    selected: new Set(['a', 'b', 'd']),
  });
  const paths = (list: PickerList) => list.groups.map(g => [g.name, g.files.map(f => f.path)]);

  it('removes one path from its group and from the ticks', () => {
    const r = removePickedFiles(build(), ['a']);
    expect(paths(r)).toEqual([
      ['g', ['b', 'c']],
      ['h', ['d']],
    ]);
    expect([...r.selected]).toEqual(['b', 'd']);
  });

  it('removes several paths across groups', () => {
    const r = removePickedFiles(build(), ['a', 'c', 'd']);
    expect(paths(r)).toEqual([['g', ['b']]]);
    expect([...r.selected]).toEqual(['b']);
  });

  it('keeps the same content when the path is not in the list', () => {
    const prev = build();
    const r = removePickedFiles(prev, ['zzz']);
    expect(paths(r)).toEqual(paths(prev));
    expect([...r.selected]).toEqual([...prev.selected]);
  });

  it('does nothing for an empty path list', () => {
    const prev = build();
    const r = removePickedFiles(prev, []);
    expect(paths(r)).toEqual(paths(prev));
    expect(r.selected.size).toBe(3);
  });

  it('drops a group when all its files are removed', () => {
    const r = removePickedFiles(build(), ['d']);
    expect(r.groups.map(g => g.name)).toEqual(['g']);
  });

  it('returns an empty list when everything is removed', () => {
    const r = removePickedFiles(build(), ['a', 'b', 'c', 'd']);
    expect(r.groups).toEqual([]);
    expect(r.selected.size).toBe(0);
  });

  it('recomputes totalFiles and largeCount', () => {
    const r = removePickedFiles(build(), ['b']);
    expect(r.groups[0]).toMatchObject({ name: 'g', totalFiles: 2, largeCount: 1 });
    const r2 = removePickedFiles(build(), ['b', 'c']);
    expect(r2.groups[0]).toMatchObject({ totalFiles: 1, largeCount: 0 });
  });

  it('keeps the ticks of the files that stay', () => {
    const r = removePickedFiles(build(), ['c']);
    expect([...r.selected].sort()).toEqual(['a', 'b', 'd']);
  });

  it('does not mutate the input', () => {
    const prev = build();
    const before = JSON.stringify(prev.groups);
    removePickedFiles(prev, ['a', 'b']);
    expect(JSON.stringify(prev.groups)).toBe(before);
    expect([...prev.selected]).toEqual(['a', 'b', 'd']);
    expect(prev.groups[0].files).toHaveLength(3);
  });
});
