import { fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AuthStaticFields from '@/components/modals/connect/fields/AuthStaticFields';
import { Harness, input, type Probe, queryInput, starred, values } from '@/test/_helpers/authFieldsHarness';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

describe('AuthStaticFields', () => {
  const setup = (props: { saved?: string[]; secretRequired?: boolean; withSessionToken?: boolean } = {}) => {
    const probe: Probe = {};
    renderWithProviders(
      <Harness initial={values()} probe={probe}>
        {form => (
          <AuthStaticFields
            form={form}
            savedSecrets={props.saved ?? []}
            secretRequired={props.secretRequired ?? true}
            withSessionToken={props.withSessionToken}
          />
        )}
      </Harness>
    );
    return probe;
  };

  it('shows the access key, the secret key and the session token', () => {
    setup();

    expect(input(/Access key/)).toBeInTheDocument();
    expect(input(/Secret key/)).toHaveAttribute('placeholder', 'Secret key');
    expect(input(/Session token/)).toHaveAttribute('placeholder', 'Session token (optional)');
  });

  it('writes the typed values into the form', () => {
    const probe = setup();

    fireEvent.change(input(/Access key/), { target: { value: 'AK' } });
    fireEvent.change(input(/Secret key/), { target: { value: 'SK' } });
    fireEvent.change(input(/Session token/), { target: { value: 'tok' } });

    expect(probe.form?.getValues()).toMatchObject({
      accessKey: 'AK',
      secretKey: 'SK',
      authSecret: { sessionToken: 'tok' },
    });
  });

  it('marks the saved secrets with the saved placeholder', () => {
    setup({ saved: ['secretKey', 'sessionToken'] });

    expect(input(/Secret key/)).toHaveAttribute('placeholder', 'Saved, leave empty to keep');
    expect(input(/Session token/)).toHaveAttribute('placeholder', 'Saved, leave empty to keep');
  });

  it('marks only the secret that is saved', () => {
    setup({ saved: ['sessionToken'] });

    expect(input(/Secret key/)).toHaveAttribute('placeholder', 'Secret key');
    expect(input(/Session token/)).toHaveAttribute('placeholder', 'Saved, leave empty to keep');
  });

  it('hides the session token on request', () => {
    setup({ withSessionToken: false });

    expect(queryInput(/Session token/)).not.toBeInTheDocument();
  });

  it.each([
    [true, 2],
    [false, 1],
  ])('with secretRequired=%s marks %s of the two key fields as required', (secretRequired, count) => {
    setup({ secretRequired });

    const required = [input(/Access key/), input(/Secret key/)].filter(el => starred(el));
    expect(required).toHaveLength(count);
  });
});
