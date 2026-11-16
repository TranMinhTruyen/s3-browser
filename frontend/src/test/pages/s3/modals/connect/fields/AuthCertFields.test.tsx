import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChooseAuthFile } from '@wails/S3Browser/internal/handlers/buckethandler';
import { describe, expect, it, vi } from 'vitest';
import { callIPC } from '@/common/utils/ipcUtils';
import AuthCertFields from '@/pages/s3/modals/connect/fields/AuthCertFields';
import { Harness, input, type Patch, type Probe, queryInput, starred, values } from '@/test/_helpers/authFieldsHarness';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

vi.mock('@wails/S3Browser/internal/handlers/buckethandler', () => ({ ChooseAuthFile: vi.fn() }));
vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));

describe('AuthCertFields', () => {
  const setup = (props: { saved?: string[]; secretRequired?: boolean } = {}, patch: Patch = {}) => {
    const probe: Probe = {};
    renderWithProviders(
      <Harness initial={values({ authType: 'minioCert', ...patch })} probe={probe}>
        {form => (
          <AuthCertFields form={form} savedSecrets={props.saved ?? []} secretRequired={props.secretRequired ?? true} />
        )}
      </Harness>
    );
    return { probe, user: userEvent.setup({ pointerEventsCheck: 0 }) };
  };

  it('shows the two required file paths, the checkbox and the TLS hint, without a password', () => {
    setup();

    expect(starred(input(/Client certificate file/))).toBe(true);
    expect(starred(input(/Private key file/))).toBe(true);
    expect(input(/Client certificate file/)).toHaveAttribute('placeholder', 'Choose the certificate (.pem, .crt)');
    expect(input(/Private key file/)).toHaveAttribute('placeholder', 'Choose the private key (.pem, .key)');
    expect(screen.getByRole('checkbox', { name: 'The private key has a password' })).not.toBeChecked();
    expect(queryInput(/Private key password/)).not.toBeInTheDocument();
    expect(screen.getByText(/The files are read on connect/)).toBeInTheDocument();
  });

  it('picks each file with its own kind of dialog', async () => {
    vi.mocked(callIPC).mockImplementation((async (_b: unknown, args: string[]) => `/${args[0]}.pem`) as never);
    const { probe, user } = setup();

    const [chooseCert, chooseKey] = screen.getAllByRole('button', { name: 'Choose file...' });
    await user.click(chooseCert);
    await waitFor(() => expect(probe.form?.getValues().authConfig.certFile).toBe('/cert.pem'));
    await user.click(chooseKey);
    await waitFor(() => expect(probe.form?.getValues().authConfig.keyFile).toBe('/key.pem'));

    expect(callIPC).toHaveBeenNthCalledWith(1, ChooseAuthFile, ['cert'], expect.anything());
    expect(callIPC).toHaveBeenNthCalledWith(2, ChooseAuthFile, ['key'], expect.anything());
  });

  it('asks for the key password once the key has one', async () => {
    const { user } = setup();

    await user.click(screen.getByRole('checkbox', { name: 'The private key has a password' }));

    const password = await screen.findByLabelText(/Private key password/, { selector: 'input' });
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveAttribute('placeholder', 'Private key password');
    expect(screen.getByText(/A PKCS#8 key with a password is supported/)).toBeInTheDocument();
  });

  it('drops the typed key password when the key has none any more', async () => {
    const { probe, user } = setup({}, { authConfig: { keyEncrypted: true } });
    const password = await screen.findByLabelText(/Private key password/, { selector: 'input' });
    await user.type(password, 'secret');
    expect(probe.form?.getValues().authSecret.keyPassword).toBe('secret');

    await user.click(screen.getByRole('checkbox', { name: 'The private key has a password' }));

    await waitFor(() => expect(queryInput(/Private key password/)).not.toBeInTheDocument());
    expect(probe.form?.getValues().authSecret.keyPassword).toBe('');
  });

  it('keeps the typed key password while the key still has one', async () => {
    const { probe, user } = setup({}, { authConfig: { keyEncrypted: false } });
    act(() => probe.form?.setFieldValue('authSecret.keyPassword', 'secret'));

    await user.click(screen.getByRole('checkbox', { name: 'The private key has a password' }));

    await screen.findByLabelText(/Private key password/, { selector: 'input' });
    expect(probe.form?.getValues().authConfig.keyEncrypted).toBe(true);
    expect(probe.form?.getValues().authSecret.keyPassword).toBe('secret');
  });

  it.each([
    [['keyPassword'], 'Saved, leave empty to keep'],
    [['secretKey'], 'Private key password'],
    [[], 'Private key password'],
  ])('with saved secrets %j the password placeholder is %j', async (saved, placeholder) => {
    setup({ saved }, { authConfig: { keyEncrypted: true } });

    expect(await screen.findByLabelText(/Private key password/, { selector: 'input' })).toHaveAttribute(
      'placeholder',
      placeholder
    );
  });

  it.each([
    [true, true],
    [false, false],
  ])('with secretRequired=%s the password starred is %s', async (secretRequired, expected) => {
    setup({ secretRequired }, { authConfig: { keyEncrypted: true } });

    const password = await screen.findByLabelText(/Private key password/, { selector: 'input' });
    expect(starred(password)).toBe(expected);
  });
});
