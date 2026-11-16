import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AuthAwsProfileFields from '@/pages/s3/modals/connect/fields/AuthAwsProfileFields';
import { Harness, input, type Patch, type Probe, queryInput, values } from '@/test/_helpers/authFieldsHarness';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

// The profile picker has its own tests: here it only shows the props it receives.
vi.mock('@/pages/s3/components/AwsProfileCombobox', () => ({
  default: ({ ssoOnly, configFile, credentialsFile, defaultValue }: Record<string, unknown>) => (
    <div>{`picker sso=${!!ssoOnly} config=[${configFile ?? ''}] credentials=[${credentialsFile ?? ''}] value=[${defaultValue}]`}</div>
  ),
}));

describe('AuthAwsProfileFields', () => {
  const setup = (ssoOnly: boolean | undefined, patch: Patch = {}) => {
    const probe: Probe = {};
    renderWithProviders(
      <Harness initial={values(patch)} probe={probe}>
        {form => <AuthAwsProfileFields form={form} ssoOnly={ssoOnly} />}
      </Harness>
    );
    return probe;
  };

  it('shows the picker and both files for a shared profile', () => {
    setup(undefined, { authConfig: { profileName: 'dev', configFile: '/c', credentialsFile: '/k' } });

    expect(screen.getByText('picker sso=false config=[/c] credentials=[/k] value=[dev]')).toBeInTheDocument();
    expect(input(/AWS config file/)).toHaveValue('/c');
    expect(input(/AWS credentials file/)).toHaveValue('/k');
    expect(screen.queryByText(/aws sso login/)).not.toBeInTheDocument();
  });

  it('for sso, restricts the picker, hides the credentials file and shows the login command', () => {
    setup(true, { authConfig: { profileName: 'corp' } });

    expect(screen.getByText(/picker sso=true/)).toBeInTheDocument();
    expect(queryInput(/AWS credentials file/)).not.toBeInTheDocument();
    expect(input(/AWS config file/)).toBeInTheDocument();
    expect(screen.getByText('Sign in first with: aws sso login --profile corp')).toBeInTheDocument();
  });

  it('for sso without a profile, shows a placeholder in the login command', () => {
    setup(true);

    expect(screen.getByText('Sign in first with: aws sso login --profile <profile>')).toBeInTheDocument();
  });

  it('passes the typed config file to the picker', () => {
    setup(false);

    fireEvent.change(input(/AWS config file/), { target: { value: '/new' } });

    expect(screen.getByText(/config=\[\/new\]/)).toBeInTheDocument();
  });
});
