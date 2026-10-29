import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VirtualItemList from '@/components/layouts/VirtualItemList';
import { renderWithProviders } from '@/test/renderWithProviders';

// The REAL virtualizer is used; jsdom has no layout, so give every element a 260px viewport.
const sizes = [
  ['offsetHeight', 260],
  ['offsetWidth', 400],
  ['clientHeight', 260],
  ['clientWidth', 400],
] as const;

const ITEM_HEIGHT = 80;
const ids = (n: number) => Array.from({ length: n }, (_, i) => `id${i}`);
const renderItem = (id: string) => <span data-testid="item">{id}</span>;
const itemWrapper = (id: string) => screen.getByText(id).parentElement as HTMLElement;

describe('VirtualItemList', () => {
  beforeEach(() => {
    for (const [prop, value] of sizes) {
      Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, value });
    }
  });

  afterEach(() => {
    for (const [prop] of sizes) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop];
  });

  it('renders no item and a zero-height track for an empty list', () => {
    const render = vi.fn(renderItem);
    const { container } = renderWithProviders(
      <VirtualItemList ids={[]} gap={8} itemHeight={ITEM_HEIGHT} renderItem={render} />
    );

    expect(render).not.toHaveBeenCalled();
    expect(screen.queryByTestId('item')).not.toBeInTheDocument();
    expect((container.querySelector('[style*="position: relative"]') as HTMLElement).style.height).toBe('0px');
  });

  it('shows every item of a short list, each placed by its offset with the gap', async () => {
    renderWithProviders(<VirtualItemList ids={ids(2)} gap={8} itemHeight={ITEM_HEIGHT} renderItem={renderItem} />);

    expect(await screen.findAllByTestId('item')).toHaveLength(2);
    expect(itemWrapper('id0').style.transform).toBe('translateY(0px)');
    expect(itemWrapper('id0').style.height).toBe('80px');
    expect(itemWrapper('id1').style.transform).toBe('translateY(88px)');
  });

  it('uses the given gap for the offsets and the total height', async () => {
    const { container } = renderWithProviders(
      <VirtualItemList ids={ids(2)} gap={10} itemHeight={ITEM_HEIGHT} renderItem={renderItem} />
    );

    await screen.findByText('id1');
    expect(itemWrapper('id1').style.transform).toBe('translateY(90px)');
    // 2 * 80 + 1 gap
    expect(container.querySelector('[style*="height: 170px"]') as HTMLElement | null).not.toBeNull();
  });

  it('uses the given itemHeight for the row height, offsets and total height', async () => {
    const { container } = renderWithProviders(
      <VirtualItemList ids={ids(2)} gap={8} itemHeight={50} renderItem={renderItem} />
    );

    await screen.findByText('id1');
    expect(itemWrapper('id0').style.height).toBe('50px');
    expect(itemWrapper('id1').style.transform).toBe('translateY(58px)');
    // 2 * 50 + 1 gap
    expect(container.querySelector('[style*="height: 108px"]')).not.toBeNull();
  });

  it('renders only a window of a long list but keeps the full scroll height', async () => {
    const { container } = renderWithProviders(
      <VirtualItemList ids={ids(100)} gap={8} itemHeight={ITEM_HEIGHT} renderItem={renderItem} />
    );

    await screen.findByText('id0');
    const rendered = screen.getAllByTestId('item').length;
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(100);
    expect(screen.queryByText('id99')).not.toBeInTheDocument();
    // 100 * 80 + 99 * 8
    expect(container.querySelector('[style*="height: 8792px"]')).not.toBeNull();
  });

  it('calls renderItem with the id of each visible row', async () => {
    const render = vi.fn(renderItem);
    renderWithProviders(<VirtualItemList ids={['a', 'b', 'c']} gap={8} itemHeight={ITEM_HEIGHT} renderItem={render} />);

    await screen.findByText('c');
    expect(render.mock.calls.map(c => c[0]).sort()).toEqual(expect.arrayContaining(['a', 'b', 'c']));
    expect(new Set(render.mock.calls.map(c => c[0]))).toEqual(new Set(['a', 'b', 'c']));
  });

  it('limits the height of the scroll area to 260px', () => {
    const { container } = renderWithProviders(
      <VirtualItemList ids={ids(1)} gap={8} itemHeight={ITEM_HEIGHT} renderItem={renderItem} />
    );

    const box = container.querySelector('[style*="max-height"]') as HTMLElement;
    expect(box.style.maxHeight).toBe('260px');
    expect(box.style.overflow).toBe('auto');
  });
});
