import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TransferPanel from '@/pages/s3/transfer/TransferPanel';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

const sizes = [
  ['offsetHeight', 260],
  ['offsetWidth', 400],
  ['clientHeight', 260],
  ['clientWidth', 400],
] as const;

const renderPanel = (over: Partial<Parameters<typeof TransferPanel>[0]> = {}) => {
  const onCancelAll = vi.fn();
  const onClose = vi.fn();
  const renderItem = vi.fn((id: string) => <span>{`row-${id}`}</span>);
  renderWithProviders(
    <TransferPanel
      title="Uploads"
      cancelAllTooltip="Cancel all"
      closeLabel="Close"
      ids={['a', 'b']}
      gap={8}
      renderItem={renderItem}
      onCancelAll={onCancelAll}
      onClose={onClose}
      {...over}
    />
  );
  return { onCancelAll, onClose, renderItem };
};

describe('TransferPanel', () => {
  beforeEach(() => {
    for (const [prop, value] of sizes) {
      Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, value });
    }
  });

  afterEach(() => {
    for (const [prop] of sizes) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop];
  });

  it('shows the title and renders a row per id', async () => {
    const { renderItem } = renderPanel();

    expect(screen.getByText('Uploads')).toBeInTheDocument();
    expect(await screen.findByText('row-a')).toBeInTheDocument();
    expect(screen.getByText('row-b')).toBeInTheDocument();
    expect(renderItem).toHaveBeenCalledWith('a');
  });

  it('renders no row for an empty list', () => {
    const { renderItem } = renderPanel({ ids: [] });
    expect(renderItem).not.toHaveBeenCalled();
  });

  it('cancel-all button has a tooltip and calls onCancelAll', async () => {
    const { onCancelAll, onClose } = renderPanel();
    const button = screen.getByRole('button', { name: 'Cancel all' });

    await userEvent.hover(button);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Cancel all');

    await userEvent.click(button);
    expect(onCancelAll).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows a Ban icon on cancel-all and an X icon on close, so the two buttons differ', () => {
    renderPanel();

    const cancelAll = screen.getByRole('button', { name: 'Cancel all' });
    const close = screen.getByRole('button', { name: 'Close' });
    expect(cancelAll.querySelector('svg.lucide-ban')).toBeInTheDocument();
    expect(cancelAll.querySelector('svg.lucide-x')).not.toBeInTheDocument();
    expect(close.querySelector('svg.lucide-x')).toBeInTheDocument();
  });

  it('close button shows closeLabel as tooltip on hover', async () => {
    renderPanel({ closeLabel: 'Dismiss' });

    await userEvent.hover(screen.getByRole('button', { name: 'Dismiss' }));

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Dismiss');
  });

  it('close button uses closeLabel as aria-label and calls onClose', async () => {
    const { onCancelAll, onClose } = renderPanel({ closeLabel: 'Dismiss' });

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCancelAll).not.toHaveBeenCalled();
  });
});
