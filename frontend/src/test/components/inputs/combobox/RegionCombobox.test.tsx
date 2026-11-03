import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMasterDataStore } from '@/common/stores/masterDataStore';
import RegionCombobox from '@/components/inputs/combobox/RegionCombobox';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));
vi.mock('@wails/S3Browser/internal/handlers/masterhandler', () => ({
  GetMasterData: vi.fn(),
  GetRegionData: vi.fn(),
}));

const region = (name: string, value1: string | null, sortOrder?: number) => ({ name, value1, sortOrder }) as never;

describe('RegionCombobox', () => {
  beforeEach(() => {
    useMasterDataStore.setState({
      regionData: {
        '01': [
          region('Tokyo', 'ap-northeast-1', 2),
          region('Mumbai', 'ap-south-1'),
          region('Seoul', 'ap-northeast-2', 1),
        ],
        '02': [region('Ohio', 'us-east-2'), region('NoCode', null)],
        '03': undefined,
      },
    });
  });

  it('shows the placeholder and the translated label', () => {
    renderWithProviders(<RegionCombobox />);
    expect(screen.getByRole('button', { name: /Region/ })).toBeInTheDocument();
    expect(screen.getByText('Select region')).toBeInTheDocument();
  });

  it('lists grouped, sorted regions and selects one', async () => {
    const onChange = vi.fn();
    renderWithProviders(<RegionCombobox onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: /Region/ }));

    expect(await screen.findByText('Asia Pacific')).toBeInTheDocument();
    expect(screen.getByText('North America')).toBeInTheDocument();
    const names = screen.getAllByRole('option', { hidden: true }).map(o => o.textContent);
    expect(names.slice(0, 3)).toEqual(['Seoul[ap-northeast-2]', 'Tokyo[ap-northeast-1]', 'Mumbai[ap-south-1]']);

    await userEvent.click(screen.getByText('Ohio'));

    expect(onChange).toHaveBeenCalledWith('us-east-2');
    expect(screen.getByRole('button', { name: /Region/ })).toHaveTextContent('Ohio[us-east-2]');
  });

  it('shows the selected region and clears it', async () => {
    const onChange = vi.fn();
    renderWithProviders(<RegionCombobox defaultValue="ap-south-1" onChange={onChange} />);
    const trigger = screen.getByRole('button', { name: /Region/ });
    expect(trigger).toHaveTextContent('Mumbai[ap-south-1]');

    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(onChange).toHaveBeenCalledWith(null);
    expect(trigger).toHaveTextContent('Select region');
  });

  it('opens on click and marks the active option', async () => {
    renderWithProviders(<RegionCombobox value="ap-south-1" />);
    const trigger = screen.getByRole('button', { name: /Region/ });

    await userEvent.click(trigger);
    const options = screen.getAllByRole('option', { hidden: true });
    const active = options.filter(o => o.querySelector('svg'));
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveTextContent('Mumbai');
  });

  it('selects the active option when opened with the keyboard', async () => {
    renderWithProviders(<RegionCombobox value="ap-south-1" />);

    screen.getByRole('button', { name: /Region/ }).focus();
    await userEvent.keyboard('{ArrowDown}');

    const selected = screen
      .getAllByRole('option', { hidden: true })
      .filter(o => o.hasAttribute('data-combobox-selected'));
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveTextContent('Mumbai');
  });

  it('hides the clear button when disabled and translates the error', () => {
    renderWithProviders(<RegionCombobox value="ap-south-1" disabled error="V000001" />);
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
    expect(screen.getByText('Region is required')).toBeInTheDocument();
  });

  it('forwards focus and blur', async () => {
    const onFocus = vi.fn();
    const onBlur = vi.fn();
    renderWithProviders(<RegionCombobox onFocus={onFocus} onBlur={onBlur} />);

    await userEvent.tab();
    await userEvent.tab();

    expect(onFocus).toHaveBeenCalled();
    expect(onBlur).toHaveBeenCalled();
  });
});
