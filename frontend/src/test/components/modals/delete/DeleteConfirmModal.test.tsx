import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useModalStackStore } from '@/common/stores/modalStackStore';
import DeleteConfirmModal from '@/components/modals/delete/DeleteConfirmModal';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

// jsdom has no layout, so the real virtualizer would render no row: render every row instead.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ key: index, index, start: index * 32 })),
    getTotalSize: () => count * 32,
    measureElement: () => {},
  }),
}));

const flush = () => act(async () => {});

type Props = Parameters<typeof DeleteConfirmModal.show>[0];
async function open(props: Props) {
  renderWithProviders(<div />);
  let result: Promise<string[] | null> | undefined;
  act(() => {
    result = DeleteConfirmModal.show(props) as Promise<string[] | null>;
  });
  await flush();
  return { result: result as Promise<string[] | null> };
}

const FILES = [
  { key: 'a.txt', size: 1 },
  { key: 'b.txt', size: 2 },
  { key: 'c.txt', size: 3 },
];

const rowCheckbox = (key: string) => screen.getByRole('checkbox', { name: key }) as HTMLInputElement;
const checkboxes = () => screen.getAllByRole('checkbox') as HTMLInputElement[];
const selectAll = () => screen.getByRole('checkbox', { name: 'Select all' }) as HTMLInputElement;

describe('DeleteConfirmModal', () => {
  beforeEach(() => {
    useModalStackStore.getState().reset();
  });

  it('shows the warning, the count and every file ticked', async () => {
    await open({ files: FILES });

    expect(screen.getByText('Delete files')).toBeInTheDocument();
    expect(screen.getByText('This action cannot be undone.')).toBeInTheDocument();
    expect(screen.getByText('3/3 files')).toBeInTheDocument();
    expect(screen.getByText('(selected files)')).toBeInTheDocument();
    for (const f of FILES) expect(screen.getByText(f.key)).toBeInTheDocument();
    expect(checkboxes().every(c => c.checked)).toBe(true);
    expect(selectAll().indeterminate).toBe(false);
    expect(screen.getByRole('button', { name: 'Delete (3)' })).toBeEnabled();
  });

  it('puts Cancel on the left and Delete on the right of a non-wrapping footer', async () => {
    await open({ files: FILES });

    const footer = screen.getByRole('button', { name: 'Cancel' }).parentElement as HTMLElement;
    expect(footer.style.getPropertyValue('--group-wrap')).toBe('nowrap');
    expect(footer.style.getPropertyValue('--group-justify')).toBe('space-between');
    expect(Array.from(footer.querySelectorAll('button')).map(b => b.textContent)).toEqual(['Cancel', 'Delete (3)']);
  });

  it('unticking a file updates the count, goes indeterminate and resolves without it, in original order', async () => {
    const { result } = await open({ files: FILES });

    await userEvent.click(rowCheckbox('b.txt'));

    expect(rowCheckbox('b.txt').checked).toBe(false);
    expect(screen.getByText('2/3 files')).toBeInTheDocument();
    expect(selectAll().indeterminate).toBe(true);
    expect(selectAll().checked).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Delete (2)' }));

    await expect(result).resolves.toEqual(['a.txt', 'c.txt']);
  });

  it('re-ticking a file keeps the original order', async () => {
    const { result } = await open({ files: FILES });

    await userEvent.click(rowCheckbox('a.txt'));
    await userEvent.click(rowCheckbox('a.txt'));
    await userEvent.click(screen.getByRole('button', { name: 'Delete (3)' }));

    await expect(result).resolves.toEqual(['a.txt', 'b.txt', 'c.txt']);
  });

  it('the header checkbox unticks all, disables Delete, then ticks all again', async () => {
    await open({ files: FILES });

    await userEvent.click(selectAll());

    expect(screen.getByText('0/3 files')).toBeInTheDocument();
    expect(checkboxes().every(c => !c.checked)).toBe(true);
    expect(selectAll().indeterminate).toBe(false);
    expect(screen.getByRole('button', { name: 'Delete (0)' })).toBeDisabled();

    await userEvent.click(selectAll());

    expect(screen.getByText('3/3 files')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete (3)' })).toBeEnabled();
  });

  it('resolves null on Cancel', async () => {
    const { result } = await open({ files: FILES });

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await expect(result).resolves.toBeNull();
  });

  it('resolves null when closed with the X button', async () => {
    const { result } = await open({ files: FILES });

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));

    await expect(result).resolves.toBeNull();
  });

  it('handles an empty list: nothing to delete', async () => {
    await open({ files: [] });

    expect(screen.getByText('0/0 files')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete (0)' })).toBeDisabled();
  });
});
