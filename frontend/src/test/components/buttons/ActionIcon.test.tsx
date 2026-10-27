import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ActionIcon from '@/components/buttons/ActionIcon';
import { renderWithProviders } from '@/test/renderWithProviders';

describe('ActionIcon', () => {
  it('calls onClick and stays enabled for a synchronous handler', async () => {
    const onClick = vi.fn();
    renderWithProviders(<ActionIcon onClick={onClick} aria-label="go" />);

    await userEvent.click(screen.getByRole('button', { name: 'go' }));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'go' })).toBeEnabled();
  });

  it('works without an onClick handler', async () => {
    renderWithProviders(<ActionIcon aria-label="go" />);
    await userEvent.click(screen.getByRole('button', { name: 'go' }));
    expect(screen.getByRole('button', { name: 'go' })).toBeEnabled();
  });

  it('is disabled and loading while an async handler is pending, then recovers', async () => {
    let finish: () => void = () => {};
    const onClick = vi.fn(() => new Promise<void>(resolve => (finish = resolve)));
    renderWithProviders(<ActionIcon onClick={onClick} aria-label="go" />);
    const button = screen.getByRole('button', { name: 'go' });

    await userEvent.click(button);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('data-loading', 'true');

    await act(async () => finish());
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute('data-loading');
  });

  it('prefers the explicit loading prop over the auto-tracked state', () => {
    renderWithProviders(<ActionIcon loading aria-label="go" />);
    expect(screen.getByRole('button', { name: 'go' })).toBeDisabled();
  });

  it('respects the disabled prop', async () => {
    const onClick = vi.fn();
    renderWithProviders(<ActionIcon disabled onClick={onClick} aria-label="go" />);
    await userEvent.click(screen.getByRole('button', { name: 'go' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('exposes Group helpers', () => {
    renderWithProviders(
      <ActionIcon.Group>
        <ActionIcon aria-label="a" />
        <ActionIcon aria-label="b" />
      </ActionIcon.Group>
    );
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });
});
