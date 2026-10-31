import NiceModal from '@ebay/nice-modal-react';
import { act, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useModalStackStore } from '@/common/stores/modalStackStore';
import { createMantineModal, type WithMantineModal } from '@/common/utils/modalUtils';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

type BodyProps = WithMantineModal<{ label: string }, string>;
const captured = new Map<string, BodyProps['mantine']>();

const Body = ({ label, mantine }: BodyProps) => {
  captured.set(label, mantine);
  const { props } = mantine;
  return (
    <div
      data-testid={label}
      data-z={props.zIndex}
      data-opened={String(props.opened)}
      data-esc={String(props.closeOnEscape)}
    />
  );
};

const PlainModal = createMantineModal<{ label: string }, string>(Body);
const CancelModal = createMantineModal<{ label: string }, string>(Body, { cancelValue: 'cancelled' });
const flush = () => act(async () => {});

describe('createMantineModal', () => {
  beforeEach(() => {
    captured.clear();
    useModalStackStore.getState().reset();
  });

  it('shows the modal on the base z-index and resolves through the handler', async () => {
    renderWithProviders(<div />);
    let result: Promise<string | null> | undefined;
    act(() => {
      result = PlainModal.show({ label: 'a' });
    });
    await flush();

    expect(screen.getByTestId('a')).toHaveAttribute('data-opened', 'true');
    expect(screen.getByTestId('a')).toHaveAttribute('data-z', '200');

    act(() => {
      captured.get('a')?.handler.resolve('done');
    });
    await expect(result).resolves.toBe('done');
  });

  it('closing resolves null by default and the exit transition removes the modal', async () => {
    renderWithProviders(<div />);
    let result: Promise<string | null> | undefined;
    act(() => {
      result = PlainModal.show({ label: 'a' });
    });
    await flush();

    await act(async () => captured.get('a')?.props.onClose());
    await expect(result).resolves.toBeNull();
    await flush();
    expect(useModalStackStore.getState().stack).toEqual([]);

    act(() => captured.get('a')?.props.onExitTransitionEnd());
    await flush();
    expect(screen.queryByTestId('a')).toBeNull();
  });

  it('resolves the cancelValue when dismissed', async () => {
    renderWithProviders(<div />);
    let result: Promise<string | null> | undefined;
    act(() => {
      result = CancelModal.show({ label: 'c' });
    });
    await flush();

    await act(async () => captured.get('c')?.props.onClose());
    await expect(result).resolves.toBe('cancelled');
    await flush();
  });

  it('only the topmost modal can be closed and stacked modals get a higher z-index', async () => {
    renderWithProviders(<div />);
    let bottom: Promise<string | null> | undefined;
    act(() => {
      bottom = PlainModal.show({ label: 'bottom' });
    });
    await flush();
    act(() => {
      CancelModal.show({ label: 'top' });
    });
    await flush();

    expect(screen.getByTestId('top')).toHaveAttribute('data-z', '210');
    expect(screen.getByTestId('bottom')).toHaveAttribute('data-esc', 'false');
    expect(screen.getByTestId('top')).toHaveAttribute('data-esc', 'true');

    let settled = false;
    bottom?.then(() => {
      settled = true;
    });
    act(() => captured.get('bottom')?.props.onClose());
    await flush();
    expect(settled).toBe(false);
  });

  it('exposes hide and remove helpers', async () => {
    renderWithProviders(<div />);
    act(() => {
      PlainModal.show({ label: 'h' });
    });
    await flush();

    act(() => {
      PlainModal.hide();
    });
    await flush();
    expect(screen.getByTestId('h')).toHaveAttribute('data-opened', 'false');

    act(() => PlainModal.remove());
    await flush();
    expect(screen.queryByTestId('h')).toBeNull();
  });

  it('names the wrapper after the component, its displayName, or Anonymous', () => {
    const names: string[] = [];
    const create = NiceModal.create;
    const spy = vi.spyOn(NiceModal, 'create').mockImplementation(((comp: { displayName?: string }) => {
      names.push(comp.displayName ?? '');
      return create(comp as never);
    }) as never);

    function Named() {
      return null;
    }
    const Display = () => null;
    Display.displayName = 'Shown';
    createMantineModal(Named);
    createMantineModal(Display);
    createMantineModal(Object.defineProperty(() => null, 'name', { value: '' }));
    spy.mockRestore();

    expect(names).toEqual(['MantineModal(Named)', 'MantineModal(Shown)', 'MantineModal(Anonymous)']);
  });
});
