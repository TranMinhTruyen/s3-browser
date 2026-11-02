import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Button from '@/components/buttons/Button';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

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

  describe('truncated label tooltip', () => {
    const proto = Element.prototype;
    const original = {
      scrollWidth: Object.getOwnPropertyDescriptor(proto, 'scrollWidth'),
      clientWidth: Object.getOwnPropertyDescriptor(proto, 'clientWidth'),
    };
    const setWidths = (scrollWidth: number, clientWidth: number) => {
      Object.defineProperty(proto, 'scrollWidth', { configurable: true, get: () => scrollWidth });
      Object.defineProperty(proto, 'clientWidth', { configurable: true, get: () => clientWidth });
    };
    const hover = async (name: string) => {
      fireEvent.mouseEnter(screen.getByRole('button', { name }));
      fireEvent.mouseMove(screen.getByRole('button', { name }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
    };

    afterEach(() => {
      for (const key of ['scrollWidth', 'clientWidth'] as const) {
        const descriptor = original[key];
        if (descriptor) Object.defineProperty(proto, key, descriptor);
        else delete (proto as unknown as Record<string, unknown>)[key];
      }
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    const fake = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });

    it('shows no tooltip when the label fits', async () => {
      fake();
      setWidths(50, 50);
      renderWithProviders(<Button>Long label</Button>);
      await hover('Long label');
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });

    it('shows the label in a tooltip when it is truncated', async () => {
      setWidths(100, 50);
      renderWithProviders(<Button>Long label</Button>);
      const user = userEvent.setup();

      // Real timers on purpose: with fake timers RTL's asyncWrapper (setTimeout 0) hangs user-event, and the
      // tooltip is not enabled until React re-renders after the hover. findBy* waits for the 300ms openDelay.
      await user.hover(screen.getByRole('button', { name: 'Long label' }));

      expect(await screen.findByRole('tooltip')).toHaveTextContent('Long label');
    });

    it('shows no tooltip for non-string children even when truncated', async () => {
      fake();
      setWidths(100, 50);
      renderWithProviders(
        <Button>
          <span>Rich</span>
        </Button>
      );
      await hover('Rich');
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });

    it('still calls the caller onMouseEnter', () => {
      const onMouseEnter = vi.fn();
      renderWithProviders(<Button onMouseEnter={onMouseEnter}>Go</Button>);
      fireEvent.mouseEnter(screen.getByRole('button', { name: 'Go' }));
      expect(onMouseEnter).toHaveBeenCalledTimes(1);
    });

    it('shows no tooltip when the label element is not found', async () => {
      fake();
      setWidths(100, 50);
      const onMouseEnter = vi.fn();
      renderWithProviders(<Button onMouseEnter={onMouseEnter}>Go</Button>);
      vi.spyOn(HTMLButtonElement.prototype, 'querySelector').mockReturnValue(null);
      await hover('Go');
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
      expect(onMouseEnter).toHaveBeenCalledTimes(1);
    });
  });
});
