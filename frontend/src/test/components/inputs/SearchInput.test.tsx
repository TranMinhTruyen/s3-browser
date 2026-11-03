import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import SearchInput from '@/components/inputs/SearchInput';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

function setup(props: Partial<React.ComponentProps<typeof SearchInput>> = {}) {
  const onSearch = vi.fn();
  const onClear = vi.fn();
  renderWithProviders(
    <SearchInput
      placeholder="Find"
      searchLabel="Do search"
      clearLabel="Do clear"
      onSearch={onSearch}
      onClear={onClear}
      {...props}
    />
  );
  return { onSearch, onClear, user: userEvent.setup(), input: screen.getByPlaceholderText('Find') };
}

describe('SearchInput', () => {
  it('searches the trimmed keyword when Enter is pressed', async () => {
    const { user, input, onSearch, onClear } = setup();
    await user.type(input, '  abc  {Enter}');
    expect(onSearch).toHaveBeenCalledExactlyOnceWith('abc');
    expect(onClear).not.toHaveBeenCalled();
  });

  it('ignores other keys', async () => {
    const { user, input, onSearch, onClear } = setup();
    await user.type(input, 'abc');
    expect(onSearch).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
  });

  it('searches when the search button is clicked', async () => {
    const { user, input, onSearch } = setup();
    await user.type(input, 'key');
    await user.click(screen.getByRole('button', { name: 'Do search' }));
    expect(onSearch).toHaveBeenCalledExactlyOnceWith('key');
  });

  it('clears instead of searching when the text is empty or blank', async () => {
    const { user, input, onSearch, onClear } = setup();
    await user.click(screen.getByRole('button', { name: 'Do search' }));
    expect(onClear).toHaveBeenCalledTimes(1);
    await user.type(input, '   {Enter}');
    expect(onClear).toHaveBeenCalledTimes(2);
    expect(onSearch).not.toHaveBeenCalled();
  });

  it('starts with the given value', () => {
    const { input } = setup({ value: 'init' });
    expect(input).toHaveValue('init');
  });

  it('empties the text and notifies when the clear button is clicked', async () => {
    const { user, input, onClear } = setup({ value: 'init' });
    await user.click(screen.getByRole('button', { name: 'Do clear' }));
    expect(input).toHaveValue('');
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Do clear' })).not.toBeInTheDocument();
  });

  it('shows no clear button while the text is empty', () => {
    setup();
    expect(screen.queryByRole('button', { name: 'Do clear' })).not.toBeInTheDocument();
  });

  it('is inert when disabled', () => {
    const { input, onSearch, onClear } = setup({ disabled: true, value: 'init' });
    expect(input).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Do search' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Do clear' })).not.toBeInTheDocument();
    expect(onSearch).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
  });

  it('ignores Enter when disabled', () => {
    const { input, onSearch, onClear } = setup({ disabled: true, value: 'init' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSearch).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
  });
});
