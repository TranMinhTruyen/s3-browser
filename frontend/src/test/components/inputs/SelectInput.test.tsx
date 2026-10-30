import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import SelectInput from '@/components/inputs/SelectInput';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

describe('SelectInput', () => {
  it('shows the selected option label and reports the picked value', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <SelectInput
        label="Theme"
        data={[
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ]}
        value="light"
        onChange={onChange}
        allowDeselect={false}
      />
    );

    const input = screen.getByRole('combobox', { name: 'Theme' });
    expect(input).toHaveValue('Light');

    await userEvent.click(input);
    await userEvent.click(await screen.findByRole('option', { name: 'Dark', hidden: true }));

    expect(onChange).toHaveBeenCalledWith('dark', expect.objectContaining({ value: 'dark', label: 'Dark' }));
  });
});
