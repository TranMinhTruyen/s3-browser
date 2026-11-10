import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DroppedFile, DroppedGroup } from '@wails/S3Browser/models/bucket';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FileRow,
  GroupRow,
  rowsHeight,
  type UploadRow,
  VirtualRowList,
} from '@/components/modals/upload/UploadFileList';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

const virtual = vi.hoisted(() => ({ estimates: [] as number[], getScrollEl: null as null | (() => unknown) }));

// jsdom has no layout, so the real virtualizer would render no row: render every row instead.
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
    getScrollElement: () => unknown;
  }) => ({
    getVirtualItems: () => {
      virtual.estimates.push(estimateSize());
      virtual.getScrollEl = getScrollElement;
      return Array.from({ length: count }, (_, index) => ({
        key: getItemKey(index),
        index,
        start: index * estimateSize(),
      }));
    },
    getTotalSize: () => count * estimateSize(),
  }),
}));

const WIN_PATH = 'C:/data/a.bin';

const file = (over: Partial<DroppedFile> = {}) =>
  new DroppedFile({ path: WIN_PATH, relKey: 'dir/a.bin', size: 2048, isLarge: false, ...over });

describe('FileRow', () => {
  const onToggleFile = vi.fn();
  const onRemoveFile = vi.fn();
  const renderRow = (props: Partial<React.ComponentProps<typeof FileRow>> = {}) =>
    renderWithProviders(
      <FileRow
        file={file()}
        checked={false}
        top={0}
        largeLabel="Large"
        titleBy="path"
        onToggleFile={onToggleFile}
        {...props}
      />
    );

  beforeEach(() => {
    onToggleFile.mockReset();
    onRemoveFile.mockReset();
  });

  it('shows the base name of the relKey and the formatted size', () => {
    renderRow();

    expect(screen.getByText('a.bin')).toBeInTheDocument();
    expect(screen.getByText('2.00 KiB')).toBeInTheDocument();
  });

  it('falls back to the whole relKey when it has no usable last segment', () => {
    renderRow({ file: file({ relKey: 'dir/' }) });

    expect(screen.getByText('dir/')).toBeInTheDocument();
  });

  it.each([
    ['path', WIN_PATH],
    ['relKey', 'dir/a.bin'],
  ] as const)('uses the %s as the tooltip', async (titleBy, title) => {
    renderRow({ titleBy });

    await userEvent.hover(screen.getByText('a.bin'));

    expect(await screen.findByText(title)).toBeInTheDocument();
  });

  it('shows the large badge only for a large file', () => {
    const { unmount } = renderRow();
    expect(screen.queryByText('Large')).not.toBeInTheDocument();
    unmount();

    renderRow({ file: file({ isLarge: true }) });
    expect(screen.getByText('Large')).toBeInTheDocument();
  });

  it('draws the large badge light in the theme orange', () => {
    renderRow({ file: file({ isLarge: true }) });

    const badge = screen.getByText('Large').closest('[data-variant]') as HTMLElement;
    expect(badge).toHaveAttribute('data-variant', 'light');
    expect(badge.style.getPropertyValue('--badge-color')).toBe('var(--mantine-color-orange-6)');
  });

  it('reports the checkbox change with the file path', () => {
    renderRow({ checked: false });

    fireEvent.click(screen.getByRole('checkbox'));

    expect(onToggleFile).toHaveBeenCalledWith(WIN_PATH, true);
  });

  it('reflects the checked prop', () => {
    renderRow({ checked: true });

    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('has no remove button without onRemoveFile', () => {
    renderRow({ removeLabel: 'Remove' });

    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });

  it('has no remove button without removeLabel', () => {
    renderRow({ onRemoveFile });

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('removes the file by path when the remove button is clicked', async () => {
    renderRow({ onRemoveFile, removeLabel: 'Remove' });

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(onRemoveFile).toHaveBeenCalledWith(WIN_PATH);
  });
});

describe('FileRow positioning', () => {
  const props = {
    file: file(),
    checked: false,
    largeLabel: 'Large',
    titleBy: 'path' as const,
    onToggleFile: vi.fn(),
  };
  const row = () => screen.getByRole('checkbox').closest('.mantine-Group-root') as HTMLElement;

  it('places the row with translateY(top) and a fixed height', () => {
    renderWithProviders(<FileRow {...props} top={72} />);

    expect(row().style.transform).toBe('translateY(72px)');
    expect(row().style.height).toBe('36px');
    expect(row().style.position).toBe('absolute');
  });

  it('moves when top changes', () => {
    const { rerender } = renderWithProviders(<FileRow {...props} top={0} />);
    expect(row().style.transform).toBe('translateY(0px)');

    rerender(<FileRow {...props} top={108} />);

    expect(row().style.transform).toBe('translateY(108px)');
  });

  it('keeps the same style object while top and props stay equal (memo)', () => {
    const { rerender } = renderWithProviders(<FileRow {...props} top={36} />);
    const before = row();
    const styleBefore = before.getAttribute('style');

    rerender(<FileRow {...props} top={36} />);

    expect(row()).toBe(before);
    expect(row().getAttribute('style')).toBe(styleBefore);
  });
});

describe('GroupRow', () => {
  const grp = (name: string) => new DroppedGroup({ name } as Partial<DroppedGroup>);

  it('shows the group name without any counter when no text is given', () => {
    renderWithProviders(<GroupRow group={grp('photos')} top={36} rootLabel="Root" />);

    expect(screen.getByText('photos')).toBeInTheDocument();
    expect(screen.queryByText('Root')).not.toBeInTheDocument();
    expect(screen.queryByText(/\//)).not.toBeInTheDocument();
    expect(screen.getByText('photos').closest('.mantine-Group-root')).toHaveStyle({
      transform: 'translateY(36px)',
      height: '36px',
    });
  });

  it('falls back to the root label for an empty name', () => {
    renderWithProviders(<GroupRow group={grp('')} top={0} rootLabel="Root" />);

    expect(screen.getByText('Root')).toBeInTheDocument();
  });

  it('shows both counters dimmed and normal weight within the limits', () => {
    renderWithProviders(
      <GroupRow group={grp('g')} top={0} rootLabel="Root" largeText="1/2 large" countText="3/5 files" />
    );

    for (const text of ['1/2 large', '3/5 files']) {
      const el = screen.getByText(text);
      expect(el.style.fontWeight).toBe('');
      expect(el.style.color).toContain('dimmed');
    }
  });

  it('highlights counters over the limit in red with weight 600', () => {
    renderWithProviders(
      <GroupRow
        group={grp('g')}
        top={0}
        rootLabel="Root"
        largeText="3/2 large"
        countText="9/5 files"
        largeOver
        countOver
      />
    );

    for (const text of ['3/2 large', '9/5 files']) {
      const el = screen.getByText(text);
      expect(el.style.fontWeight).toBe('600');
      expect(el.style.color).toContain('red');
    }
  });

  it('shows only the counter that has a text', () => {
    renderWithProviders(<GroupRow group={grp('g')} top={0} rootLabel="Root" countText="3/5 files" />);

    expect(screen.getByText('3/5 files')).toBeInTheDocument();
    expect(screen.queryByText(/large/)).not.toBeInTheDocument();
  });
});

describe('VirtualRowList', () => {
  const group = new DroppedGroup({ rootName: 'photos' } as Partial<DroppedGroup>);
  const rows: UploadRow[] = [
    { kind: 'group', index: 3, group },
    { kind: 'file', file: file({ path: '/x/a.bin' }) },
  ];

  beforeEach(() => {
    virtual.estimates.length = 0;
    virtual.getScrollEl = null;
  });

  it('renders every row through renderRow with its key and position', () => {
    const renderRow = vi.fn((row: UploadRow, key: string | number | bigint, top: number) => (
      <div key={key} data-testid="row" data-top={top}>
        {row.kind}
      </div>
    ));

    renderWithProviders(<VirtualRowList rows={rows} height={200} renderRow={renderRow} />);

    expect(renderRow).toHaveBeenCalledTimes(2);
    expect(renderRow.mock.calls[0][0]).toBe(rows[0]);
    expect(renderRow.mock.calls[0][1]).toBe('g:3');
    expect(renderRow.mock.calls[1][1]).toBe('f:/x/a.bin');
    expect(renderRow.mock.calls[0][2]).toBe(0);
    expect(renderRow.mock.calls[1][2]).toBe(36);
    expect(screen.getAllByTestId('row').map(r => r.textContent)).toEqual(['group', 'file']);
  });

  it('gives the virtualizer a 36px row size and the scroll container', () => {
    renderWithProviders(<VirtualRowList rows={rows} height="50%" renderRow={() => null} />);

    expect(virtual.estimates).toContain(36);
    const el = (virtual.getScrollEl as (() => unknown) | null)?.();
    expect(el).toBeInstanceOf(HTMLDivElement);
    expect((el as HTMLElement).style.height).toBe('50%');
  });
});

describe('rowsHeight', () => {
  it.each([
    [0, 0],
    [1, 36],
    [5, 180],
  ])('is %i rows -> %i px', (count, px) => {
    expect(rowsHeight(count)).toBe(px);
  });
});
