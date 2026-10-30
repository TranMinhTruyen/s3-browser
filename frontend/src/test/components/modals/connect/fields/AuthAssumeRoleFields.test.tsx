import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import AuthAssumeRoleFields from '@/components/modals/connect/fields/AuthAssumeRoleFields';
import { Harness, input, type Patch, type Probe, queryInput, starred, values } from '@/test/_helpers/authFieldsHarness';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

// The profile picker has its own tests: here it only shows the props it receives.
vi.mock('@/components/inputs/combobox/AwsProfileCombobox', () => ({
  default: ({ ssoOnly, configFile, credentialsFile, defaultValue }: Record<string, unknown>) => (
    <div>{`picker sso=${!!ssoOnly} config=[${configFile ?? ''}] credentials=[${credentialsFile ?? ''}] value=[${defaultValue}]`}</div>
  ),
}));

describe('AuthAssumeRoleFields', () => {
  const setup = (patch: Patch = {}, props: { saved?: string[]; secretRequired?: boolean } = {}) => {
    const probe: Probe = {};
    renderWithProviders(
      <Harness initial={values({ authType: 'assumeRole', ...patch })} probe={probe}>
        {form => (
          <AuthAssumeRoleFields
            form={form}
            savedSecrets={props.saved ?? []}
            secretRequired={props.secretRequired ?? true}
          />
        )}
      </Harness>
    );
    return probe;
  };

  it('shows the role fields and the access keys by default, without session token or MFA code', () => {
    setup();

    expect(screen.getByRole('radio', { name: 'Access key' })).toBeChecked();
    expect(input(/Access key/)).toBeInTheDocument();
    expect(input(/Secret key/)).toBeInTheDocument();
    expect(queryInput(/Session token/)).not.toBeInTheDocument();
    expect(input(/Role ARN/)).toHaveAttribute('placeholder', 'arn:aws:iam::123456789012:role/RoleName');
    expect(input(/External ID/)).toBeInTheDocument();
    expect(input(/Session name/)).toBeInTheDocument();
    expect(input(/Duration/)).toHaveValue('3600');
    expect(input(/MFA device serial/)).toBeInTheDocument();
    expect(queryInput(/MFA code/)).not.toBeInTheDocument();
    expect(screen.queryByText(/picker/)).not.toBeInTheDocument();
  });

  it('shows the profile picker instead of the keys when the source is an AWS CLI profile', () => {
    setup({ authConfig: { sourceType: 'profile', profileName: 'dev' } });

    expect(screen.getByRole('radio', { name: 'AWS CLI profile' })).toBeChecked();
    expect(screen.getByText('picker sso=false config=[] credentials=[] value=[dev]')).toBeInTheDocument();
    expect(queryInput(/Access key/)).not.toBeInTheDocument();
  });

  it('switches the source with the segmented control', async () => {
    const probe = setup();

    await userEvent.click(screen.getByRole('radio', { name: 'AWS CLI profile' }));

    expect(probe.form?.getValues().authConfig.sourceType).toBe('profile');
    expect(await screen.findByText(/picker/)).toBeInTheDocument();
    expect(queryInput(/Access key/)).not.toBeInTheDocument();
  });

  it('shows the MFA code, required or not, once a device is set', () => {
    setup({ authConfig: { mfaSerial: 'arn:mfa' } }, { secretRequired: true });

    expect(starred(input(/MFA code/))).toBe(true);
  });

  it('does not mark the MFA code as required when only saving', () => {
    setup({ authConfig: { mfaSerial: 'arn:mfa' } }, { secretRequired: false });

    expect(starred(input(/MFA code/))).toBe(false);
  });

  it('shows the MFA code as soon as a device is typed', async () => {
    setup();

    fireEvent.change(input(/MFA device serial/), { target: { value: 'arn:mfa' } });

    expect(await screen.findByLabelText(/MFA code/, { selector: 'input' })).toBeInTheDocument();
  });

  it('passes the saved secrets to the key fields', () => {
    setup({}, { saved: ['secretKey'] });

    expect(input(/Secret key/)).toHaveAttribute('placeholder', 'Saved, leave empty to keep');
  });
});
