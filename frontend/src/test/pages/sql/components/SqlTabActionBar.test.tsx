import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import SqlTabActionBar from '@/pages/sql/components/SqlTabActionBar';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

const combo = vi.hoisted(() => ({ props: {} as Record<string, any> }));
vi.mock('@/components/inputs/combobox/Combobox', () => ({
  default: (props: Record<string, any>) => {
    combo.props = props;
    return (
      <button type="button" onClick={() => props.onChange('p2')}>
        {`picker:${props.value}`}
      </button>
    );
  },
}));

const options = [
  { name: 'One', value: 'p1' },
  { name: 'Two', value: 'p2' },
];

function setup(props: Partial<React.ComponentProps<typeof SqlTabActionBar>> = {}) {
  const handlers = { onChangeSelectProfile: vi.fn(), onClickConnect: vi.fn(), onClickExecute: vi.fn() };
  renderWithProviders(
    <SqlTabActionBar isConnected={false} selectedProfileId="p1" profileOptions={options} {...handlers} {...props} />
  );
  return handlers;
}

describe('SqlTabActionBar', () => {
  it('passes the options, selected value and translated texts to the profile picker', () => {
    setup();
    expect(combo.props.data).toBe(options);
    expect(combo.props.value).toBe('p1');
    expect(combo.props.searchPlaceholder).toBe('Search profile');
    expect(combo.props.emptyText).toBe('No profiles found');
  });

  it('reports the chosen profile', async () => {
    const { onChangeSelectProfile } = setup();
    await userEvent.click(screen.getByText('picker:p1'));
    expect(onChangeSelectProfile).toHaveBeenCalledWith('p2');
  });

  it('connects and executes from the buttons when a profile is chosen and not connected', async () => {
    const { onClickConnect, onClickExecute } = setup();

    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await userEvent.click(screen.getByRole('button', { name: 'Run SQL' }));

    expect(onClickConnect).toHaveBeenCalledTimes(1);
    expect(onClickExecute).toHaveBeenCalledTimes(1);
  });

  it('disables Connect when already connected but keeps Run SQL enabled', () => {
    setup({ isConnected: true });
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Run SQL' })).toBeEnabled();
  });

  it('disables both buttons when no profile is chosen', () => {
    setup({ selectedProfileId: null });
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Run SQL' })).toBeDisabled();
  });
});
