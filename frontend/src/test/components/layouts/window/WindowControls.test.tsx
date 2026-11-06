import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import WindowControls from '@/components/layouts/window/WindowControls';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

const rt = vi.hoisted(() => ({
  isMaximised: vi.fn(),
  minimise: vi.fn(),
  toggleMaximise: vi.fn(),
  close: vi.fn(),
  on: vi.fn(),
}));

vi.mock('@wailsio/runtime', () => ({
  Window: {
    IsMaximised: rt.isMaximised,
    Minimise: rt.minimise,
    ToggleMaximise: rt.toggleMaximise,
    Close: rt.close,
  },
  Events: {
    On: rt.on,
    Types: { Common: { WindowMaximise: 'max', WindowUnMaximise: 'unmax', WindowRestore: 'restore' } },
  },
}));

describe('WindowControls', () => {
  let unsubscribes: ReturnType<typeof vi.fn>[];
  let handlers: Record<string, () => void>;

  beforeEach(() => {
    vi.clearAllMocks();
    unsubscribes = [];
    handlers = {};
    rt.isMaximised.mockResolvedValue(false);
    rt.on.mockImplementation((type: string, cb: () => void) => {
      handlers[type] = cb;
      const unsubscribe = vi.fn();
      unsubscribes.push(unsubscribe);
      return unsubscribe;
    });
  });

  it('shows the Maximise label when the window is not maximised', async () => {
    renderWithProviders(<WindowControls />);

    expect(await screen.findByRole('button', { name: 'Maximise' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument();
  });

  it('shows the Restore label when the window is already maximised', async () => {
    rt.isMaximised.mockResolvedValue(true);
    renderWithProviders(<WindowControls />);

    expect(await screen.findByRole('button', { name: 'Restore' })).toBeInTheDocument();
  });

  it('follows the window state when a maximise event fires', async () => {
    renderWithProviders(<WindowControls />);
    await screen.findByRole('button', { name: 'Maximise' });

    rt.isMaximised.mockResolvedValue(true);
    await act(async () => handlers.max());
    expect(await screen.findByRole('button', { name: 'Restore' })).toBeInTheDocument();

    rt.isMaximised.mockResolvedValue(false);
    await act(async () => handlers.unmax());
    expect(await screen.findByRole('button', { name: 'Maximise' })).toBeInTheDocument();
  });

  it('subscribes to the three window events and unsubscribes all of them on unmount', async () => {
    const { unmount } = renderWithProviders(<WindowControls />);
    await screen.findByRole('button', { name: 'Maximise' });

    expect(rt.on).toHaveBeenCalledTimes(3);
    expect(Object.keys(handlers).sort()).toEqual(['max', 'restore', 'unmax']);
    unmount();
    expect(unsubscribes).toHaveLength(3);
    for (const unsubscribe of unsubscribes) expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('ignores an IsMaximised result that resolves after unmount', async () => {
    let resolve: (value: boolean) => void = () => {};
    rt.isMaximised.mockReturnValue(new Promise<boolean>(r => (resolve = r)));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { unmount } = renderWithProviders(<WindowControls />);

    unmount();
    await act(async () => resolve(true));

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('calls Minimise, ToggleMaximise and Close from the matching buttons', async () => {
    renderWithProviders(<WindowControls />);

    await userEvent.click(await screen.findByRole('button', { name: 'Minimise' }));
    expect(rt.minimise).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Maximise' }));
    expect(rt.toggleMaximise).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(rt.close).toHaveBeenCalledTimes(1);
  });

  it('renders the close button as the shared large CloseButton with a tooltip', async () => {
    renderWithProviders(<WindowControls />);

    const close = await screen.findByRole('button', { name: 'Close' });
    expect(close).toHaveAttribute('data-size', 'lg');
    expect(close).toHaveAttribute('type', 'button');
    expect(close.querySelector('svg.lucide-x')).toBeInTheDocument();
    await userEvent.hover(close);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Close');
  });
});
