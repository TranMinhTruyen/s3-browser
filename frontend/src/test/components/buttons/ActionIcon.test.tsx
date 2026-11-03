import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ActionIcon from '@/components/buttons/ActionIcon';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

describe('ActionIcon', () => {
  it('calls onClick and stays enabled for a synchronous handler', async () => {
    const onClick = vi.fn();
    renderWithProviders(<ActionIcon onClick={onClick} tooltip="go" />);

    await userEvent.click(screen.getByRole('button', { name: 'go' }));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'go' })).toBeEnabled();
  });

  it('works without an onClick handler', async () => {
    renderWithProviders(<ActionIcon tooltip="go" />);
    await userEvent.click(screen.getByRole('button', { name: 'go' }));
    expect(screen.getByRole('button', { name: 'go' })).toBeEnabled();
  });

  it('is disabled and loading while an async handler is pending, then recovers', async () => {
    let finish: () => void = () => {};
    const onClick = vi.fn(() => new Promise<void>(resolve => (finish = resolve)));
    renderWithProviders(<ActionIcon onClick={onClick} tooltip="go" />);

    const button = screen.getByRole('button', { name: 'go' });
    await userEvent.click(button);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('data-loading', 'true');
    expect(button.parentElement?.tagName).toBe('SPAN');

    await act(async () => finish());
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute('data-loading');
    expect(button.parentElement?.tagName).toBe('SPAN');
    expect(screen.getByRole('button', { name: 'go' })).toBe(button);
  });

  it('prefers the explicit loading prop over the auto-tracked state', () => {
    renderWithProviders(<ActionIcon loading tooltip="go" />);
    expect(screen.getByRole('button', { name: 'go' })).toBeDisabled();
  });

  it('respects the disabled prop and wraps the button in a span', async () => {
    const onClick = vi.fn();
    renderWithProviders(<ActionIcon disabled onClick={onClick} tooltip="go" />);
    const button = screen.getByRole('button', { name: 'go' });
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(button.parentElement?.tagName).toBe('SPAN');
    expect(button.parentElement).toHaveStyle({ display: 'inline-flex' });
  });

  it('keeps the same span and button DOM nodes when switching from enabled to disabled/loading', () => {
    const { rerender } = renderWithProviders(<ActionIcon tooltip="go" />);
    const button = screen.getByRole('button', { name: 'go' });
    const wrapper = button.parentElement as HTMLElement;
    expect(wrapper.tagName).toBe('SPAN');

    rerender(<ActionIcon tooltip="go" disabled />);
    expect(screen.getByRole('button', { name: 'go' })).toBe(button);
    expect(button).toBeDisabled();
    expect(button.parentElement).toBe(wrapper);

    rerender(<ActionIcon tooltip="go" loading />);
    expect(screen.getByRole('button', { name: 'go' })).toBe(button);
    expect(button).toHaveAttribute('data-loading', 'true');
    expect(button.parentElement).toBe(wrapper);
  });

  it('uses the tooltip as default aria-label and lets an explicit aria-label win', () => {
    renderWithProviders(
      <>
        <ActionIcon tooltip="Tip A" />
        <ActionIcon tooltip="Tip B" aria-label="Custom B" />
      </>
    );
    expect(screen.getByRole('button', { name: 'Tip A' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Custom B' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tip B' })).not.toBeInTheDocument();
  });

  it('shows the tooltip on hover', async () => {
    renderWithProviders(<ActionIcon tooltip="Hover me" />);
    await userEvent.hover(screen.getByRole('button', { name: 'Hover me' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Hover me');
  });

  it('shows the tooltip when hovering the wrapper of a disabled button', async () => {
    renderWithProviders(<ActionIcon disabled tooltip="Disabled tip" />);
    const wrapper = screen.getByRole('button', { name: 'Disabled tip' }).parentElement as HTMLElement;
    await userEvent.hover(wrapper);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Disabled tip');
  });

  it('applies margin props and style to the wrapper span, not the button', () => {
    renderWithProviders(<ActionIcon tooltip="go" ml={8} style={{ opacity: 0.5 }} />);
    const button = screen.getByRole('button', { name: 'go' });
    const wrapper = button.parentElement as HTMLElement;
    expect(wrapper.tagName).toBe('SPAN');
    expect(wrapper).toHaveStyle({ display: 'inline-flex', opacity: '0.5' });
    expect(wrapper.getAttribute('style')).toContain('margin-left');
    expect(button.getAttribute('style') ?? '').not.toContain('opacity');
    expect(button.getAttribute('style') ?? '').not.toContain('margin-left');
  });

  it('keeps className on the button', () => {
    renderWithProviders(<ActionIcon tooltip="go" className="my-class" />);
    const button = screen.getByRole('button', { name: 'go' });
    expect(button).toHaveClass('my-class');
    expect(button.parentElement).not.toHaveClass('my-class');
  });

  it('hides the tooltip while aria-expanded is true', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      renderWithProviders(<ActionIcon tooltip="Expanded tip" aria-expanded />);
      fireEvent.mouseEnter(screen.getByRole('button', { name: 'Expanded tip' }));
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('still shows the tooltip when aria-expanded is false', async () => {
    renderWithProviders(<ActionIcon tooltip="Collapsed tip" aria-expanded={false} />);
    await userEvent.hover(screen.getByRole('button', { name: 'Collapsed tip' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Collapsed tip');
  });

  it('exposes Group helpers', () => {
    renderWithProviders(
      <ActionIcon.Group>
        <ActionIcon tooltip="a" />
        <ActionIcon tooltip="b" />
      </ActionIcon.Group>
    );
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });
});
