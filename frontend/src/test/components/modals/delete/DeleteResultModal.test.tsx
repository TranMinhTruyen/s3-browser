import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useModalStackStore } from '@/common/stores/modalStackStore';
import DeleteResultModal from '@/components/modals/delete/DeleteResultModal';
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

type Props = Parameters<typeof DeleteResultModal.show>[0];
async function open(props: Props) {
  renderWithProviders(<div />);
  let result: Promise<unknown> | undefined;
  act(() => {
    result = DeleteResultModal.show(props);
  });
  await flush();
  return { result: result as Promise<unknown> };
}

describe('DeleteResultModal', () => {
  beforeEach(() => {
    useModalStackStore.getState().reset();
  });

  it('shows only the counts when there is nothing to list', async () => {
    await open({ deleted: 3, failed: 0, failures: [] });

    expect(screen.getByText('Delete result')).toBeInTheDocument();
    expect(screen.getByText('Succeeded: 3')).toBeInTheDocument();
    expect(screen.getByText('Failed: 0')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^(Failed|Succeeded) \(/ })).not.toBeInTheDocument();
  });

  it('colours the failed badge red only when something failed', async () => {
    await open({ deleted: 1, failed: 1, failures: [] });
    const red = screen.getByText('Failed: 1').closest('.mantine-Badge-root') as HTMLElement;
    expect(red.getAttribute('style')).toContain('--mantine-color-red-6');
    expect(screen.getByText('Succeeded: 1').closest('.mantine-Badge-root')?.getAttribute('style')).toContain(
      '--mantine-color-green-6'
    );
  });

  it('greys the failed badge when nothing failed', async () => {
    await open({ deleted: 1, failed: 0, failures: [] });

    const grey = screen.getByText('Failed: 0').closest('.mantine-Badge-root') as HTMLElement;
    expect(grey.getAttribute('style')).toContain('--mantine-color-gray-6');
    expect(grey.getAttribute('style')).not.toContain('--mantine-color-red-6');
  });

  it('lists the failures with their reason, open by default', async () => {
    await open({
      deleted: 1,
      failed: 2,
      failures: [
        { key: 'a.txt', error: 'denied' },
        { key: 'b.txt', error: 'locked' },
      ],
    });

    expect(screen.getByRole('button', { name: 'Failed (2)' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('a.txt')).toBeInTheDocument();
    expect(screen.getByText('denied')).toBeInTheDocument();
    expect(screen.getByText('locked')).toBeInTheDocument();
    expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Succeeded \(/ })).not.toBeInTheDocument();
  });

  it('says how many errors are shown when the failures were cut', async () => {
    await open({ deleted: 0, failed: 5, failures: [{ key: 'a.txt', error: 'denied' }] });

    expect(screen.getByText('Showing 1/5 errors')).toBeInTheDocument();
  });

  it('lists the deleted keys, open by default when nothing failed', async () => {
    await open({ deleted: 2, failed: 0, deletedKeys: ['a.txt', 'b.txt'], failures: [] });

    expect(screen.getByRole('button', { name: 'Succeeded (2)' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('a.txt')).toBeInTheDocument();
    expect(screen.getByText('b.txt')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('has both sections when some failed, and opens the deleted one on click', async () => {
    await open({
      deleted: 1,
      failed: 1,
      deletedKeys: ['ok.txt'],
      failures: [{ key: 'bad.txt', error: 'denied' }],
    });

    expect(screen.getByRole('button', { name: 'Failed (1)' })).toHaveAttribute('aria-expanded', 'true');
    const deletedSection = screen.getByRole('button', { name: 'Succeeded (1)' });
    expect(deletedSection).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(deletedSection);

    expect(deletedSection).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByText('ok.txt')).toBeInTheDocument();
  });

  it('shows the rows again after the section is closed and reopened', async () => {
    await open({ deleted: 0, failed: 1, failures: [{ key: 'bad.txt', error: 'denied' }] });
    const section = screen.getByRole('button', { name: 'Failed (1)' });

    await userEvent.click(section);
    await waitFor(() => expect(screen.queryByText('bad.txt')).not.toBeInTheDocument());
    await userEvent.click(section);

    expect(await screen.findByText('bad.txt')).toBeInTheDocument();
    expect(screen.getByText('denied')).toBeInTheDocument();
  });

  it('shows no deleted section when deletedKeys is empty', async () => {
    await open({ deleted: 4, failed: 0, deletedKeys: [], failures: [] });

    expect(screen.queryByRole('button', { name: /^Succeeded \(/ })).not.toBeInTheDocument();
  });

  it('resolves on OK', async () => {
    const { result } = await open({ deleted: 1, failed: 0, failures: [] });

    await userEvent.click(screen.getByRole('button', { name: 'OK' }));

    await expect(result).resolves.toBeUndefined();
  });

  it('has a close button', async () => {
    await open({ deleted: 1, failed: 0, failures: [] });

    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });
});
