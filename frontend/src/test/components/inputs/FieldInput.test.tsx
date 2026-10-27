import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import FieldInput from '@/components/inputs/FieldInput';
import { renderWithProviders } from '@/test/renderWithProviders';

describe('FieldInput', () => {
  it('renders a text input by default and translates the error with the label', async () => {
    const onChange = vi.fn();
    renderWithProviders(<FieldInput label="Name" error="V000001" onChange={onChange} />);

    await userEvent.type(screen.getByLabelText('Name'), 'a');

    expect(onChange).toHaveBeenCalled();
    expect(screen.getByText('Name is required')).toBeInTheDocument();
  });

  it('passes a non-string error through', () => {
    renderWithProviders(<FieldInput label="Name" error={<b>custom</b>} />);
    expect(screen.getByText('custom')).toBeInTheDocument();
  });

  it('renders a textarea', () => {
    renderWithProviders(<FieldInput type="textarea" label="Note" />);
    expect(screen.getByLabelText('Note').tagName).toBe('TEXTAREA');
  });

  it('renders a password input', () => {
    renderWithProviders(<FieldInput type="password" label="Secret" />);
    expect(screen.getByLabelText('Secret')).toHaveAttribute('type', 'password');
  });

  it('renders a number input', async () => {
    const onChange = vi.fn();
    renderWithProviders(<FieldInput type="number" label="Count" onChange={onChange} />);

    await userEvent.type(screen.getByLabelText('Count'), '7');

    expect(onChange).toHaveBeenLastCalledWith(7);
  });

  it('renders a json input', () => {
    renderWithProviders(<FieldInput type="json" label="Doc" />);
    expect(screen.getByLabelText('Doc').tagName).toBe('TEXTAREA');
  });

  it('renders a mask input', () => {
    renderWithProviders(<FieldInput type="mask" label="Phone" mask="000" />);
    expect(screen.getByLabelText('Phone')).toBeInTheDocument();
  });

  it('renders a pin input without the error prop', () => {
    renderWithProviders(<FieldInput type="pin" length={4} error />);
    expect(screen.getAllByRole('textbox')).toHaveLength(4);
  });

  it('renders a color input without the error prop', () => {
    renderWithProviders(<FieldInput type="color" label="Tint" error="V000001" />);
    expect(screen.getByLabelText('Tint')).toBeInTheDocument();
  });
});
