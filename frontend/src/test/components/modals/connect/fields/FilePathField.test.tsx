import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChooseAuthFile } from '@wails/S3Browser/internal/handlers/buckethandler';
import { describe, expect, it, vi } from 'vitest';
import { callIPC } from '@/common/utils/ipcUtils';
import FilePathField from '@/components/modals/connect/fields/FilePathField';
import { Harness, input, type Patch, type Probe, values } from '@/test/_helpers/authFieldsHarness';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

vi.mock('@wails/S3Browser/internal/handlers/buckethandler', () => ({ ChooseAuthFile: vi.fn() }));
vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));

type SetupProps = { clearable?: boolean; withAsterisk?: boolean; description?: string };

describe('FilePathField', () => {
  const setup = (props: SetupProps = {}, patch: Patch = {}) => {
    const probe: Probe = {};
    renderWithProviders(
      <Harness initial={values(patch)} probe={probe}>
        {form => (
          <FilePathField
            form={form}
            name="authConfig.caFile"
            kind="ca"
            label="CA file"
            placeholder="Pick a CA"
            {...props}
          />
        )}
      </Harness>
    );
    return { probe, user: userEvent.setup({ pointerEventsCheck: 0 }) };
  };

  const caFile = (probe: Probe) => probe.form?.getValues().authConfig.caFile;

  it('shows a read-only path with the placeholder and the description', () => {
    setup({ description: 'About the CA' });

    expect(input(/CA file/)).toHaveAttribute('readonly');
    expect(input(/CA file/)).toHaveAttribute('placeholder', 'Pick a CA');
    expect(screen.getByText('About the CA')).toBeInTheDocument();
  });

  it('shows the current path', () => {
    setup({}, { authConfig: { caFile: '/ca.pem' } });

    expect(input(/CA file/)).toHaveValue('/ca.pem');
  });

  it.each([
    ['true', true],
    ['false', false],
  ])('marks the field as required when withAsterisk is %s', (_n, withAsterisk) => {
    setup({ withAsterisk });

    expect(!!(input(/CA file/) as HTMLInputElement).labels?.[0]?.textContent?.includes('*')).toBe(withAsterisk);
  });

  it('asks the backend for the kind of file and keeps the chosen path', async () => {
    vi.mocked(callIPC).mockResolvedValue('/new/ca.pem' as never);
    const { probe, user } = setup();

    await user.click(screen.getByRole('button', { name: 'Choose file...' }));

    await waitFor(() => expect(input(/CA file/)).toHaveValue('/new/ca.pem'));
    expect(caFile(probe)).toBe('/new/ca.pem');
    expect(callIPC).toHaveBeenCalledExactlyOnceWith(ChooseAuthFile, ['ca'], { signal: expect.any(AbortSignal) });
  });

  it.each([
    ['empty (dialog canceled)', ''],
    ['null (call failed)', null],
  ])('keeps the current path when the backend returns %s', async (_n, chosen) => {
    vi.mocked(callIPC).mockResolvedValue(chosen as never);
    const { probe, user } = setup({}, { authConfig: { caFile: '/old.pem' } });

    await user.click(screen.getByRole('button', { name: 'Choose file...' }));

    await waitFor(() => expect(callIPC).toHaveBeenCalledTimes(1));
    expect(caFile(probe)).toBe('/old.pem');
    expect(input(/CA file/)).toHaveValue('/old.pem');
  });

  it('has no clear button unless clearable', () => {
    setup();

    expect(screen.queryByRole('button', { name: 'Clear file' })).not.toBeInTheDocument();
  });

  it('disables the clear button while the path is empty', () => {
    setup({ clearable: true });

    expect(screen.getByRole('button', { name: 'Clear file' })).toBeDisabled();
  });

  it('empties the path with the clear button', async () => {
    const { probe, user } = setup({ clearable: true }, { authConfig: { caFile: '/ca.pem' } });
    const clear = screen.getByRole('button', { name: 'Clear file' });
    expect(clear).toBeEnabled();

    await user.click(clear);

    await waitFor(() => expect(input(/CA file/)).toHaveValue(''));
    expect(caFile(probe)).toBe('');
    expect(clear).toBeDisabled();
  });
});
