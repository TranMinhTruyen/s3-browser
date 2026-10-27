import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import Button from '@/components/buttons/Button';
import { renderWithProviders } from '@/test/renderWithProviders';

describe('Button', () => {
  it('calls onClick and stays enabled for a synchronous handler', async () => {
    const onClick = vi.fn();
    renderWithProviders(<Button onClick={onClick}>Go</Button>);

    await userEvent.click(screen.getByRole('button', { name: 'Go' }));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Go' })).toBeEnabled();
  });

  it('works without an onClick handler', async () => {
    renderWithProviders(<Button>Go</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(screen.getByRole('button', { name: 'Go' })).toBeEnabled();
  });

  it('is disabled and loading while an async handler is pending, then recovers', async () => {
    let finish: () => void = () => {};
    const onClick = vi.fn(() => new Promise<void>(resolve => (finish = resolve)));
    renderWithProviders(<Button onClick={onClick}>Go</Button>);
    const button = screen.getByRole('button', { name: 'Go' });

    await userEvent.click(button);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('data-loading', 'true');

    await act(async () => finish());
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute('data-loading');
  });

  it('prefers the explicit loading prop over the auto-tracked state', () => {
    renderWithProviders(<Button loading>Go</Button>);
    expect(screen.getByRole('button', { name: 'Go' })).toBeDisabled();
  });

  it('respects the disabled prop', async () => {
    const onClick = vi.fn();
    renderWithProviders(
      <Button disabled onClick={onClick}>
        Go
      </Button>
    );
    await userEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('exposes Group helpers', () => {
    renderWithProviders(
      <Button.Group>
        <Button>A</Button>
        <Button>B</Button>
      </Button.Group>
    );
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });
});
