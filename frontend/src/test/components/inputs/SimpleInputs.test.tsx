import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import CheckBoxInput from '@/components/inputs/CheckBoxInput';
import SegmentedControl from '@/components/inputs/SegmentedControl';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

describe('CheckBoxInput', () => {
  it('toggles and reports the change', async () => {
    const onChange = vi.fn();
    renderWithProviders(<CheckBoxInput label="Agree" onChange={onChange} />);

    await userEvent.click(screen.getByLabelText('Agree'));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Agree')).toBeChecked();
  });
});

describe('SegmentedControl', () => {
  it('calls onChange with the chosen value', async () => {
    const onChange = vi.fn();
    renderWithProviders(<SegmentedControl data={['A', 'B']} onChange={onChange} />);

    await userEvent.click(screen.getByLabelText('B'));

    expect(onChange).toHaveBeenCalledWith('B');
  });
});
