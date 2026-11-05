import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreateBucket } from '@wails/S3Browser/internal/handlers/buckethandler';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMasterDataStore } from '@/common/stores/masterDataStore';
import { useModalStackStore } from '@/common/stores/modalStackStore';
import { callIPC } from '@/common/utils/ipcUtils';
import CreateBucketModal from '@/components/modals/bucket/CreateBucketModal';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

vi.mock('@wails/S3Browser/internal/handlers/buckethandler', () => ({ CreateBucket: vi.fn() }));
vi.mock('@wails/S3Browser/internal/handlers/masterhandler', () => ({ GetMasterData: vi.fn(), GetRegionData: vi.fn() }));
vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));

const callIPCMock = vi.mocked(callIPC);
const flush = () => act(async () => {});
const region = (name: string, value1: string) => ({ name, value1 }) as never;

type Options = { signal?: AbortSignal; resolveAction?: () => void };
// What callIPC does on success: runs resolveAction and returns the body.
const succeed = async (_fn: unknown, _args: unknown, options?: Options) => {
  options?.resolveAction?.();
  return {} as never;
};

type Props = Parameters<typeof CreateBucketModal.show>[0];
async function open(props: Partial<Props> = {}) {
  renderWithProviders(<div />);
  let result!: Promise<boolean>;
  act(() => {
    result = CreateBucketModal.show({
      connectionId: 'c1',
      profileName: 'Prod',
      withRegion: false,
      ...props,
    } as Props) as Promise<boolean>;
  });
  await flush();
  const settled = { value: undefined as boolean | undefined };
  void result.then(v => {
    settled.value = v;
  });
  return { result, settled, user: userEvent.setup() };
}

const nameInput = () => screen.getByLabelText(/Bucket name/, { selector: 'input' });
const createBtn = () => screen.getByRole('button', { name: 'Create' });
const regionBtn = () => screen.queryByRole('button', { name: /Region/ });

describe('CreateBucketModal', () => {
  beforeEach(() => {
    useModalStackStore.getState().reset();
    callIPCMock.mockReset();
    callIPCMock.mockImplementation(succeed);
    useMasterDataStore.setState({
      regionData: { '01': [region('Ireland', 'eu-west-1'), region('Tokyo', 'ap-northeast-1')] },
    });
  });

  it('shows the title and hint, with Cancel on the left and Create on the right', async () => {
    await open();

    expect(screen.getByRole('heading', { name: 'Create bucket' })).toBeInTheDocument();
    expect(screen.getByText('3-63 characters: lowercase letters, numbers, dots and hyphens.')).toBeInTheDocument();
    const footer = screen.getByRole('button', { name: 'Cancel' }).parentElement as HTMLElement;
    expect(Array.from(footer.querySelectorAll('button')).map(b => b.textContent)).toEqual(['Cancel', 'Create']);
  });

  it('disables Create without flagging an error while the name is empty', async () => {
    await open();

    expect(createBtn()).toBeDisabled();
    expect(screen.queryByText(/is required/)).not.toBeInTheDocument();
    expect(nameInput()).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('flags an invalid name, disables Create and does not call the backend', async () => {
    const { user } = await open();

    await user.type(nameInput(), 'My_Bucket');

    expect(nameInput()).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/can only contain lowercase letters, numbers, dots and hyphens/)).toBeInTheDocument();
    expect(createBtn()).toBeDisabled();
    await user.click(createBtn());
    expect(callIPCMock).not.toHaveBeenCalled();
  });

  it('enables Create for a valid name', async () => {
    const { user } = await open();

    await user.type(nameInput(), 'my-bucket');

    expect(nameInput()).not.toHaveAttribute('aria-invalid', 'true');
    expect(createBtn()).toBeEnabled();
  });

  describe('region', () => {
    it('shows the region combobox on AWS without endpoint, preselects the profile region and sends it', async () => {
      const { user, result } = await open({ withRegion: true, defaultRegion: 'eu-west-1' });

      expect(regionBtn()).toHaveTextContent('Ireland[eu-west-1]');
      await user.type(nameInput(), 'my-bucket');
      await user.click(createBtn());

      expect(callIPCMock).toHaveBeenCalledExactlyOnceWith(
        CreateBucket,
        [{ connectionId: 'c1', profileName: 'Prod', bucket: 'my-bucket', region: 'eu-west-1' }],
        { signal: expect.any(AbortSignal), resolveAction: expect.any(Function) }
      );
      await expect(result).resolves.toBe(true);
    });

    it('sends the region the user picked', async () => {
      const { user } = await open({ withRegion: true, defaultRegion: 'eu-west-1' });

      await user.click(regionBtn() as HTMLElement);
      await user.click(await screen.findByText('Tokyo'));
      await user.type(nameInput(), 'my-bucket');
      await user.click(createBtn());

      expect(callIPCMock.mock.calls[0][1]).toEqual([expect.objectContaining({ region: 'ap-northeast-1' })]);
    });

    it('sends no region when none is chosen and the profile has none', async () => {
      const { user } = await open({ withRegion: true });

      expect(regionBtn()).toHaveTextContent('Select region');
      await user.type(nameInput(), 'my-bucket');
      await user.click(createBtn());

      expect(callIPCMock.mock.calls[0][1]).toEqual([expect.objectContaining({ region: undefined })]);
    });

    it('has no region combobox and sends no region for MinIO or a custom endpoint', async () => {
      const { user } = await open({ withRegion: false, defaultRegion: 'eu-west-1' });

      expect(regionBtn()).not.toBeInTheDocument();
      await user.type(nameInput(), 'my-bucket');
      await user.click(createBtn());

      expect(callIPCMock.mock.calls[0][1]).toEqual([
        { connectionId: 'c1', profileName: 'Prod', bucket: 'my-bucket', region: undefined },
      ]);
    });
  });

  it('resolves true and closes once the bucket is created', async () => {
    const { user, result } = await open();

    await user.type(nameInput(), 'my-bucket');
    await user.click(createBtn());

    await expect(result).resolves.toBe(true);
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Create bucket' })).not.toBeInTheDocument());
  });

  it('stays open and can retry when the backend fails (callIPC returns null)', async () => {
    callIPCMock.mockResolvedValue(null as never);
    const { user, settled } = await open();

    await user.type(nameInput(), 'my-bucket');
    await user.click(createBtn());
    await flush();

    expect(callIPCMock).toHaveBeenCalledTimes(1);
    expect(settled.value).toBeUndefined();
    expect(screen.getByRole('heading', { name: 'Create bucket' })).toBeInTheDocument();
    expect(nameInput()).toHaveValue('my-bucket');
    expect(createBtn()).toBeEnabled();
    expect(createBtn()).not.toHaveAttribute('data-loading');

    callIPCMock.mockImplementation(succeed);
    await user.click(createBtn());
    expect(callIPCMock).toHaveBeenCalledTimes(2);
  });

  it('resolves false on Cancel without calling the backend', async () => {
    const { user, result } = await open();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await expect(result).resolves.toBe(false);
    expect(callIPCMock).not.toHaveBeenCalled();
  });

  it('resolves false on the close button', async () => {
    const { user, result } = await open();

    await user.click(screen.getByRole('button', { name: 'Close' }));

    await expect(result).resolves.toBe(false);
  });

  describe('permission', () => {
    const BPA = /Block Public Access is turned off/;
    const POLICY_JSON = '{"Version":"2012-10-17","Statement":[]}';
    const segment = (name: string) => screen.getByRole('radio', { name }) as HTMLInputElement;
    const policyField = () => screen.getByLabelText(/Policy \(JSON\)/);
    const sent = () => callIPCMock.mock.calls[0][1] as unknown as Record<string, unknown>[];

    it('defaults to private: shows the label, sends no mode or policy', async () => {
      const { user } = await open();

      expect(screen.getByText('Permission')).toBeInTheDocument();
      expect(segment('Private')).toBeChecked();
      await user.type(nameInput(), 'my-bucket');
      await user.click(createBtn());

      expect(sent()[0].mode).toBeUndefined();
      expect(sent()[0].policy).toBeUndefined();
    });

    it('sends mode public without a policy', async () => {
      const { user, result } = await open();

      await user.click(segment('Public (read-only)'));
      await user.type(nameInput(), 'my-bucket');
      await user.click(createBtn());

      expect(sent()[0].mode).toBe('public');
      expect(sent()[0].policy).toBeUndefined();
      await expect(result).resolves.toBe(true);
    });

    it('sends mode custom with the policy', async () => {
      const { user } = await open();

      await user.click(segment('Custom'));
      fireEvent.change(policyField(), { target: { value: POLICY_JSON } });
      await user.type(nameInput(), 'my-bucket');
      await user.click(createBtn());

      expect(sent()[0]).toEqual(expect.objectContaining({ bucket: 'my-bucket', mode: 'custom', policy: POLICY_JSON }));
    });

    it('does not send a stale policy after switching away from custom', async () => {
      const { user } = await open();

      await user.click(segment('Custom'));
      fireEvent.change(policyField(), { target: { value: POLICY_JSON } });
      await user.click(segment('Public (read-only)'));
      await user.type(nameInput(), 'my-bucket');
      await user.click(createBtn());

      expect(sent()[0].mode).toBe('public');
      expect(sent()[0].policy).toBeUndefined();
    });

    it('disables Create and skips the backend for an empty custom policy', async () => {
      const { user } = await open();

      await user.type(nameInput(), 'my-bucket');
      await user.click(segment('Custom'));

      expect(createBtn()).toBeDisabled();
      await user.click(createBtn());
      expect(callIPCMock).not.toHaveBeenCalled();
    });

    it('disables Create and skips the backend for invalid custom JSON, enables it once fixed', async () => {
      const { user } = await open();

      await user.type(nameInput(), 'my-bucket');
      await user.click(segment('Custom'));
      fireEvent.change(policyField(), { target: { value: '{bad' } });

      expect(policyField()).toHaveAttribute('aria-invalid', 'true');
      expect(createBtn()).toBeDisabled();
      await user.click(createBtn());
      expect(callIPCMock).not.toHaveBeenCalled();

      fireEvent.change(policyField(), { target: { value: POLICY_JSON } });
      expect(createBtn()).toBeEnabled();
    });

    it.each([['Public (read-only)'], ['Custom']])('warns about Block Public Access on AWS in %s mode', async label => {
      const { user } = await open({ withRegion: true });

      expect(screen.queryByText(BPA)).not.toBeInTheDocument();
      await user.click(segment(label));

      expect(screen.getByText(BPA)).toBeInTheDocument();
      await user.click(segment('Private'));
      expect(screen.queryByText(BPA)).not.toBeInTheDocument();
    });

    it('never warns for MinIO or a custom endpoint', async () => {
      const { user } = await open({ withRegion: false });

      await user.click(segment('Public (read-only)'));
      expect(screen.queryByText(BPA)).not.toBeInTheDocument();
      await user.click(segment('Custom'));
      expect(screen.queryByText(BPA)).not.toBeInTheDocument();
    });

    it('still resolves true when the backend succeeds with a warning', async () => {
      callIPCMock.mockImplementation((async (_fn: unknown, _args: unknown, options?: Options) => {
        options?.resolveAction?.();
        return { warning: true };
      }) as never);
      const { user, result } = await open({ withRegion: true });

      await user.click(segment('Public (read-only)'));
      await user.type(nameInput(), 'my-bucket');
      await user.click(createBtn());

      await expect(result).resolves.toBe(true);
    });
  });

  it('aborts a create in flight when the modal is closed and ignores its late result', async () => {
    let signal!: AbortSignal;
    let finish!: () => void;
    callIPCMock.mockImplementation(((_fn: unknown, _args: unknown, options?: Options) => {
      signal = options?.signal as AbortSignal;
      return new Promise(resolve => {
        finish = () => {
          options?.resolveAction?.();
          resolve({});
        };
      });
    }) as never);
    const { user, result } = await open();
    await user.type(nameInput(), 'my-bucket');
    await user.click(createBtn());
    expect(signal.aborted).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(signal.aborted).toBe(true));
    await act(async () => finish());

    await expect(result).resolves.toBe(false);
  });
});
