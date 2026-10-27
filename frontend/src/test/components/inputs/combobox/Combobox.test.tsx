import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import Combobox from '@/components/inputs/combobox/Combobox';
import { renderWithProviders } from '@/test/renderWithProviders';

const data = [
  { name: 'Alpha', value: 'a' },
  { name: 'Beta', value: 'b' },
];

describe('Combobox', () => {
  it('shows the label as placeholder and a chevron when nothing is selected', () => {
    renderWithProviders(<Combobox label="Pick" data={data} />);
    expect(screen.getByRole('button', { name: /Pick/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
  });

  it('selects an option, reports it and shows its name', async () => {
    const onChange = vi.fn();
    renderWithProviders(<Combobox label="Pick" data={data} onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: /Pick/ }));
    await userEvent.click(await screen.findByText('Beta'));

    expect(onChange).toHaveBeenCalledWith('b');
    expect(screen.getByRole('button', { name: /Pick/ })).toHaveTextContent('Beta');
  });

  it('shows the default value and clears it', async () => {
    const onChange = vi.fn();
    renderWithProviders(<Combobox label="Pick" data={data} defaultValue="a" onChange={onChange} />);
    const trigger = screen.getByRole('button', { name: /Pick/ });
    expect(trigger).toHaveTextContent('Alpha');

    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(onChange).toHaveBeenCalledWith(null);
    expect(trigger).not.toHaveTextContent('Alpha');
  });

  it('opens on click and marks the active option', async () => {
    renderWithProviders(<Combobox label="Pick" data={data} value="a" />);
    const trigger = screen.getByRole('button', { name: /Pick/ });

    await userEvent.click(trigger);
    const [alpha, beta] = screen.getAllByRole('option', { hidden: true });
    expect(alpha.querySelector('svg')).not.toBeNull();
    expect(beta.querySelector('svg')).toBeNull();
  });

  it('selects the active option when opened with the keyboard', async () => {
    renderWithProviders(<Combobox label="Pick" data={data} value="b" />);
    const trigger = screen.getByRole('button', { name: /Pick/ });

    trigger.focus();
    await userEvent.keyboard('{ArrowDown}');

    const [alpha, beta] = screen.getAllByRole('option', { hidden: true });
    expect(beta).toHaveAttribute('data-combobox-selected', 'true');
    expect(alpha).not.toHaveAttribute('data-combobox-selected');
  });

  it('translates the error even when no label is given', () => {
    renderWithProviders(<Combobox data={data} error="V000001" />);
    expect(screen.getByRole('button')).toBeInTheDocument();
    expect(screen.getByText(/required/)).toBeInTheDocument();
  });

  it('does not offer a clear button when disabled', () => {
    renderWithProviders(<Combobox label="Pick" data={data} value="a" disabled />);
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
  });

  it('ignores a value that is not in the data and translates the error', () => {
    renderWithProviders(<Combobox label="Pick" data={data} value="zzz" error="V000001" />);
    expect(screen.getByText('Pick is required')).toBeInTheDocument();
  });

  it('forwards focus and blur', async () => {
    const onFocus = vi.fn();
    const onBlur = vi.fn();
    renderWithProviders(<Combobox label="Pick" data={data} onFocus={onFocus} onBlur={onBlur} />);

    await userEvent.tab();
    await userEvent.tab();

    expect(onFocus).toHaveBeenCalled();
    expect(onBlur).toHaveBeenCalled();
  });
});
