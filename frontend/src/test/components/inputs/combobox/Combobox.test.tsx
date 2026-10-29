import { fireEvent, screen, waitFor } from '@testing-library/react';
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

  describe('search', () => {
    const open = () => userEvent.click(screen.getByRole('button', { name: /Pick/ }));
    const optionNames = () => screen.queryAllByRole('option', { hidden: true }).map(o => o.textContent);

    it('does not render a search box without searchPlaceholder', async () => {
      renderWithProviders(<Combobox label="Pick" data={data} />);
      await open();
      expect(screen.queryByPlaceholderText('Find')).not.toBeInTheDocument();
      expect(optionNames()).toEqual(['Alpha', 'Beta']);
    });

    it('filters options by name ignoring case and surrounding spaces', async () => {
      renderWithProviders(<Combobox label="Pick" data={data} searchPlaceholder="Find" />);
      await open();
      fireEvent.change(await screen.findByPlaceholderText('Find'), { target: { value: '  BE ' } });
      expect(optionNames()).toEqual(['Beta']);
    });

    it('shows all options for a blank keyword', async () => {
      renderWithProviders(<Combobox label="Pick" data={data} searchPlaceholder="Find" />);
      await open();
      fireEvent.change(await screen.findByPlaceholderText('Find'), { target: { value: '   ' } });
      expect(optionNames()).toEqual(['Alpha', 'Beta']);
    });

    it('shows emptyText when nothing matches', async () => {
      renderWithProviders(<Combobox label="Pick" data={data} searchPlaceholder="Find" emptyText="Nothing here" />);
      await open();
      fireEvent.change(await screen.findByPlaceholderText('Find'), { target: { value: 'zzz' } });
      expect(optionNames()).toEqual([]);
      expect(screen.getByText('Nothing here')).toBeInTheDocument();
    });

    it('shows no empty message when nothing matches and emptyText is not given', async () => {
      renderWithProviders(<Combobox label="Pick" data={data} searchPlaceholder="Find" />);
      await open();
      fireEvent.change(await screen.findByPlaceholderText('Find'), { target: { value: 'zzz' } });
      expect(optionNames()).toEqual([]);
      expect(screen.queryByText('Nothing here')).not.toBeInTheDocument();
    });

    it('does not show emptyText while options are listed', async () => {
      renderWithProviders(<Combobox label="Pick" data={data} searchPlaceholder="Find" emptyText="Nothing here" />);
      await open();
      expect(screen.queryByText('Nothing here')).not.toBeInTheDocument();
    });

    it('focuses the search box when the dropdown opens', async () => {
      // jsdom cannot focus inside the display:none transition wrapper, so assert the focus() call target.
      const focus = vi.spyOn(HTMLInputElement.prototype, 'focus');
      renderWithProviders(<Combobox label="Pick" data={data} searchPlaceholder="Find" />);
      await open();
      const search = await screen.findByPlaceholderText('Find');
      await waitFor(() => expect(focus.mock.contexts).toContain(search));
    });

    it.each([
      ['pressing Escape', async () => userEvent.keyboard('{Escape}')],
      ['clicking outside', async () => userEvent.click(document.body)],
      ['clicking the trigger', async () => userEvent.click(screen.getByRole('button', { name: /Pick/ }))],
      ['choosing an option', async () => userEvent.click(screen.getByRole('option', { name: 'Beta', hidden: true }))],
    ])('resets the keyword after closing by %s and reopening', async (_name, close) => {
      renderWithProviders(<Combobox label="Pick" data={data} searchPlaceholder="Find" />);
      await open();
      fireEvent.change(await screen.findByPlaceholderText('Find'), { target: { value: 'be' } });
      expect(optionNames()).toEqual(['Beta']);

      await close();
      await open();

      expect(await screen.findByPlaceholderText('Find')).toHaveValue('');
      expect(optionNames()).toEqual(['Alpha', 'Beta']);
    });
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
