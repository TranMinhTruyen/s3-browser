import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import TagsInput from '@/components/inputs/TagsInput';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

describe('TagsInput', () => {
  it('turns typed text into tags and reports the list', async () => {
    const onChange = vi.fn();
    renderWithProviders(<TagsInput label="Buckets" onChange={onChange} splitChars={[',']} />);

    await userEvent.type(screen.getByRole('combobox', { name: 'Buckets' }), 'one,two{Enter}');

    expect(onChange).toHaveBeenLastCalledWith(['one', 'two']);
    expect(screen.getByText('one')).toBeInTheDocument();
    expect(screen.getByText('two')).toBeInTheDocument();
  });

  it('translates a validation code with the label', () => {
    renderWithProviders(<TagsInput label="Buckets" error="V000001" />);

    expect(screen.getByText('Buckets is required')).toBeInTheDocument();
  });

  it('shows an error that is not a code as it is', () => {
    renderWithProviders(<TagsInput label="Buckets" error={<span>custom error</span>} />);

    expect(screen.getByText('custom error')).toBeInTheDocument();
  });

  it('shows no error by default', () => {
    renderWithProviders(<TagsInput label="Buckets" />);

    expect(screen.queryByText(/required/)).not.toBeInTheDocument();
  });
});
