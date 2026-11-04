import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import WarningIcon from '@/components/display/WarningIcon';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

describe('WarningIcon', () => {
  it('labels the icon and uses the default size of 16', () => {
    renderWithProviders(<WarningIcon label="Careful" />);
    const icon = screen.getByLabelText('Careful');
    expect(icon).toHaveAttribute('width', '16');
    expect(icon).toHaveAttribute('height', '16');
  });

  it('applies a custom size', () => {
    renderWithProviders(<WarningIcon label="Careful" size={24} />);
    expect(screen.getByLabelText('Careful')).toHaveAttribute('width', '24');
  });

  it('shows the label in a tooltip on hover', async () => {
    renderWithProviders(<WarningIcon label="Careful" />);
    await userEvent.hover(screen.getByLabelText('Careful'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Careful');
  });
});
