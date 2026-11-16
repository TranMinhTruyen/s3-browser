import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AuthMinioStsFields from '@/pages/s3/modals/connect/fields/AuthMinioStsFields';
import { Harness, input, type Probe, queryInput, starred, values } from '@/test/_helpers/authFieldsHarness';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

describe('AuthMinioStsFields', () => {
  const setup = (props: { saved?: string[]; secretRequired?: boolean } = {}) => {
    const probe: Probe = {};
    renderWithProviders(
      <Harness initial={values({ authType: 'minioAssumeRole' })} probe={probe}>
        {form => (
          <AuthMinioStsFields
            form={form}
            savedSecrets={props.saved ?? []}
            secretRequired={props.secretRequired ?? true}
          />
        )}
      </Harness>
    );
    return probe;
  };

  it('shows the keys without a session token, an optional duration and the policy', () => {
    setup();

    expect(input(/Access key/)).toBeInTheDocument();
    expect(input(/Secret key/)).toBeInTheDocument();
    expect(queryInput(/Session token/)).not.toBeInTheDocument();
    expect(input(/Duration \(seconds, optional\)/)).toBeInTheDocument();
    const policy = screen.getByLabelText(/Inline policy/);
    expect(policy.tagName).toBe('TEXTAREA');
    expect(policy).toHaveAttribute('placeholder', '{"Version": "2012-10-17", "Statement": []}');
  });

  it('passes the saved secrets and secretRequired to the key fields', () => {
    setup({ saved: ['secretKey'], secretRequired: false });

    expect(input(/Secret key/)).toHaveAttribute('placeholder', 'Saved, leave empty to keep');
    expect(starred(input(/Secret key/))).toBe(false);
  });

  it('writes the policy into the form', () => {
    const probe = setup();

    fireEvent.change(screen.getByLabelText(/Inline policy/), { target: { value: '{"a":1}' } });

    expect(probe.form?.getValues().authConfig.policy).toBe('{"a":1}');
  });
});
