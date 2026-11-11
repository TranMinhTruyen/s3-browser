import { fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AuthLdapFields from '@/pages/s3/modals/connect/fields/AuthLdapFields';
import { Harness, input, type Probe, queryInput, starred, values } from '@/test/_helpers/authFieldsHarness';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

describe('AuthLdapFields', () => {
  const setup = (props: { saved?: string[]; secretRequired?: boolean } = {}) => {
    const probe: Probe = {};
    renderWithProviders(
      <Harness initial={values({ authType: 'minioLdap' })} probe={probe}>
        {form => (
          <AuthLdapFields form={form} savedSecrets={props.saved ?? []} secretRequired={props.secretRequired ?? true} />
        )}
      </Harness>
    );
    return probe;
  };

  it('shows the user name, a masked password and the optional duration, without access keys', () => {
    setup();

    expect(starred(input(/LDAP username/))).toBe(true);
    expect(input(/LDAP password/)).toHaveAttribute('type', 'password');
    expect(input(/LDAP password/)).toHaveAttribute('placeholder', 'LDAP password');
    expect(input(/Duration \(seconds, optional\)/)).toBeInTheDocument();
    expect(queryInput(/Access key/)).not.toBeInTheDocument();
    expect(queryInput(/Secret key/)).not.toBeInTheDocument();
  });

  it('writes the typed values into the form', () => {
    const probe = setup();

    fireEvent.change(input(/LDAP username/), { target: { value: 'bob' } });
    fireEvent.change(input(/LDAP password/), { target: { value: 'pw' } });

    expect(probe.form?.getValues()).toMatchObject({
      authConfig: { ldapUsername: 'bob' },
      authSecret: { ldapPassword: 'pw' },
    });
  });

  it('tells that the password is saved, only when it is', () => {
    setup({ saved: ['ldapPassword'] });

    expect(input(/LDAP password/)).toHaveAttribute('placeholder', 'Saved, leave empty to keep');
  });

  it('does not take another saved secret for the password', () => {
    setup({ saved: ['secretKey'] });

    expect(input(/LDAP password/)).toHaveAttribute('placeholder', 'LDAP password');
  });

  it.each([
    [true, true],
    [false, false],
  ])('with secretRequired=%s the password starred is %s', (secretRequired, expected) => {
    setup({ secretRequired });

    expect(starred(input(/LDAP password/))).toBe(expected);
  });
});
