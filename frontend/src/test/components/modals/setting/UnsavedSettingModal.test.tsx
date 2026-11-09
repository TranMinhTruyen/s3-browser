import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useModalStackStore } from '@/common/stores/modalStackStore';
import UnsavedSettingModal from '@/components/modals/setting/UnsavedSettingModal';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

const flush = () => act(async () => {});

function open() {
  renderWithProviders(<div />);
  let result!: ReturnType<typeof UnsavedSettingModal.show>;
  act(() => {
    result = UnsavedSettingModal.show();
  });
  return result;
}

describe('UnsavedSettingModal', () => {
  beforeEach(() => {
    useModalStackStore.getState().reset();
  });

  it('shows the title, the message and the three buttons', async () => {
    open();
    await flush();

    expect(screen.getByText('Unsaved settings')).toBeInTheDocument();
    expect(screen.getByText(/not saved or applied/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go back' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard changes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it.each([
    ['Go back', 'back'],
    ['Discard changes', 'discard'],
    ['Save', 'save'],
  ])('resolves with the choice when %s is clicked', async (name, choice) => {
    const result = open();
    await flush();

    await userEvent.click(screen.getByRole('button', { name }));

    await expect(result).resolves.toBe(choice);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('resolves back when closed with the X button', async () => {
    const result = open();
    await flush();

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));

    await expect(result).resolves.toBe('back');
  });

  it('resolves back when closed with Escape', async () => {
    const result = open();
    await flush();

    await userEvent.keyboard('{Escape}');

    await expect(result).resolves.toBe('back');
  });
});
