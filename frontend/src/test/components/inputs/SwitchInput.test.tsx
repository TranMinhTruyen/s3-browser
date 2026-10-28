import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChangeEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import SwitchInput from '@/components/inputs/SwitchInput';
import { renderWithProviders } from '@/test/renderWithProviders';

describe('SwitchInput', () => {
  it('reflects checked and fires onChange when toggled', async () => {
    const onChange = vi.fn((e: ChangeEvent<HTMLInputElement>) => e.currentTarget.checked);
    renderWithProviders(<SwitchInput label="Auto" checked={false} onChange={onChange} />);

    const toggle = screen.getByRole('switch', { name: 'Auto' });
    expect(toggle).not.toBeChecked();

    await userEvent.click(toggle);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.results[0].value).toBe(true);
  });

  it('renders checked state and honours disabled', () => {
    renderWithProviders(<SwitchInput label="Auto" checked onChange={vi.fn()} disabled />);

    const toggle = screen.getByRole('switch', { name: 'Auto' });
    expect(toggle).toBeChecked();
    expect(toggle).toBeDisabled();
  });
});
