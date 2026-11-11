import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DroppedFile, DroppedGroup } from '@wails/S3Browser/models/bucket';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useModalStackStore } from '@/common/stores/modalStackStore';
import UploadLimitModal from '@/pages/s3/modals/upload/UploadLimitModal';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

// jsdom has no layout, so the real virtualizer would render no row: render every row instead.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count, getItemKey }: { count: number; getItemKey: (i: number) => string }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ key: getItemKey(index), index, start: 0 })),
    getTotalSize: () => count * 36,
  }),
}));

const flush = () => act(async () => {});

const file = (relKey: string, isLarge = false, path = `/drop/${relKey}`) =>
  new DroppedFile({ path, relKey, size: isLarge ? 5 * 1024 * 1024 : 1024, isLarge });

const group = (name: string, files: DroppedFile[], over: { max?: boolean; large?: boolean }) =>
  new DroppedGroup({
    name,
    files,
    totalFiles: files.length,
    largeCount: files.filter(f => f.isLarge).length,
    overMaxFiles: !!over.max,
    overLargeCount: !!over.large,
  });

const limits = { maxFilesPerFolder: 2, largeFileSize: 1024 * 1024, largeFileMaxCount: 1 };

function open(groups: DroppedGroup[], extra: { capped?: boolean } = {}) {
  renderWithProviders(<div />);
  let result!: Promise<DroppedFile[] | null>;
  act(() => {
    result = UploadLimitModal.show({ groups, ...limits, ...extra });
  });
  return result;
}

describe('UploadLimitModal', () => {
  beforeEach(() => {
    useModalStackStore.getState().reset();
  });

  const photos = () =>
    group('photos', [file('photos/f1.jpg'), file('photos/f2.jpg'), file('photos/f3.jpg'), file('photos/f4.jpg')], {
      max: true,
    });
  const videos = () =>
    group('videos', [file('videos/v1.mp4', true), file('videos/v2.mp4', true), file('videos/v3.txt')], {
      large: true,
    });
  const within_ = () => group('small', [file('small/s1.txt')], {});

  it('preselects the first files within the limits and uploads them with the groups that are within limits', async () => {
    const result = open([photos(), videos(), within_()]);
    await flush();

    // photos: f1,f2 (max 2); videos: v1 (1 large) + v3, v2 skipped; small: in full => 5.
    expect(screen.getByRole('button', { name: 'Upload (5)' })).toBeEnabled();
    expect(screen.getByText('2/2 files')).toBeInTheDocument();
    expect(screen.getByText('1/1 large files')).toBeInTheDocument();
    expect(screen.queryByText('small')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Upload (5)' }));

    const files = (await result) ?? [];
    expect(files.map(f => f.relKey)).toEqual([
      'photos/f1.jpg',
      'photos/f2.jpg',
      'videos/v1.mp4',
      'videos/v3.txt',
      'small/s1.txt',
    ]);
  });

  it('disables upload while a group is over a limit and enables it again once unchecked', async () => {
    open([photos()]);
    await flush();

    const f3 = screen.getByRole('checkbox', { name: 'f3.jpg' });
    await userEvent.click(f3);

    expect(screen.getByText('3/2 files')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload (3)' })).toBeDisabled();

    await userEvent.click(f3);
    expect(screen.getByRole('button', { name: 'Upload (2)' })).toBeEnabled();

    await userEvent.click(screen.getByRole('checkbox', { name: 'f1.jpg' }));
    expect(screen.getByRole('button', { name: 'Upload (1)' })).toBeEnabled();
  });

  it('disables upload when the large-file limit of a group is exceeded, and when nothing is selected', async () => {
    open([videos()]);
    await flush();

    await userEvent.click(screen.getByRole('checkbox', { name: 'v2.mp4' }));
    expect(screen.getByText('2/1 large files')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload (3)' })).toBeDisabled();

    await userEvent.click(screen.getByRole('checkbox', { name: 'v2.mp4' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'v1.mp4' }));
    // Only v3 is still selected (it is not in the large list, so it stays selected).
    expect(screen.getByRole('button', { name: 'Upload (1)' })).toBeEnabled();
    expect(screen.getAllByText('Large')).toHaveLength(2);
  });

  it('disables upload when the only group has no file selected', async () => {
    open([group('empty', [file('empty/a.txt', true), file('empty/b.txt', true)], { large: true })]);
    await flush();

    // Preselect a.txt only; unchecking it leaves nothing.
    await userEvent.click(screen.getByRole('checkbox', { name: 'a.txt' }));
    expect(screen.getByRole('button', { name: 'Upload (0)' })).toBeDisabled();
  });

  it('shows the root folder label, the capped warning and handles names with separators', async () => {
    open([group('', [file('a.txt'), file('dir/'), file('win\\b.txt'), file('c.txt')], { max: true })], {
      capped: true,
    });
    await flush();

    expect(screen.getByText('(files dropped directly)')).toBeInTheDocument();
    expect(screen.getByText('The folder scan stopped early, so the list may be incomplete.')).toBeInTheDocument();
    // "dir/" has an empty last segment, so the whole key is shown; backslash paths show the last segment.
    expect(screen.getByText('dir/')).toBeInTheDocument();
    expect(screen.getByText('b.txt')).toBeInTheDocument();
    expect(screen.getByText('Folders with more than 2 files')).toBeInTheDocument();
  });

  it('shows no capped warning by default and opens the large section when nothing is over the max', async () => {
    open([videos()]);
    await flush();

    expect(screen.queryByText(/stopped early/)).not.toBeInTheDocument();
    const header = screen.getByRole('button', { name: 'Folders with 2 or more large files (over 1.00 MiB)' });
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByText('Folders with more than 2 files')).not.toBeInTheDocument();
  });

  it('shows only the file counter in the over-max section and only the large counter in the large section', async () => {
    open([photos(), videos()]);
    await flush();
    // Both sections are open only when expanded; open the large one too.
    const largeHeader = screen.getByRole('button', { name: /large files \(over/ });
    if (largeHeader.getAttribute('aria-expanded') !== 'true') await userEvent.click(largeHeader);

    expect(screen.getAllByText(/\d+\/\d+ files/)).toHaveLength(1);
    expect(screen.getByText('2/2 files')).toBeInTheDocument();
    expect(screen.getAllByText(/\d+\/\d+ large files/)).toHaveLength(1);
    expect(screen.getByText('1/1 large files')).toBeInTheDocument();
  });

  it('turns a counter red and bold only once it is over the limit', async () => {
    open([photos()]);
    await flush();

    const counter = () => screen.getByText(/\d+\/2 files/);
    expect(counter().style.fontWeight).toBe('');
    expect(counter().style.color).toContain('dimmed');

    await userEvent.click(screen.getByRole('checkbox', { name: 'f3.jpg' }));

    expect(counter().style.fontWeight).toBe('600');
    expect(counter().style.color).toContain('red');
  });

  it('puts Cancel on the left and Upload on the right of a non-wrapping footer', async () => {
    open([photos()]);
    await flush();

    const footer = screen.getByRole('button', { name: 'Cancel' }).parentElement as HTMLElement;
    expect(footer.style.getPropertyValue('--group-wrap')).toBe('nowrap');
    expect(footer.style.getPropertyValue('--group-justify')).toBe('space-between');
    expect(Array.from(footer.querySelectorAll('button')).map(b => b.textContent)).toEqual(['Cancel', 'Upload (2)']);
  });

  it('resolves an empty list on Cancel', async () => {
    const result = open([photos()]);
    await flush();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await expect(result).resolves.toEqual([]);
  });

  it('resolves null when closed with the X button', async () => {
    const dismissed = open([photos()]);
    await flush();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await expect(dismissed).resolves.toBeNull();
  });

  it('resolves null when the modal is closed', async () => {
    const dismissed = open([photos()]);
    await flush();
    await userEvent.keyboard('{Escape}');
    await expect(dismissed).resolves.toBeNull();
  });
});
