import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DeleteKeyList from '@/pages/s3/modals/delete/DeleteKeyList';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

const virtualizer = vi.hoisted(() => ({
  options: undefined as
    | undefined
    | { count: number; getScrollElement: () => HTMLElement | null; estimateSize: () => number },
}));

// jsdom has no layout, so the real virtualizer would render no row: render every row instead.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (options: NonNullable<typeof virtualizer.options>) => {
    virtualizer.options = options;
    return {
      getVirtualItems: () =>
        Array.from({ length: options.count }, (_, index) => ({ key: index, index, start: index * 56 })),
      getTotalSize: () => options.count * 56,
      measureElement: () => {},
    };
  },
}));

describe('DeleteKeyList', () => {
  beforeEach(() => {
    virtualizer.options = undefined;
  });

  it('renders nothing for no rows', () => {
    renderWithProviders(<DeleteKeyList rows={[]} />);

    expect(virtualizer.options?.count).toBe(0);
    expect(screen.queryByText(/./)).not.toBeInTheDocument();
  });

  it('shows the last segment of a file key, without the failure line when there is no error', () => {
    const { container } = renderWithProviders(<DeleteKeyList rows={[{ key: 'dir/sub/a.txt' }]} />);

    expect(screen.getByText('a.txt')).toBeInTheDocument();
    expect(screen.queryByText('dir/sub/a.txt')).not.toBeInTheDocument();
    expect(container.querySelector('svg.lucide-file')).toBeInTheDocument();
    expect(container.querySelector('svg.lucide-folder')).not.toBeInTheDocument();
  });

  it('uses a folder icon and drops the trailing slash from the name', () => {
    const { container } = renderWithProviders(<DeleteKeyList rows={[{ key: 'dir/sub/' }]} />);

    expect(screen.getByText('sub')).toBeInTheDocument();
    expect(container.querySelector('svg.lucide-folder')).toBeInTheDocument();
    expect(container.querySelector('svg.lucide-file')).not.toBeInTheDocument();
  });

  it('falls back to the whole key when it has no usable last segment', () => {
    renderWithProviders(<DeleteKeyList rows={[{ key: '/' }]} />);

    expect(screen.getByText('/')).toBeInTheDocument();
  });

  it('shows the error reason of a failed key', () => {
    renderWithProviders(<DeleteKeyList rows={[{ key: 'a.txt', error: 'denied' }]} />);

    expect(screen.getByText('a.txt')).toBeInTheDocument();
    expect(screen.getByText('denied')).toBeInTheDocument();
  });

  it('shows the full key in a tooltip when the name differs from it', async () => {
    renderWithProviders(<DeleteKeyList rows={[{ key: 'dir/long-name.txt' }, { key: 'plain.txt' }]} />);

    await userEvent.hover(screen.getByText('long-name.txt'));

    expect(await screen.findByText('dir/long-name.txt')).toBeInTheDocument();
  });

  it('shows no tooltip when the name equals the key and is not cut', async () => {
    renderWithProviders(<DeleteKeyList rows={[{ key: 'dir/long-name.txt' }, { key: 'plain.txt' }]} />);
    const name = screen.getByText('plain.txt');
    Object.defineProperty(name, 'scrollWidth', { configurable: true, value: 50 });
    Object.defineProperty(name, 'clientWidth', { configurable: true, value: 100 });

    await userEvent.hover(name);

    expect(screen.getAllByText('plain.txt')).toHaveLength(1);
  });

  it('shows the key in a tooltip when the name equals the key but is cut', async () => {
    renderWithProviders(<DeleteKeyList rows={[{ key: 'plain.txt' }]} />);
    const name = screen.getByText('plain.txt');
    Object.defineProperty(name, 'scrollWidth', { configurable: true, value: 200 });
    Object.defineProperty(name, 'clientWidth', { configurable: true, value: 100 });

    await userEvent.hover(name);

    await waitFor(() => expect(screen.getAllByText('plain.txt')).toHaveLength(2));
  });

  it('gives the virtualizer the scroll element, a fixed estimate and the row count', async () => {
    const { container } = renderWithProviders(<DeleteKeyList rows={[{ key: 'a' }, { key: 'b' }]} maxHeight={100} />);

    expect(virtualizer.options?.count).toBe(2);
    expect(virtualizer.options?.estimateSize()).toBe(56);
    const scroller = virtualizer.options?.getScrollElement();
    expect(scroller).toBeInstanceOf(HTMLDivElement);
    expect(container.contains(scroller as HTMLElement)).toBe(true);
    expect((scroller as HTMLElement).style.maxHeight).toBe('100px');
  });

  it('defaults the list height limit to 20rem', () => {
    renderWithProviders(<DeleteKeyList rows={[{ key: 'a' }]} />);

    const scroller = virtualizer.options?.getScrollElement() as HTMLElement;
    expect(scroller.style.maxHeight).toBe('20rem');
  });
});
