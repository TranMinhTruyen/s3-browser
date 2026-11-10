import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PickFiles } from '@wails/S3Browser/internal/handlers/buckethandler';
import { DroppedFile, DroppedGroup, FilesDroppedOutput } from '@wails/S3Browser/models/bucket';
import { Events } from '@wailsio/runtime';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useModalStackStore } from '@/common/stores/modalStackStore';
import { callIPC } from '@/common/utils/ipcUtils';
import UploadPickerModal, { type UploadPickerResult } from '@/components/modals/upload/UploadPickerModal';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

const h = vi.hoisted(() => ({ visibleRows: Number.POSITIVE_INFINITY }));

// jsdom has no layout, so the real virtualizer would render no row: render the first `visibleRows` rows instead.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({
    count,
    getItemKey,
    estimateSize,
    getScrollElement,
  }: {
    count: number;
    getItemKey: (i: number) => string;
    estimateSize: () => number;
    getScrollElement: () => HTMLElement | null;
  }) => ({
    getVirtualItems: () =>
      Array.from({ length: Math.min(count, h.visibleRows) }, (_, index) => ({
        key: getItemKey(index),
        index,
        start: index * estimateSize(),
      })),
    getTotalSize: () => {
      getScrollElement();
      return count * estimateSize();
    },
  }),
}));
vi.mock('@wails/S3Browser/internal/handlers/buckethandler', () => ({ PickFiles: vi.fn() }));
vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));
vi.mock('sonner', () => ({ toast: { warning: vi.fn() } }));
vi.mock('@/components/inputs/combobox/BucketPicker', () => ({
  default: ({
    value,
    error,
    label,
    connectionId,
    profileName,
    onChange,
  }: {
    value: string | null;
    error?: string;
    label?: string;
    connectionId?: string;
    profileName?: string;
    onChange: (name: string | null) => void;
  }) => (
    <div>
      <span>{`picker label=${label} value=${value} conn=${connectionId} profile=${profileName}`}</span>
      {error && <span>{`picker error=${error}`}</span>}
      <button type="button" onClick={() => onChange('picked-bucket')}>
        choose bucket
      </button>
      <button type="button" onClick={() => onChange(null)}>
        clear bucket
      </button>
    </div>
  ),
}));

type DropHandler = (e: { data?: FilesDroppedOutput | undefined }) => void;

const flush = () => act(async () => {});

const file = (relKey: string, opts: { large?: boolean; path?: string; size?: number } = {}) =>
  new DroppedFile({
    path: opts.path ?? `/pick/${relKey}`,
    relKey,
    size: opts.size ?? 1024,
    isLarge: !!opts.large,
  });

const group = (name: string, files: DroppedFile[]) =>
  new DroppedGroup({
    name,
    files,
    totalFiles: files.length,
    largeCount: files.filter(f => f.isLarge).length,
    overMaxFiles: false,
    overLargeCount: false,
  });

const output = (groups: DroppedGroup[], extra: Partial<FilesDroppedOutput> = {}) =>
  new FilesDroppedOutput({
    tabId: 't1',
    groups,
    maxFilesPerFolder: 2,
    largeFileSize: 1024 * 1024,
    largeFileMaxCount: 1,
    maxTotalFiles: 100,
    skipped: 0,
    overMaxTotal: false,
    capped: false,
    ...extra,
  });

let result: Promise<UploadPickerResult | null>;
let unsubscribe: ReturnType<typeof vi.fn>;

const handlers = () => vi.mocked(Events.On).mock.calls.filter(c => c[0] === 'uploader:picker-files-dropped');
const lastHandler = () => handlers().at(-1)![1] as unknown as DropHandler;
const drop = async (data?: FilesDroppedOutput) => {
  await act(async () => lastHandler()({ data }));
};

function open(props: Partial<Parameters<typeof UploadPickerModal.show>[0]> = {}) {
  const view = renderWithProviders(<div />);
  act(() => {
    result = UploadPickerModal.show({
      tabId: 't1',
      connectionId: 'c1',
      profileName: 'Prof',
      bucket: 'b',
      prefix: 'dir/',
      ...props,
    });
  });
  return { view, user: userEvent.setup() };
}

const uploadBtn = (n: number) => screen.getByRole('button', { name: `Upload (${n})` });

describe('UploadPickerModal', () => {
  beforeEach(() => {
    h.visibleRows = Number.POSITIVE_INFINITY;
    useModalStackStore.getState().reset();
    unsubscribe = vi.fn();
    vi.mocked(Events.On).mockImplementation((() => unsubscribe) as never);
  });

  describe('layout', () => {
    it('shows the fixed target, an empty list and a locked upload button', async () => {
      open();
      await flush();
      expect(screen.getByText('Upload to: b/dir/')).toBeInTheDocument();
      expect(screen.getByText('No files added yet')).toBeInTheDocument();
      expect(screen.queryByText(/picker label/)).not.toBeInTheDocument();
      expect(uploadBtn(0)).toBeDisabled();
      expect(screen.getByText('or drag and drop files and folders here')).toBeInTheDocument();
    });

    it('uses an empty prefix by default', async () => {
      open({ prefix: undefined });
      await flush();
      expect(screen.getByText('Upload to: b/')).toBeInTheDocument();
    });

    it('marks the whole modal content as the picker drop target of the tab', async () => {
      open({ tabId: 'tab-9' });
      await flush();
      const content = document.querySelector('[data-file-drop-target]')!;
      expect(content).toBeInTheDocument();
      expect(content).toHaveAttribute('data-drop-kind', 'picker');
      expect(content).toHaveAttribute('data-tab-id', 'tab-9');
      expect(content).toContainElement(screen.getByText('Upload files'));
    });

    it('styles the modal content with the drop zone class of the CSS module', async () => {
      open();
      await flush();
      expect(document.querySelector('[data-file-drop-target]')!.className).toMatch(/dropZone/);
    });
  });

  describe('select files button', () => {
    it('calls PickFiles with no arguments and lists the picked files in the root folder', async () => {
      vi.mocked(callIPC).mockResolvedValue(output([group('', [file('a.txt'), file('b.txt')])]) as never);
      const { user } = open();
      await flush();
      await user.click(screen.getByRole('button', { name: 'Select files' }));
      expect(callIPC).toHaveBeenCalledExactlyOnceWith(PickFiles, []);

      expect(await screen.findByText('(selected files)')).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: 'a.txt' })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'b.txt' })).toBeChecked();
      expect(screen.getByText('2/2 files')).toBeInTheDocument();
      expect(uploadBtn(2)).toBeEnabled();
      expect(screen.queryByText('No files added yet')).not.toBeInTheDocument();
    });

    it.each([
      ['an error (null)', null],
      ['a canceled dialog (no groups)', output([])],
      ['a body without groups', { ...output([]), groups: undefined }],
    ])('adds nothing on %s', async (_name, body) => {
      vi.mocked(callIPC).mockResolvedValue(body as never);
      const { user } = open();
      await flush();
      await user.click(screen.getByRole('button', { name: 'Select files' }));
      await flush();
      expect(screen.getByText('No files added yet')).toBeInTheDocument();
      expect(toast.warning).not.toHaveBeenCalled();
    });
  });

  describe('dropped files event', () => {
    it('subscribes to the picker event and adds the files dropped on its own tab', async () => {
      open();
      await flush();
      expect(handlers().length).toBeGreaterThan(0);
      await drop(output([group('docs', [file('docs/x.txt')])], { tabId: 't1' }));
      expect(screen.getByText('docs')).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: 'x.txt' })).toBeChecked();
    });

    it('ignores files dropped on another tab and events without data', async () => {
      open();
      await flush();
      await drop(output([group('docs', [file('docs/x.txt')])], { tabId: 'other' }));
      await drop(undefined);
      expect(screen.getByText('No files added yet')).toBeInTheDocument();
    });

    it('keeps one stable listener across list changes and removes it when the modal unmounts', async () => {
      const { view } = open();
      await flush();
      const subscribed = handlers().length;
      await drop(output([group('', [file('a.txt')])]));
      // Adding files does not resubscribe: the handler reads the latest list from a ref.
      expect(handlers()).toHaveLength(subscribed);
      expect(unsubscribe).not.toHaveBeenCalled();
      view.unmount();
      expect(unsubscribe).toHaveBeenCalled();
    });
  });

  describe('overlapping updates', () => {
    const deferPick = () => {
      let resolve!: (body: FilesDroppedOutput | null) => void;
      vi.mocked(callIPC).mockImplementation((() => new Promise(r => (resolve = r))) as never);
      return (body: FilesDroppedOutput | null) => resolve(body);
    };

    it('keeps the files of two drops in a row', async () => {
      open();
      await flush();
      await drop(output([group('g', [file('g/a.txt')])], { maxFilesPerFolder: 5 }));
      await drop(output([group('g', [file('g/b.txt')])], { maxFilesPerFolder: 5 }));
      expect(screen.getByRole('checkbox', { name: 'a.txt' })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'b.txt' })).toBeChecked();
      expect(uploadBtn(2)).toBeEnabled();
    });

    it('keeps the dropped files when the dialog answers after a drop', async () => {
      const { user } = open();
      await flush();
      const answer = deferPick();
      await user.click(screen.getByRole('button', { name: 'Select files' }));
      await drop(output([group('d', [file('d/dropped.txt')])], { maxFilesPerFolder: 5 }));
      await act(async () => answer(output([group('p', [file('p/picked.txt')])], { maxFilesPerFolder: 5 })));
      expect(screen.getByRole('checkbox', { name: 'dropped.txt' })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'picked.txt' })).toBeChecked();
      expect(uploadBtn(2)).toBeEnabled();
    });

    it('keeps a tick made while the dialog is open', async () => {
      const { user } = open();
      await flush();
      await drop(output([group('g', [file('g/a.txt'), file('g/b.txt')])], { maxFilesPerFolder: 5 }));
      const answer = deferPick();
      await user.click(screen.getByRole('button', { name: 'Select files' }));
      await user.click(screen.getByRole('checkbox', { name: 'a.txt' }));
      await act(async () => answer(output([group('p', [file('p/c.txt')])], { maxFilesPerFolder: 5 })));
      expect(screen.getByRole('checkbox', { name: 'a.txt' })).not.toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'b.txt' })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'c.txt' })).toBeChecked();
      expect(uploadBtn(2)).toBeEnabled();
    });

    it('updates the x/max counter after ticking', async () => {
      const { user } = open();
      await flush();
      await drop(output([group('g', [file('g/a.txt'), file('g/b.txt')])], { maxFilesPerFolder: 5 }));
      expect(screen.getByText('2/5 files')).toBeInTheDocument();
      await user.click(screen.getByRole('checkbox', { name: 'a.txt' }));
      expect(screen.getByText('1/5 files')).toBeInTheDocument();
      await user.click(screen.getByRole('checkbox', { name: 'b.txt' }));
      expect(screen.getByText('0/5 files')).toBeInTheDocument();
    });
  });

  describe('drops without files', () => {
    it.each([
      ['skipped', { skipped: 2 }, 'Skipped 2 item(s)'],
      ['overMaxTotal', { overMaxTotal: true, maxTotalFiles: 7 }, 'more than 7 files'],
      ['capped', { capped: true }, 'The folder scan stopped early'],
    ])('still warns for %s and leaves the list unchanged', async (_n, extra, text) => {
      open();
      await flush();
      await drop(output([group('g', [file('g/a.txt')])], { maxFilesPerFolder: 5 }));
      vi.mocked(toast.warning).mockClear();
      await drop(output([], extra as Partial<FilesDroppedOutput>));
      expect(toast.warning).toHaveBeenCalledTimes(1);
      expect(vi.mocked(toast.warning).mock.calls[0][0]).toContain(text);
      expect(screen.getAllByRole('checkbox')).toHaveLength(1);
      expect(screen.getByText('1/5 files')).toBeInTheDocument();
    });

    it('warns without touching an empty list', async () => {
      open();
      await flush();
      await drop(output([], { skipped: 1 }));
      expect(toast.warning).toHaveBeenCalledTimes(1);
      expect(screen.getByText('No files added yet')).toBeInTheDocument();
    });

    it('exits silently when there are no groups and no flags', async () => {
      open();
      await flush();
      await drop(output([]));
      await drop({ ...output([]), groups: undefined } as never);
      expect(toast.warning).not.toHaveBeenCalled();
      expect(screen.getByText('No files added yet')).toBeInTheDocument();
    });
  });

  describe('select files button state', () => {
    const btn = () => screen.getByRole('button', { name: 'Select files' });

    it('is loading and disabled while PickFiles is pending, then resets', async () => {
      let resolve!: (body: FilesDroppedOutput) => void;
      vi.mocked(callIPC).mockImplementation((() => new Promise(r => (resolve = r))) as never);
      const { user } = open();
      await flush();
      expect(btn()).toBeEnabled();
      await user.click(btn());
      expect(btn()).toBeDisabled();
      expect(btn()).toHaveAttribute('data-loading', 'true');
      await act(async () => resolve(output([group('', [file('a.txt')])])));
      expect(btn()).toBeEnabled();
      expect(btn()).not.toHaveAttribute('data-loading');
    });

    it('resets when PickFiles rejects', async () => {
      vi.mocked(callIPC).mockRejectedValue(new Error('boom'));
      const { user } = open();
      await flush();
      // The modal does not catch the rejection, so it surfaces as an unhandled rejection of the click handler.
      const onRejection = vi.fn();
      const nodeProcess = (
        globalThis as unknown as {
          process: { on: (e: string, fn: () => void) => void; off: (e: string, fn: () => void) => void };
        }
      ).process;
      nodeProcess.on('unhandledRejection', onRejection);
      await user.click(btn());
      await flush();
      nodeProcess.off('unhandledRejection', onRejection);
      expect(btn()).toBeEnabled();
      expect(btn()).not.toHaveAttribute('data-loading');
    });
  });

  describe('merging and limits', () => {
    it('skips files already listed and merges groups with the same name', async () => {
      open();
      await flush();
      await drop(output([group('g', [file('g/a.txt')])]));
      await drop(output([group('g', [file('g/a.txt'), file('g/b.txt')])]));
      expect(screen.getAllByText('g')).toHaveLength(1);
      expect(screen.getAllByRole('checkbox')).toHaveLength(2);
      expect(screen.getByText('2/2 files')).toBeInTheDocument();
    });

    it('ticks files up to the group limit, leaves the rest unticked and warns', async () => {
      open();
      await flush();
      await drop(output([group('g', [file('g/a.txt'), file('g/b.txt'), file('g/c.txt')])]));
      expect(screen.getByRole('checkbox', { name: 'a.txt' })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'b.txt' })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'c.txt' })).not.toBeChecked();
      expect(toast.warning).toHaveBeenCalledExactlyOnceWith(
        'Some files exceed the upload limits and were left unticked'
      );
      expect(uploadBtn(2)).toBeEnabled();
    });

    it('limits ticked large files and shows the large counter and badge', async () => {
      open();
      await flush();
      await drop(output([group('g', [file('g/l1.bin', { large: true }), file('g/l2.bin', { large: true })])]));
      expect(screen.getByText('1/1 large files')).toBeInTheDocument();
      expect(screen.getAllByText('Large')).toHaveLength(2);
      expect(screen.getByRole('checkbox', { name: 'l2.bin' })).not.toBeChecked();
    });

    it('turns the large counter red and bold only once it is over the limit', async () => {
      const { user } = open();
      await flush();
      await drop(output([group('g', [file('g/l1.bin', { large: true }), file('g/l2.bin', { large: true })])]));
      const counter = () => screen.getByText(/\d+\/1 large files/);
      expect(counter().style.fontWeight).toBe('');
      expect(counter().style.color).toContain('dimmed');

      await user.click(screen.getByRole('checkbox', { name: 'l2.bin' }));

      expect(counter().style.fontWeight).toBe('600');
      expect(counter().style.color).toContain('red');
    });

    it('turns the file counter red and bold only once it is over the limit', async () => {
      const { user } = open();
      await flush();
      await drop(output([group('g', [file('g/a.txt'), file('g/b.txt'), file('g/c.txt')])]));
      const counter = () => screen.getByText(/\d+\/2 files/);
      expect(counter().style.fontWeight).toBe('');

      await user.click(screen.getByRole('checkbox', { name: 'c.txt' }));

      expect(counter().style.fontWeight).toBe('600');
      expect(counter().style.color).toContain('red');
    });

    it('shows the root label for files dropped outside any folder', async () => {
      open();
      await flush();
      await drop(output([group('', [file('a.txt')])]));
      expect(screen.getByText('(selected files)')).toBeInTheDocument();
    });

    it('does not show a large counter or badge without large files', async () => {
      open();
      await flush();
      await drop(output([group('g', [file('g/a.txt')])]));
      expect(screen.queryByText(/large files/)).not.toBeInTheDocument();
      expect(screen.queryByText('Large')).not.toBeInTheDocument();
    });

    it('locks upload when a group is ticked over the file limit and unlocks once unticked', async () => {
      const { user } = open();
      await flush();
      await drop(output([group('g', [file('g/a.txt'), file('g/b.txt'), file('g/c.txt')])]));
      await user.click(screen.getByRole('checkbox', { name: 'c.txt' }));
      expect(screen.getByText('3/2 files')).toBeInTheDocument();
      expect(uploadBtn(3)).toBeDisabled();
      await user.click(screen.getByRole('checkbox', { name: 'c.txt' }));
      expect(screen.getByText('2/2 files')).toBeInTheDocument();
      expect(uploadBtn(2)).toBeEnabled();
    });

    it('locks upload when large files are ticked over the limit', async () => {
      const { user } = open();
      await flush();
      await drop(output([group('g', [file('g/l1.bin', { large: true }), file('g/l2.bin', { large: true })])]));
      await user.click(screen.getByRole('checkbox', { name: 'l2.bin' }));
      expect(screen.getByText('2/1 large files')).toBeInTheDocument();
      expect(uploadBtn(2)).toBeDisabled();
    });

    it('locks upload when nothing is ticked', async () => {
      const { user } = open();
      await flush();
      await drop(output([group('g', [file('g/a.txt')])]));
      await user.click(screen.getByRole('checkbox', { name: 'a.txt' }));
      expect(uploadBtn(0)).toBeDisabled();
    });

    it('caps the list at maxTotalFiles and warns S3W007', async () => {
      open();
      await flush();
      await drop(output([group('g', [file('g/a.txt'), file('g/b.txt')])], { maxTotalFiles: 1, maxFilesPerFolder: 5 }));
      expect(screen.getAllByRole('checkbox')).toHaveLength(1);
      expect(toast.warning).toHaveBeenCalledExactlyOnceWith(
        'The drop holds more than 1 files, the files after the first 1 are ignored.'
      );
    });

    it('warns once about the total when the backend already flagged overMaxTotal', async () => {
      open();
      await flush();
      await drop(output([group('g', [file('g/a.txt'), file('g/b.txt')])], { maxTotalFiles: 1, overMaxTotal: true }));
      expect(toast.warning).toHaveBeenCalledTimes(1);
      expect(vi.mocked(toast.warning).mock.calls[0][0]).toContain('more than 1 files');
    });

    it('warns about skipped items and a capped folder scan', async () => {
      open();
      await flush();
      await drop(output([group('g', [file('g/a.txt')])], { skipped: 3, capped: true }));
      expect(toast.warning).toHaveBeenCalledWith(
        'Skipped 3 item(s) that cannot be uploaded (unreadable, symbolic link or not a regular file).'
      );
      expect(toast.warning).toHaveBeenCalledWith('The folder scan stopped early, so the list may be incomplete.');
      expect(toast.warning).toHaveBeenCalledTimes(2);
    });

    it('shows the base name of nested and Windows keys, and the whole key when it ends with a separator', async () => {
      open();
      await flush();
      await drop(
        output([group('g', [file('g/sub/n.txt'), file('g\\w.txt', { path: 'C:\\x\\w.txt' })])], {
          maxFilesPerFolder: 5,
        })
      );
      await drop(output([group('h', [file('dir/')])], { maxFilesPerFolder: 5 }));
      expect(screen.getByRole('checkbox', { name: 'n.txt' })).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: 'w.txt' })).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: 'dir/' })).toBeInTheDocument();
    });

    it('formats the file size', async () => {
      open();
      await flush();
      await drop(output([group('g', [file('g/a.txt', { size: 2048 })])]));
      expect(screen.getByText('2.00 KiB')).toBeInTheDocument();
    });
  });

  describe('remove files', () => {
    // Row = the Group that holds the checkbox and the remove button.
    const removeBtn = (name: string) => {
      const row = screen.getByRole('checkbox', { name }).closest('[style*="translateY"]') as HTMLElement;
      return within(row).getByRole('button', { name: 'Remove file' });
    };
    const removeSelectedBtn = (n: number) => screen.getByRole('button', { name: `Remove selected (${n})` });

    it('gives every file row a remove button', async () => {
      open();
      await flush();
      await drop(output([group('g', [file('g/a.txt'), file('g/b.txt')])]));
      expect(screen.getAllByRole('button', { name: 'Remove file' })).toHaveLength(2);
    });

    it('removes the file of that row and updates the counter and the upload count', async () => {
      const { user } = open();
      await flush();
      await drop(output([group('g', [file('g/a.txt'), file('g/b.txt')])], { maxFilesPerFolder: 5 }));
      expect(screen.getByText('2/5 files')).toBeInTheDocument();
      await user.click(removeBtn('a.txt'));
      expect(screen.queryByRole('checkbox', { name: 'a.txt' })).not.toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: 'b.txt' })).toBeChecked();
      expect(screen.getByText('1/5 files')).toBeInTheDocument();
      expect(uploadBtn(1)).toBeEnabled();
    });

    it('removes an unticked file without changing the ticked count', async () => {
      const { user } = open();
      await flush();
      await drop(output([group('g', [file('g/a.txt'), file('g/b.txt'), file('g/c.txt')])]));
      expect(screen.getByRole('checkbox', { name: 'c.txt' })).not.toBeChecked();
      await user.click(removeBtn('c.txt'));
      expect(screen.queryByRole('checkbox', { name: 'c.txt' })).not.toBeInTheDocument();
      expect(screen.getByText('2/2 files')).toBeInTheDocument();
      expect(uploadBtn(2)).toBeEnabled();
    });

    it('locks upload and shows the empty list after removing the last file', async () => {
      const { user } = open();
      await flush();
      await drop(output([group('g', [file('g/a.txt')])]));
      expect(uploadBtn(1)).toBeEnabled();
      await user.click(removeBtn('a.txt'));
      expect(uploadBtn(0)).toBeDisabled();
      expect(screen.getByText('No files added yet')).toBeInTheDocument();
      expect(screen.queryByText('g')).not.toBeInTheDocument();
    });

    it('unlocks upload once removing a file ends the file limit violation', async () => {
      const { user } = open();
      await flush();
      await drop(output([group('g', [file('g/a.txt'), file('g/b.txt'), file('g/c.txt')])]));
      await user.click(screen.getByRole('checkbox', { name: 'c.txt' }));
      expect(screen.getByText('3/2 files')).toBeInTheDocument();
      expect(uploadBtn(3)).toBeDisabled();
      await user.click(removeBtn('c.txt'));
      expect(screen.getByText('2/2 files')).toBeInTheDocument();
      expect(uploadBtn(2)).toBeEnabled();
    });

    it('unlocks upload once removing a large file ends the large limit violation', async () => {
      const { user } = open();
      await flush();
      await drop(output([group('g', [file('g/l1.bin', { large: true }), file('g/l2.bin', { large: true })])]));
      await user.click(screen.getByRole('checkbox', { name: 'l2.bin' }));
      expect(uploadBtn(2)).toBeDisabled();
      await user.click(removeBtn('l2.bin'));
      expect(screen.getByText('1/1 large files')).toBeInTheDocument();
      expect(uploadBtn(1)).toBeEnabled();
    });

    it('does not resolve a removed file', async () => {
      const { user } = open();
      await flush();
      await drop(output([group('g', [file('g/a.txt'), file('g/b.txt')])]));
      await user.click(removeBtn('a.txt'));
      await user.click(uploadBtn(1));
      expect((await result)?.files.map(f => f.relKey)).toEqual(['g/b.txt']);
    });

    it('lets a removed file be added again by a later drop', async () => {
      const { user } = open();
      await flush();
      await drop(output([group('g', [file('g/a.txt'), file('g/b.txt')])], { maxFilesPerFolder: 5 }));
      await user.click(removeBtn('a.txt'));
      await drop(output([group('g', [file('g/a.txt')])], { maxFilesPerFolder: 5 }));
      expect(screen.getByRole('checkbox', { name: 'a.txt' })).toBeChecked();
      expect(screen.getByText('2/5 files')).toBeInTheDocument();
    });

    it('shows the ticked count in "Remove selected" and locks it when nothing is ticked', async () => {
      const { user } = open();
      await flush();
      expect(removeSelectedBtn(0)).toBeDisabled();
      await drop(output([group('g', [file('g/a.txt'), file('g/b.txt'), file('g/c.txt')])]));
      expect(removeSelectedBtn(2)).toBeEnabled();
      await user.click(screen.getByRole('checkbox', { name: 'a.txt' }));
      expect(removeSelectedBtn(1)).toBeEnabled();
      await user.click(screen.getByRole('checkbox', { name: 'b.txt' }));
      expect(removeSelectedBtn(0)).toBeDisabled();
    });

    it('removes the ticked files and keeps the unticked ones', async () => {
      const { user } = open();
      await flush();
      await drop(output([group('g', [file('g/a.txt'), file('g/b.txt'), file('g/c.txt')])]));
      await user.click(removeSelectedBtn(2));
      expect(screen.queryByRole('checkbox', { name: 'a.txt' })).not.toBeInTheDocument();
      expect(screen.queryByRole('checkbox', { name: 'b.txt' })).not.toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: 'c.txt' })).not.toBeChecked();
      expect(removeSelectedBtn(0)).toBeDisabled();
      expect(uploadBtn(0)).toBeDisabled();
      expect(screen.getByText('0/2 files')).toBeInTheDocument();
    });

    it('shows the empty list after removing every file', async () => {
      const { user } = open();
      await flush();
      await drop(output([group('g', [file('g/a.txt'), file('g/b.txt')])]));
      await user.click(removeSelectedBtn(2));
      expect(screen.getByText('No files added yet')).toBeInTheDocument();
      expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
      expect(uploadBtn(0)).toBeDisabled();
    });

    it('locks "Remove selected" while PickFiles is pending', async () => {
      let resolve!: (body: FilesDroppedOutput) => void;
      vi.mocked(callIPC).mockImplementation((() => new Promise(r => (resolve = r))) as never);
      const { user } = open();
      await flush();
      await drop(output([group('g', [file('g/a.txt')])]));
      expect(removeSelectedBtn(1)).toBeEnabled();
      await user.click(screen.getByRole('button', { name: 'Select files' }));
      expect(removeSelectedBtn(1)).toBeDisabled();
      await act(async () => resolve(output([])));
      expect(removeSelectedBtn(1)).toBeEnabled();
    });
  });

  describe('virtualization', () => {
    it('renders only the rows the virtualizer asks for', async () => {
      h.visibleRows = 4;
      open();
      await flush();
      const files = Array.from({ length: 100 }, (_, i) => file(`g/f${i}.txt`));
      await drop(output([group('g', files)], { maxFilesPerFolder: 100, maxTotalFiles: 1000 }));
      // 1 group header row + 3 file rows.
      expect(screen.getAllByRole('checkbox')).toHaveLength(3);
      expect(uploadBtn(100)).toBeEnabled();
    });
  });

  describe('result', () => {
    it('resolves the fixed bucket and the ticked files in list order', async () => {
      const { user } = open();
      await flush();
      await drop(output([group('g', [file('g/a.txt'), file('g/b.txt'), file('g/c.txt')])], { maxFilesPerFolder: 5 }));
      await user.click(screen.getByRole('checkbox', { name: 'b.txt' }));
      await user.click(uploadBtn(2));
      const picked = await result;
      expect(picked?.bucket).toBe('b');
      expect(picked?.files.map(f => f.relKey)).toEqual(['g/a.txt', 'g/c.txt']);
    });

    it('resolves null on Cancel', async () => {
      const { user } = open();
      await flush();
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(await result).toBeNull();
    });

    it('resolves null when closed with the X button', async () => {
      const { user } = open();
      await flush();
      await user.click(screen.getByRole('button', { name: 'Close' }));
      expect(await result).toBeNull();
    });
  });

  describe('without a fixed bucket', () => {
    it('shows the bucket picker with the connection and no target text', async () => {
      open({ bucket: undefined });
      await flush();
      expect(screen.getByText('picker label=undefined value=null conn=c1 profile=Prof')).toBeInTheDocument();
      expect(screen.queryByText(/Upload to:/)).not.toBeInTheDocument();
    });

    it('requires a bucket: shows the error only once files are ticked and locks upload', async () => {
      open({ bucket: undefined });
      await flush();
      expect(screen.queryByText(/picker error/)).not.toBeInTheDocument();
      await drop(output([group('g', [file('g/a.txt')])]));
      expect(screen.getByText('picker error=Choose a target bucket')).toBeInTheDocument();
      expect(uploadBtn(1)).toBeDisabled();
    });

    it('uploads into the chosen bucket and locks again when it is cleared', async () => {
      const { user } = open({ bucket: undefined });
      await flush();
      await drop(output([group('g', [file('g/a.txt')])]));
      await user.click(screen.getByRole('button', { name: 'choose bucket' }));
      expect(screen.getByText(/value=picked-bucket/)).toBeInTheDocument();
      expect(screen.queryByText(/picker error/)).not.toBeInTheDocument();
      expect(uploadBtn(1)).toBeEnabled();

      await user.click(screen.getByRole('button', { name: 'clear bucket' }));
      expect(uploadBtn(1)).toBeDisabled();

      await user.click(screen.getByRole('button', { name: 'choose bucket' }));
      await user.click(uploadBtn(1));
      const picked = await result;
      expect(picked?.bucket).toBe('picked-bucket');
      expect(picked?.files.map(f => f.relKey)).toEqual(['g/a.txt']);
    });

    it('does not resolve when the locked upload button is clicked', async () => {
      open({ bucket: undefined });
      await flush();
      await drop(output([group('g', [file('g/a.txt')])]));
      fireEvent.click(uploadBtn(1));
      const settled = vi.fn();
      result.then(settled);
      await flush();
      expect(settled).not.toHaveBeenCalled();
    });
  });
});
