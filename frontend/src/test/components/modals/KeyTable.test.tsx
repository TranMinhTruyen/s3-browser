import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import KeyTable from '@/components/modals/KeyTable';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

// jsdom has no layout, so the real virtualizer would render no row: render every row instead.
const virtual = vi.hoisted(() => ({ scrollElement: undefined as unknown, estimate: 0 }));
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({
    count,
    getScrollElement,
    estimateSize,
  }: {
    count: number;
    getScrollElement: () => unknown;
    estimateSize: () => number;
  }) => ({
    getVirtualItems: () => {
      virtual.scrollElement = getScrollElement();
      virtual.estimate = estimateSize();
      return Array.from({ length: count }, (_, index) => ({ key: index, index, start: index * 32 }));
    },
    getTotalSize: () => count * 32,
    measureElement: () => {},
  }),
}));

describe('KeyTable', () => {
  it('shows only the key column when no row has an error', () => {
    renderWithProviders(
      <KeyTable rows={[{ key: 'a.txt' }, { key: 'b.txt' }]} keyLabel="File name" errorLabel="Reason" />
    );

    expect(screen.getAllByRole('columnheader').map(h => h.textContent)).toEqual(['File name']);
    expect(screen.getAllByRole('cell').map(c => c.textContent)).toEqual(['a.txt', 'b.txt']);
  });

  it('shows the reason column once a row has an error', () => {
    renderWithProviders(
      <KeyTable rows={[{ key: 'a.txt' }, { key: 'b.txt', error: 'denied' }]} keyLabel="File name" errorLabel="Reason" />
    );

    expect(screen.getAllByRole('columnheader').map(h => h.textContent)).toEqual(['File name', 'Reason']);
    const rows = screen.getAllByRole('row').slice(1);
    expect(
      within(rows[1])
        .getAllByRole('cell')
        .map(c => c.textContent)
    ).toEqual(['b.txt', 'denied']);
  });

  it('shows the reason column for an empty-string error', () => {
    renderWithProviders(<KeyTable rows={[{ key: 'a', error: '' }]} keyLabel="K" errorLabel="R" />);

    expect(screen.getAllByRole('columnheader')).toHaveLength(2);
  });

  it('renders only the header for no rows', () => {
    renderWithProviders(<KeyTable rows={[]} keyLabel="File name" />);

    expect(screen.getAllByRole('row')).toHaveLength(1);
    expect(screen.queryAllByRole('cell')).toHaveLength(0);
  });

  it('scrolls inside the default max height with a 32px row estimate', () => {
    renderWithProviders(<KeyTable rows={[{ key: 'a' }]} keyLabel="K" />);

    expect(virtual.estimate).toBe(32);
    expect(virtual.scrollElement).toBeInstanceOf(HTMLElement);
    expect((virtual.scrollElement as HTMLElement).style.maxHeight).toBe('320px');
  });

  it('uses the given max height', () => {
    renderWithProviders(<KeyTable rows={[{ key: 'a' }]} keyLabel="K" maxHeight={100} />);

    expect((virtual.scrollElement as HTMLElement).style.maxHeight).toBe('100px');
  });
});
