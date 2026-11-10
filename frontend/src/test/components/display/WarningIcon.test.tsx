import { MantineProvider } from '@mantine/core';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import WarningIcon from '@/components/display/WarningIcon';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

// env="test" makes Mantine render transitions at once (no timers, no portal animation).
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
    render(
      <MantineProvider env="test">
        <WarningIcon label="Careful" />
      </MantineProvider>
    );
    const icon = screen.getByLabelText('Careful');
    fireEvent.pointerEnter(icon, { pointerType: 'mouse' });
    fireEvent.mouseEnter(icon);
    await act(async () => {});
    expect(screen.getByRole('tooltip')).toHaveTextContent('Careful');
  });
});
