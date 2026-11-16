import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeleteBucket, GetBucketDeleteInfo } from '@wails/S3Browser/internal/handlers/buckethandler';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useModalStackStore } from '@/common/stores/modalStackStore';
import { callIPC } from '@/common/utils/ipcUtils';
import { showDeleteResultModal } from '@/components/modals/lazyModals';
import DeleteBucketModal from '@/pages/s3/modals/bucket/DeleteBucketModal';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

vi.mock('@wails/S3Browser/internal/handlers/buckethandler', () => ({
  GetBucketDeleteInfo: vi.fn(),
  DeleteBucket: vi.fn(),
}));
vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));
vi.mock('@/components/modals/lazyModals', () => ({ showDeleteResultModal: vi.fn() }));

const callIPCMock = vi.mocked(callIPC);
const flush = () => act(async () => {});

type Info = { empty: boolean | null; versioning: string; objectLock: boolean };
type Result = { deleted: number; failed: number; failures: unknown[]; bucketDeleted: boolean };
type Options = {
  signal?: AbortSignal;
  resolveAction?: (o: unknown) => void;
  rejectAction?: (o: unknown) => void;
};

const info = (extra: Partial<Info> = {}): Info => ({ empty: true, versioning: 'Off', objectLock: false, ...extra });
const result = (extra: Partial<Result> = {}): Result => ({
  deleted: 0,
  failed: 0,
  failures: [],
  bucketDeleted: true,
  ...extra,
});

// The next result of each binding (null = failed); `deleteVia` picks how DeleteBucket reports its output.
const next = {
  info: undefined as unknown,
  del: undefined as unknown,
  deleteVia: 'resolve' as 'resolve' | 'reject' | 'none',
};
const signals: { info?: AbortSignal; del?: AbortSignal | undefined } = {};

type Props = Parameters<typeof DeleteBucketModal.show>[0];
async function open(settle = true) {
  renderWithProviders(<div />);
  let promise!: Promise<unknown>;
  act(() => {
    promise = DeleteBucketModal.show({ connectionId: 'c1', profileName: 'Prod', bucket: 'my-bucket' } as Props);
  });
  if (settle) await flush();
  return { promise, user: userEvent.setup() };
}

const deleteBtn = () => screen.getByRole('button', { name: 'Delete' });
const nameField = () => screen.getByLabelText('Type my-bucket to confirm') as HTMLInputElement;
const typeName = (user: ReturnType<typeof userEvent.setup>, name = 'my-bucket') => user.type(nameField(), name);

describe('DeleteBucketModal', () => {
  beforeEach(() => {
    useModalStackStore.getState().reset();
    next.info = info();
    next.del = result();
    next.deleteVia = 'resolve';
    signals.info = undefined;
    signals.del = undefined;
    vi.mocked(showDeleteResultModal).mockReset();
    callIPCMock.mockReset();
    callIPCMock.mockImplementation(((fn: unknown, _args: unknown, options?: Options) => {
      if (fn === GetBucketDeleteInfo) {
        signals.info = options?.signal;
        return Promise.resolve(next.info);
      }
      signals.del = options?.signal;
      const output = { body: next.del === null ? undefined : next.del };
      if (next.deleteVia === 'resolve') options?.resolveAction?.(output);
      if (next.deleteVia === 'reject') options?.rejectAction?.(output);
      return Promise.resolve(next.del);
    }) as never);
  });

  it('shows a loader and checks the bucket with its parameters and a signal', async () => {
    await open(false);

    expect(screen.getByRole('heading', { name: 'Delete bucket' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Type my-bucket to confirm')).not.toBeInTheDocument();
    expect(callIPCMock).toHaveBeenCalledExactlyOnceWith(
      GetBucketDeleteInfo,
      [{ connectionId: 'c1', profileName: 'Prod', bucket: 'my-bucket' }],
      { signal: expect.any(AbortSignal) }
    );
    expect(deleteBtn()).toBeDisabled();
    await flush();
    expect(nameField()).toBeEnabled();
  });

  it('puts Cancel on the left and Delete on the right', async () => {
    await open();

    const footer = screen.getByRole('button', { name: 'Cancel' }).parentElement as HTMLElement;
    expect(Array.from(footer.querySelectorAll('button')).map(b => b.textContent)).toEqual(['Cancel', 'Delete']);
  });

  it('only enables Delete once the exact bucket name is typed', async () => {
    const { user } = await open();

    expect(deleteBtn()).toBeDisabled();
    await typeName(user, 'my-buck');
    expect(deleteBtn()).toBeDisabled();
    await typeName(user, 'et');
    expect(deleteBtn()).toBeEnabled();
    await user.clear(nameField());
    await typeName(user, 'MY-BUCKET');
    expect(deleteBtn()).toBeDisabled();
  });

  it('warns only that it cannot be undone for an empty, unversioned bucket', async () => {
    await open();

    expect(screen.getByText("This can't be undone. The bucket will be deleted permanently.")).toBeInTheDocument();
    expect(screen.queryByText(/is not empty|Could not check|Versioning is on|has Object Lock/)).not.toBeInTheDocument();
  });

  it('warns that every object is deleted when the bucket is not empty', async () => {
    next.info = info({ empty: false });
    await open();

    expect(screen.getByText(/The bucket is not empty/)).toBeInTheDocument();
    expect(screen.queryByText(/Could not check/)).not.toBeInTheDocument();
  });

  it('warns when emptiness could not be checked', async () => {
    next.info = info({ empty: null });
    await open();

    expect(screen.getByText(/Could not check whether the bucket is empty/)).toBeInTheDocument();
    expect(screen.queryByText(/The bucket is not empty/)).not.toBeInTheDocument();
  });

  it.each([['Enabled'], ['Suspended']])('warns that every version is deleted when versioning is %s', async v => {
    next.info = info({ versioning: v });
    await open();

    expect(screen.getByText(/Versioning is on or was used/)).toBeInTheDocument();
  });

  it.each([['Off'], ['']])('shows no versioning warning when versioning is "%s"', async v => {
    next.info = info({ versioning: v });
    await open();

    expect(screen.queryByText(/Versioning is on or was used/)).not.toBeInTheDocument();
  });

  it('with Object Lock and a not empty bucket only explains why it is blocked, even with the name typed', async () => {
    next.info = info({ objectLock: true, empty: false });
    const { user } = await open();

    expect(
      screen.getByText("Bucket my-bucket has Object Lock and is not empty, so it can't be deleted.")
    ).toBeVisible();
    expect(screen.queryByText(/can't be undone/)).not.toBeInTheDocument();
    expect(nameField()).toBeDisabled();
    expect(deleteBtn()).toBeDisabled();
    await user.click(deleteBtn());
    expect(callIPCMock).toHaveBeenCalledTimes(1);
  });

  it('with Object Lock and an unknown content warns but still allows the delete', async () => {
    next.info = info({ objectLock: true, empty: null });
    const { user } = await open();

    expect(screen.getByText(/The bucket has Object Lock/)).toBeInTheDocument();
    expect(screen.getByText(/Could not check whether/)).toBeInTheDocument();
    await typeName(user);
    expect(deleteBtn()).toBeEnabled();
  });

  it('with Object Lock and an empty bucket allows the delete without the lock warning', async () => {
    next.info = info({ objectLock: true, empty: true });
    const { user } = await open();

    expect(screen.queryByText(/has Object Lock/)).not.toBeInTheDocument();
    await typeName(user);
    expect(deleteBtn()).toBeEnabled();
  });

  it('resolves null and closes by itself when the check fails', async () => {
    next.info = null;
    const { promise } = await open();

    await expect(promise).resolves.toBeNull();
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Delete bucket' })).not.toBeInTheDocument());
  });

  it('resolves null on Cancel without deleting', async () => {
    const { user, promise } = await open();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await expect(promise).resolves.toBeNull();
    expect(callIPCMock).toHaveBeenCalledTimes(1);
  });

  it('aborts the check when closed and ignores its late result', async () => {
    let finish!: () => void;
    callIPCMock.mockImplementation(((_fn: unknown, _args: unknown, options?: Options) => {
      signals.info = options?.signal;
      return new Promise(resolve => {
        finish = () => resolve(info());
      });
    }) as never);
    const { user } = await open(false);
    await flush();

    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(signals.info?.aborted).toBe(true));
    await act(async () => finish());

    expect(screen.queryByLabelText('Type my-bucket to confirm')).not.toBeInTheDocument();
  });

  describe('deleting', () => {
    let finish!: (value?: unknown) => void;
    const slowDelete = () =>
      callIPCMock.mockImplementation(((fn: unknown, _args: unknown, options?: Options) => {
        if (fn === GetBucketDeleteInfo) return Promise.resolve(next.info);
        signals.del = options?.signal;
        return new Promise(resolve => {
          finish = () => {
            options?.resolveAction?.({ body: next.del });
            resolve(next.del);
          };
        });
      }) as never);

    it('locks the modal while deleting and calls DeleteBucket without a signal', async () => {
      slowDelete();
      const { user, promise } = await open();
      await typeName(user);

      await user.click(deleteBtn());

      expect(callIPCMock).toHaveBeenLastCalledWith(
        DeleteBucket,
        [{ connectionId: 'c1', profileName: 'Prod', bucket: 'my-bucket' }],
        { resolveAction: expect.any(Function), rejectAction: expect.any(Function) }
      );
      expect(signals.del).toBeUndefined();
      expect(screen.getByText('Deleting...')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
      expect(nameField()).toBeDisabled();

      await user.keyboard('{Escape}');
      await user.click(document.body);
      expect(screen.getByText('Deleting...')).toBeInTheDocument();

      await act(async () => finish());
      await expect(promise).resolves.toEqual(next.del);
    });
  });

  describe('result', () => {
    async function runDelete() {
      const { user, promise } = await open();
      await typeName(user);
      await user.click(deleteBtn());
      return promise;
    }

    it('resolves the output when the bucket was deleted', async () => {
      next.del = result({ bucketDeleted: true, deleted: 3 });

      await expect(runDelete()).resolves.toEqual(next.del);
      expect(showDeleteResultModal).not.toHaveBeenCalled();
    });

    it('resolves the output when only some objects were deleted', async () => {
      next.del = result({ bucketDeleted: false, deleted: 3 });

      await expect(runDelete()).resolves.toEqual(next.del);
      expect(showDeleteResultModal).not.toHaveBeenCalled();
    });

    it('shows the failures and resolves the output when some deletes failed', async () => {
      const failures = [{ key: 'a.txt', error: 'denied' }];
      next.del = result({ bucketDeleted: false, deleted: 2, failed: 1, failures });

      await expect(runDelete()).resolves.toEqual(next.del);
      expect(showDeleteResultModal).toHaveBeenCalledExactlyOnceWith({ deleted: 2, failed: 1, failures });
    });

    it('resolves the output for failures only', async () => {
      next.del = result({ bucketDeleted: false, deleted: 0, failed: 2 });

      await expect(runDelete()).resolves.toEqual(next.del);
      expect(showDeleteResultModal).toHaveBeenCalledTimes(1);
    });

    it('resolves null when nothing changed', async () => {
      next.del = result({ bucketDeleted: false });

      await expect(runDelete()).resolves.toBeNull();
      expect(showDeleteResultModal).not.toHaveBeenCalled();
    });

    it('resolves null when the call failed without a body', async () => {
      next.del = null;

      await expect(runDelete()).resolves.toBeNull();
      expect(showDeleteResultModal).not.toHaveBeenCalled();
    });

    it('reads the body of a rejected output too', async () => {
      next.deleteVia = 'reject';
      next.del = result({ bucketDeleted: false, deleted: 1, failed: 1, failures: [{ key: 'k', error: 'e' }] });

      await expect(runDelete()).resolves.toEqual(next.del);
      expect(showDeleteResultModal).toHaveBeenCalledTimes(1);
    });

    it('resolves null when neither action reports an output', async () => {
      next.deleteVia = 'none';

      await expect(runDelete()).resolves.toBeNull();
    });
  });
});
