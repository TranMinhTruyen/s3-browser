import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import AuthAnonymousFields from '@/pages/s3/modals/connect/fields/AuthAnonymousFields';
import { Harness, type Patch, type Probe, values } from '@/test/_helpers/authFieldsHarness';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

describe('AuthAnonymousFields', () => {
  const setup = (patch: Patch = {}) => {
    const probe: Probe = {};
    renderWithProviders(
      <Harness initial={values({ authType: 'anonymous', ...patch })} probe={probe}>
        {form => <AuthAnonymousFields form={form} />}
      </Harness>
    );
    return probe;
  };

  it('asks for the required bucket names and explains why', () => {
    setup();

    const field = screen.getByRole('combobox', { name: /Buckets/ });
    expect(field).toHaveAttribute('placeholder', 'Type a bucket name and press Enter');
    expect(screen.getByText(/Anonymous access cannot list buckets/)).toBeInTheDocument();
    expect(screen.getByText('*')).toBeInTheDocument();
  });

  it('shows the saved buckets', () => {
    setup({ authConfig: { buckets: ['a', 'b'] } });

    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.getByText('b')).toBeInTheDocument();
  });

  it.each([
    ['comma', 'x,y'],
    ['space', 'x y'],
  ])('splits the typed names on a %s into separate buckets in the form', async (_name, typed) => {
    const probe = setup();

    await userEvent.type(screen.getByRole('combobox', { name: /Buckets/ }), `${typed}{Enter}`);

    expect(probe.form?.getValues().authConfig.buckets).toEqual(['x', 'y']);
  });
});
