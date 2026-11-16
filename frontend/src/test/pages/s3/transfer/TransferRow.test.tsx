import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import TransferRow from '@/pages/s3/transfer/TransferRow';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

const renderRow = (onCancel = vi.fn()) =>
  renderWithProviders(
    <TransferRow
      title="Object: a.bin"
      percent={40}
      ringLabel={<span>40%</span>}
      cancelTooltip="Cancel"
      onCancel={onCancel}
    >
      <span>details</span>
    </TransferRow>
  );

describe('TransferRow', () => {
  it('shows the title, the ring label and the children', () => {
    renderRow();

    expect(screen.getByText('Object: a.bin')).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
    expect(screen.getByText('details')).toBeInTheDocument();
  });

  it('renders the ring with the given percent', () => {
    const { container } = renderRow();
    expect(container.querySelectorAll('circle').length).toBeGreaterThan(1);
  });

  it('reveals the cancel button on hover, with a tooltip, and calls onCancel', async () => {
    const onCancel = vi.fn();
    renderRow(onCancel);

    await userEvent.hover(screen.getByText('Object: a.bin'));
    const button = screen.getByRole('button', { name: 'Cancel', hidden: true });
    await userEvent.hover(button);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Cancel');

    await userEvent.click(button);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('collapses the cancel button again when the pointer leaves', async () => {
    renderRow();
    const title = screen.getByText('Object: a.bin');

    await userEvent.hover(title);
    await userEvent.unhover(title);

    expect(title).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel', hidden: true })).toBeInTheDocument();
  });
});
