import { act, renderHook } from '@testing-library/react';
import { Events } from '@wailsio/runtime';
import { Activity, type ReactNode } from 'react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFilesDroppedUpload } from '@/common/hooks/useFilesDroppedUpload';
import { useTabListStore } from '@/common/stores/tabListStore';
import { ensureUploadIdle, runUpload } from '@/common/utils/uploadUtils';
import { showUploadLimitModal } from '@/components/modals/lazyModals';
import i18n from '@/locales/i18n';

vi.mock('sonner', () => ({ toast: { warning: vi.fn() } }));
vi.mock('@/common/utils/uploadUtils', () => ({ ensureUploadIdle: vi.fn(), runUpload: vi.fn() }));
vi.mock('@/components/modals/lazyModals', () => ({ showUploadLimitModal: vi.fn() }));

type Params = Parameters<typeof useFilesDroppedUpload>[0];
type Handler = (e: { data?: unknown }) => void;

const file = { path: 'C:/x.txt', relKey: 'x.txt' };
const drop = (patch: Record<string, unknown> = {}) => ({
  tabId: 'tab-1',
  groups: [{ files: [file] }],
  skipped: 0,
  overMaxTotal: false,
  capped: false,
  ...patch,
});

const unsubscribe = vi.fn();
const onRefresh = vi.fn();
const baseParams = (patch: Partial<Params> = {}): Params => ({
  tabId: 'tab-1',
  connectionId: 'conn',
  profileName: 'prof',
  bucket: 'bkt',
  prefix: 'dir/',
  onRefresh,
  ...patch,
});
const setup = (patch: Partial<Params> = {}) =>
  renderHook(p => useFilesDroppedUpload(p), { initialProps: baseParams(patch) });
const handler = () => vi.mocked(Events.On).mock.calls.at(-1)![1] as unknown as Handler;
const send = (data: unknown) => act(async () => handler()({ data }));

describe('useFilesDroppedUpload', () => {
  beforeEach(() => {
    vi.mocked(Events.On).mockReturnValue(unsubscribe);
    vi.mocked(ensureUploadIdle).mockReturnValue(true);
    vi.mocked(runUpload).mockResolvedValue(undefined);
    onRefresh.mockResolvedValue(undefined);
  });

  it('listens to the drop event and unsubscribes on unmount', () => {
    const { unmount } = setup();
    expect(Events.On).toHaveBeenCalledExactlyOnceWith('uploader:files-dropped', expect.any(Function));
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['without data', undefined],
    ['for another tab', drop({ tabId: 'tab-2' })],
  ])('ignores an event %s', async (_name, data) => {
    setup();
    await send(data);
    expect(runUpload).not.toHaveBeenCalled();
  });

  it.each([
    ['connection', { connectionId: undefined }],
    ['bucket', { bucket: undefined }],
  ])('ignores a drop when there is no %s', async (_name, patch) => {
    setup(patch);
    await send(drop({ skipped: 1 }));
    expect(toast.warning).not.toHaveBeenCalled();
    expect(runUpload).not.toHaveBeenCalled();
  });

  it('uploads the dropped files into the current folder', async () => {
    setup();
    await send(drop());
    expect(toast.warning).not.toHaveBeenCalled();
    expect(showUploadLimitModal).not.toHaveBeenCalled();
    expect(runUpload).toHaveBeenCalledExactlyOnceWith(
      { tabId: 'tab-1', connectionId: 'conn', profileName: 'prof', bucket: 'bkt', prefix: 'dir/', files: [file] },
      expect.any(Function)
    );
  });

  it('merges the files of all groups', async () => {
    const other = { path: 'C:/y.txt', relKey: 'y.txt' };
    setup();
    await send(drop({ groups: [{ files: [file] }, { files: [other] }] }));
    expect(vi.mocked(runUpload).mock.calls[0][0].files).toEqual([file, other]);
  });

  it('warns about skipped items and about exceeding the total max, then uploads the rest', async () => {
    setup();
    await send(drop({ skipped: 3, overMaxTotal: true, maxTotalFiles: 100 }));
    expect(toast.warning).toHaveBeenCalledTimes(2);
    expect(toast.warning).toHaveBeenNthCalledWith(1, expect.stringContaining('3'));
    expect(toast.warning).toHaveBeenNthCalledWith(2, expect.stringContaining('100'));
    expect(runUpload).toHaveBeenCalledTimes(1);
  });

  it('uploads nothing when no file is left', async () => {
    setup();
    await send(drop({ groups: [{ files: [] }] }));
    expect(ensureUploadIdle).not.toHaveBeenCalled();
    expect(runUpload).not.toHaveBeenCalled();
  });

  it('uploads nothing when another upload is running', async () => {
    vi.mocked(ensureUploadIdle).mockReturnValue(false);
    setup();
    await send(drop());
    expect(runUpload).not.toHaveBeenCalled();
  });

  it('warns about capped files and still uploads', async () => {
    setup();
    await send(drop({ capped: true }));
    expect(toast.warning).toHaveBeenCalledExactlyOnceWith(i18n.t('uploadLimitModal:cappedWarning'));
    expect(runUpload).toHaveBeenCalledTimes(1);
  });

  describe('over a limit', () => {
    const limits = { maxFilesPerFolder: 5, largeFileSize: 10, largeFileMaxCount: 2 };

    it.each([
      ['overMaxFiles', { files: [file], overMaxFiles: true }],
      ['overLargeCount', { files: [file], overLargeCount: true }],
    ])('asks the user to choose files when a group has %s and uploads the chosen ones', async (_name, group) => {
      const chosen = [{ path: 'C:/z.txt', relKey: 'z.txt' }];
      vi.mocked(showUploadLimitModal).mockResolvedValue(chosen as never);
      setup();
      await send(drop({ groups: [group], capped: true, ...limits }));

      expect(showUploadLimitModal).toHaveBeenCalledExactlyOnceWith({
        groups: [group],
        capped: true,
        ...limits,
      });
      // The modal replaces the capped warning.
      expect(toast.warning).not.toHaveBeenCalled();
      expect(vi.mocked(runUpload).mock.calls[0][0].files).toEqual(chosen);
    });

    it.each([
      ['cancelled or failed to load (undefined)', undefined],
      ['empty', []],
    ])('uploads nothing when the dialog is %s', async (_name, chosen) => {
      vi.mocked(showUploadLimitModal).mockResolvedValue(chosen as never);
      setup();
      await send(drop({ groups: [{ files: [file], overMaxFiles: true }] }));
      expect(runUpload).not.toHaveBeenCalled();
    });
  });

  describe('after the upload', () => {
    const runDone = async () => {
      await send(drop());
      return vi.mocked(runUpload).mock.calls[0][1]!;
    };

    it('refreshes the list', async () => {
      setup();
      const done = await runDone();
      await done();
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it('refreshes through the latest onRefresh', async () => {
      const latest = vi.fn().mockResolvedValue(undefined);
      const { rerender } = setup();
      const done = await runDone();
      rerender(baseParams({ onRefresh: latest }));
      await done();
      expect(latest).toHaveBeenCalledTimes(1);
      expect(onRefresh).not.toHaveBeenCalled();
    });

    it('does not refresh once the view is unmounted', async () => {
      const { unmount } = setup();
      const done = await runDone();
      unmount();
      await done();
      expect(onRefresh).not.toHaveBeenCalled();
    });

    describe('when the tab is only hidden', () => {
      const tabState = { currentView: 'objectList' as const, prefix: '', selectionItem: {}, deletingItems: {} };
      let mode: 'visible' | 'hidden' = 'visible';
      const wrapper = ({ children }: { children: ReactNode }) => <Activity mode={mode}>{children}</Activity>;

      beforeEach(() => {
        mode = 'visible';
        useTabListStore.setState({ activeTab: 'tab-1', tabList: { 'tab-1': tabState, 'tab-2': tabState } });
      });

      const hide = (rerender: (p: Params) => void) => {
        useTabListStore.setState({ activeTab: 'tab-2' });
        mode = 'hidden';
        rerender(baseParams());
      };

      it('still refreshes the list when the upload ends while the tab is hidden', async () => {
        const { rerender } = renderHook(p => useFilesDroppedUpload(p), { initialProps: baseParams(), wrapper });
        const done = await runDone();
        hide(rerender);
        await done();
        expect(onRefresh).toHaveBeenCalledTimes(1);
      });

      it('stops listening to drops while hidden and listens again when shown', () => {
        const { rerender } = renderHook(p => useFilesDroppedUpload(p), { initialProps: baseParams(), wrapper });
        expect(Events.On).toHaveBeenCalledTimes(1);
        hide(rerender);
        expect(unsubscribe).toHaveBeenCalledTimes(1);

        useTabListStore.setState({ activeTab: 'tab-1' });
        mode = 'visible';
        rerender(baseParams());
        expect(Events.On).toHaveBeenCalledTimes(2);
      });

      it('does not refresh when a hidden tab is closed during the upload', async () => {
        const { rerender, unmount } = renderHook(p => useFilesDroppedUpload(p), {
          initialProps: baseParams(),
          wrapper,
        });
        const done = await runDone();
        hide(rerender);
        useTabListStore.setState({ tabList: { 'tab-2': tabState } });
        unmount();
        await done();
        expect(onRefresh).not.toHaveBeenCalled();
      });

      it('does not refresh when the tab was closed and the view unmounted during the upload', async () => {
        const { unmount } = renderHook(p => useFilesDroppedUpload(p), { initialProps: baseParams(), wrapper });
        const done = await runDone();
        useTabListStore.setState({ tabList: { 'tab-2': tabState } });
        unmount();
        await done();
        expect(onRefresh).not.toHaveBeenCalled();
      });

      it('refreshes again after the tab is shown and hidden once more', async () => {
        const { rerender } = renderHook(p => useFilesDroppedUpload(p), { initialProps: baseParams(), wrapper });
        const done = await runDone();
        hide(rerender);
        useTabListStore.setState({ activeTab: 'tab-1' });
        mode = 'visible';
        rerender(baseParams());
        await done();
        expect(onRefresh).toHaveBeenCalledTimes(1);
      });
    });
  });
});
