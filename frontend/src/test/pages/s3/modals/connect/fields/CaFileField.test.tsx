import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChooseAuthFile } from '@wails/S3Browser/internal/handlers/buckethandler';
import { describe, expect, it, vi } from 'vitest';
import { callIPC } from '@/common/utils/ipcUtils';
import CaFileField from '@/pages/s3/modals/connect/fields/CaFileField';
import { Harness, input, type Probe, values } from '@/test/_helpers/authFieldsHarness';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

vi.mock('@wails/S3Browser/internal/handlers/buckethandler', () => ({ ChooseAuthFile: vi.fn() }));
vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));

describe('CaFileField', () => {
  const setup = (caFile = '') => {
    const probe: Probe = {};
    renderWithProviders(
      <Harness initial={values({ provider: 'minio', authConfig: { caFile } })} probe={probe}>
        {form => <CaFileField form={form} />}
      </Harness>
    );
    return { probe, user: userEvent.setup({ pointerEventsCheck: 0 }) };
  };

  it('shows an optional, clearable CA path with its hint', () => {
    setup('/ca.pem');

    const field = input(/CA certificate file \(optional\)/);
    expect(field).toHaveValue('/ca.pem');
    expect(field).toHaveAttribute('placeholder', 'Default: the operating system certificates');
    expect(screen.getByText(/Extra trusted CA for a MinIO server/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear file' })).toBeEnabled();
  });

  it('picks a CA file through the backend dialog', async () => {
    vi.mocked(callIPC).mockResolvedValue('/picked.pem' as never);
    const { probe, user } = setup();

    await user.click(screen.getByRole('button', { name: 'Choose file...' }));

    await waitFor(() => expect(probe.form?.getValues().authConfig.caFile).toBe('/picked.pem'));
    expect(callIPC).toHaveBeenCalledExactlyOnceWith(ChooseAuthFile, ['ca'], expect.anything());
  });
});
