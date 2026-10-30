import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useModalStackStore } from '@/common/stores/modalStackStore';
import ConfirmModal from '@/components/modals/confirm/ConfirmModal';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

const flush = () => act(async () => {});

describe('ConfirmModal', () => {
  beforeEach(() => {
    useModalStackStore.getState().reset();
  });

  it('shows the info title and the message with substituted params, resolving true on OK', async () => {
    renderWithProviders(<div />);
    let result: Promise<boolean | null> | undefined;
    act(() => {
      result = ConfirmModal.show({ type: 'info', confirmCode: 'C000004', params: { object: 'a.txt' } });
    });
    await flush();

    expect(screen.getByText('Info')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(screen.getByText('Please confirm that you want to delete [a.txt] ?')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'OK' }));

    await expect(result).resolves.toBe(true);
  });

  it('puts Cancel on the left and OK on the right of a non-wrapping footer', async () => {
    renderWithProviders(<div />);
    act(() => {
      ConfirmModal.show({ type: 'info', confirmCode: 'C000004', params: { object: 'a.txt' } });
    });
    await flush();

    const footer = screen.getByRole('button', { name: 'Cancel' }).parentElement as HTMLElement;
    expect(footer.style.getPropertyValue('--group-wrap')).toBe('nowrap');
    expect(footer.style.getPropertyValue('--group-justify')).toBe('space-between');
    expect(Array.from(footer.querySelectorAll('button')).map(b => b.textContent)).toEqual(['Cancel', 'OK']);
  });

  it('shows the warning title and resolves false on Cancel', async () => {
    renderWithProviders(<div />);
    let result: Promise<boolean | null> | undefined;
    act(() => {
      result = ConfirmModal.show({ type: 'warning', confirmCode: 'C000003' });
    });
    await flush();

    expect(screen.getByText('Warning')).toBeInTheDocument();
    expect(screen.queryByText('Info')).not.toBeInTheDocument();
    expect(screen.getByText('Please disconnect before action!')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await expect(result).resolves.toBe(false);
  });
});
