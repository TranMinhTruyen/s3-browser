import { fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AuthDurationField from '@/pages/s3/modals/connect/fields/AuthDurationField';
import { Harness, input, type Probe, starred, values } from '@/test/_helpers/authFieldsHarness';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

describe('AuthDurationField', () => {
  const setup = (required?: boolean, durationSeconds: number | '' = '') => {
    const probe: Probe = {};
    renderWithProviders(
      <Harness initial={values({ authType: 'minioLdap', authConfig: { durationSeconds } })} probe={probe}>
        {form => <AuthDurationField form={form} required={required} />}
      </Harness>
    );
    return probe;
  };

  it('is required for assume role: starred label and no placeholder', () => {
    setup(true, 3600);

    const field = input(/Duration \(seconds\)/);
    expect(starred(field)).toBe(true);
    expect(field).toHaveValue('3600');
    expect(field).not.toHaveAttribute('placeholder');
  });

  it('is optional otherwise: labelled optional, with the server default as placeholder', () => {
    setup();

    const field = input(/Duration \(seconds, optional\)/);
    expect(starred(field)).toBe(false);
    expect(field).toHaveValue('');
    expect(field).toHaveAttribute('placeholder', 'Default: set by the server');
  });

  it('writes a typed number into the form and an emptied field as an empty string', () => {
    const probe = setup();

    fireEvent.change(input(/Duration/), { target: { value: '1800' } });
    expect(probe.form?.getValues().authConfig.durationSeconds).toBe(1800);

    fireEvent.change(input(/Duration/), { target: { value: '' } });
    expect(probe.form?.getValues().authConfig.durationSeconds).toBe('');
  });
});
