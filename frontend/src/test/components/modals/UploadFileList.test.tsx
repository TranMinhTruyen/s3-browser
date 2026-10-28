import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DroppedFile, DroppedGroup } from '@wails/S3Browser/models/bucket';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileRow, rowsHeight, type UploadRow, VirtualRowList } from '@/components/modals/UploadFileList';
import { renderWithProviders } from '@/test/renderWithProviders';

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
        style={{}}
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
    expect(screen.getByText('2.00 KB')).toBeInTheDocument();
  });

  it('falls back to the whole relKey when it has no usable last segment', () => {
    renderRow({ file: file({ relKey: 'dir/' }) });

    expect(screen.getByText('dir/')).toBeInTheDocument();
  });

  it.each([
    ['path', WIN_PATH],
    ['relKey', 'dir/a.bin'],
  ] as const)('uses the %s as the tooltip', (titleBy, title) => {
    renderRow({ titleBy });

    expect(screen.getByText('a.bin')).toHaveAttribute('title', title);
  });

  it('shows the large badge only for a large file', () => {
    const { unmount } = renderRow();
    expect(screen.queryByText('Large')).not.toBeInTheDocument();
    unmount();

    renderRow({ file: file({ isLarge: true }) });
    expect(screen.getByText('Large')).toBeInTheDocument();
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

  it('removes the file by path when the remove button is clicked', async () => {
    renderRow({ onRemoveFile, removeLabel: 'Remove' });

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(onRemoveFile).toHaveBeenCalledWith(WIN_PATH);
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
    const renderRow = vi.fn((row: UploadRow, key: string | number | bigint, style: React.CSSProperties) => (
      <div key={key} data-testid="row" style={style}>
        {row.kind}
      </div>
    ));

    renderWithProviders(<VirtualRowList rows={rows} height={200} renderRow={renderRow} />);

    expect(renderRow).toHaveBeenCalledTimes(2);
    expect(renderRow.mock.calls[0][0]).toBe(rows[0]);
    expect(renderRow.mock.calls[0][1]).toBe('g:3');
    expect(renderRow.mock.calls[1][1]).toBe('f:/x/a.bin');
    expect(renderRow.mock.calls[1][2]).toMatchObject({ height: 36, transform: 'translateY(36px)' });
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
