import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ModalKey =
  | 'connect'
  | 'mfaCode'
  | 'history'
  | 'setting'
  | 'uploadPicker'
  | 'uploadLimit'
  | 'deleteResult'
  | 'deleteConfirm'
  | 'createBucket'
  | 'bucketPolicy'
  | 'deleteBucket';
type LazyModals = typeof import('@/components/modals/lazyModals');

// The chunk factories wait for `gate` and throw when `fail` is set, which makes the dynamic `import()` reject.
const h = vi.hoisted(() => ({
  gate: Promise.resolve() as Promise<void>,
  fail: false,
  show: {} as Record<string, ReturnType<typeof vi.fn>>,
  toast: { error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() },
}));
for (const key of [
  'connect',
  'mfaCode',
  'history',
  'setting',
  'uploadPicker',
  'uploadLimit',
  'deleteResult',
  'deleteConfirm',
  'createBucket',
  'bucketPolicy',
  'deleteBucket',
])
  h.show[key] = vi.fn();

const chunk = (key: ModalKey) => async () => {
  await h.gate;
  if (h.fail) throw new Error('chunk failed');
  return { default: { show: h.show[key] } };
};
vi.mock('sonner', () => ({ toast: h.toast }));

const CHUNKS: [string, ModalKey][] = [
  ['connect/ConnectModal', 'connect'],
  ['connect/MfaCodeModal', 'mfaCode'],
  ['history/HistoryModal', 'history'],
  ['setting/SettingModal', 'setting'],
  ['upload/UploadPickerModal', 'uploadPicker'],
  ['upload/UploadLimitModal', 'uploadLimit'],
  ['delete/DeleteConfirmModal', 'deleteConfirm'],
  ['delete/DeleteResultModal', 'deleteResult'],
  ['bucket/CreateBucketModal', 'createBucket'],
  ['bucket/BucketPolicyModal', 'bucketPolicy'],
  ['bucket/DeleteBucketModal', 'deleteBucket'],
];

const PROPS = {
  picker: { tabId: 't' } as never,
  limit: { groups: [] } as never,
  confirm: { files: [{ key: 'a', size: 1 }] } as never,
  result: { deleted: 1, failed: 0, failures: [] } as never,
  create: { connectionId: 'c', withRegion: true, defaultRegion: 'eu-west-1' } as never,
  policy: { connectionId: 'c', profileName: 'n', bucket: 'b' } as never,
  deleteBucket: { connectionId: 'c', profileName: 'n', bucket: 'b' } as never,
};
const wrappers: [ModalKey, (m: LazyModals) => Promise<unknown>][] = [
  ['connect', m => m.showConnectModal({ mode: 'editProfile' })],
  ['mfaCode', m => m.showMfaCodeModal({ connectionId: 'c', profileName: 'n' })],
  ['history', m => m.showHistoryModal()],
  ['setting', m => m.showSettingModal()],
  ['uploadPicker', m => m.showUploadPickerModal(PROPS.picker)],
  ['uploadLimit', m => m.showUploadLimitModal(PROPS.limit)],
  ['deleteConfirm', m => m.showDeleteConfirmModal(PROPS.confirm)],
  ['deleteResult', m => m.showDeleteResultModal(PROPS.result)],
  ['createBucket', m => m.showCreateBucketModal(PROPS.create)],
  ['bucketPolicy', m => m.showBucketPolicyModal(PROPS.policy)],
  ['deleteBucket', m => m.showDeleteBucketModal(PROPS.deleteBucket)],
];

// What MfaCodeModal imports besides modalUtils; stubbed by the string-failure test.
const HEAVY_CHUNK_DEPS = [
  '@mantine/core',
  '@mantine/form',
  '@wails/S3Browser/internal/handlers/buckethandler',
  '@/common/stores/profileStore',
  '@/common/utils/ipcUtils',
  '@/components/buttons/Button',
  '@/components/buttons/CloseButton',
  '@/components/inputs/FieldInput',
];

// A fresh module registry per test, so a chunk that failed (or loaded) once is not cached for the next test.
async function loadModule() {
  vi.resetModules();
  vi.doUnmock('@/common/utils/modalUtils');
  for (const id of HEAVY_CHUNK_DEPS) vi.doUnmock(id);
  for (const [file, key] of CHUNKS) vi.doMock(`@/components/modals/${file}`, () => chunk(key)());
  const lazy = await import('@/components/modals/lazyModals');
  const i18n = (await import('@/locales/i18n')).default;
  return { lazy, i18n };
}

describe('lazyModals', () => {
  beforeEach(() => {
    h.gate = Promise.resolve();
    h.fail = false;
    h.toast.loading.mockReturnValue('loading-id');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe.each(wrappers)('%s', (key, open) => {
    it('shows the modal once the chunk is loaded', async () => {
      h.show[key].mockResolvedValue('result');
      const { lazy } = await loadModule();

      await expect(open(lazy)).resolves.toBe('result');

      expect(h.show[key]).toHaveBeenCalledTimes(1);
      expect(h.toast.error).not.toHaveBeenCalled();
    });

    it('toasts the failure reason and resolves undefined when the chunk fails to load', async () => {
      h.fail = true;
      const { lazy, i18n } = await loadModule();

      await expect(open(lazy)).resolves.toBeUndefined();

      expect(h.show[key]).not.toHaveBeenCalled();
      const message = i18n.t('common:modalLoadError');
      expect(message).not.toBe('modalLoadError');
      // vitest reports a failing mock factory as an Error, whose message is the description.
      expect(h.toast.error).toHaveBeenCalledExactlyOnceWith(message, {
        description: expect.stringContaining('error when mocking a module'),
      });
    });

    it('propagates an error thrown by show() without reporting a chunk error', async () => {
      const error = new Error('show failed');
      h.show[key].mockRejectedValue(error);
      const { lazy } = await loadModule();

      await expect(open(lazy)).rejects.toBe(error);

      expect(h.toast.error).not.toHaveBeenCalled();
    });
  });

  it('describes a failure that is not an Error with its string form', async () => {
    // vitest wraps what a mock factory throws in an Error, so the raw string is thrown by evaluating a real chunk
    // (the MfaCodeModal one: its only top-level work is createMantineModal). Its heavy imports are stubbed, so no
    // Mantine/app tree is loaded and the test stays fast on a cold, loaded run.
    const { i18n } = await loadModule();
    vi.resetModules();
    vi.doUnmock('@/components/modals/connect/MfaCodeModal');
    for (const id of HEAVY_CHUNK_DEPS) vi.doMock(id, () => ({}));
    vi.doMock('@/common/utils/modalUtils', () => ({
      createMantineModal: () => {
        throw 'plain failure';
      },
    }));
    const failing = await import('@/components/modals/lazyModals');

    await expect(failing.showMfaCodeModal({ connectionId: 'c', profileName: 'n' })).resolves.toBeUndefined();

    expect(h.toast.error).toHaveBeenCalledExactlyOnceWith(i18n.t('common:modalLoadError'), {
      description: 'plain failure',
    });
  });

  it('passes the props through to show()', async () => {
    const { lazy } = await loadModule();

    await lazy.showConnectModal({ mode: 'manualconnect' });
    await lazy.showUploadPickerModal(PROPS.picker);
    await lazy.showUploadLimitModal(PROPS.limit);
    await lazy.showDeleteConfirmModal(PROPS.confirm);
    await lazy.showDeleteResultModal(PROPS.result);
    await lazy.showCreateBucketModal(PROPS.create);
    await lazy.showBucketPolicyModal(PROPS.policy);
    await lazy.showDeleteBucketModal(PROPS.deleteBucket);

    expect(h.show.connect).toHaveBeenCalledWith({ mode: 'manualconnect' });
    expect(h.show.uploadPicker).toHaveBeenCalledWith(PROPS.picker);
    expect(h.show.uploadLimit).toHaveBeenCalledWith(PROPS.limit);
    expect(h.show.deleteConfirm).toHaveBeenCalledWith(PROPS.confirm);
    expect(h.show.deleteResult).toHaveBeenCalledWith(PROPS.result);
    expect(h.show.createBucket).toHaveBeenCalledWith(PROPS.create);
    expect(h.show.bucketPolicy).toHaveBeenCalledWith(PROPS.policy);
    expect(h.show.deleteBucket).toHaveBeenCalledWith(PROPS.deleteBucket);
  });

  it('passes the connection to the MFA code modal', async () => {
    const { lazy } = await loadModule();

    await lazy.showMfaCodeModal({ connectionId: 'c1', profileName: 'one' });

    expect(h.show.mfaCode).toHaveBeenCalledWith({ connectionId: 'c1', profileName: 'one' });
  });

  describe('loading toast', () => {
    const slowGate = () => {
      let release!: () => void;
      let rejectGate!: (e: unknown) => void;
      h.gate = new Promise<void>((resolve, reject) => {
        release = resolve;
        rejectGate = reject;
      });
      return { release, rejectGate };
    };

    it('does not show a loading toast when the chunk loads before 300ms', async () => {
      vi.useFakeTimers();
      const { lazy } = await loadModule();

      const done = lazy.showHistoryModal();
      await vi.advanceTimersByTimeAsync(299);
      await done;
      await vi.advanceTimersByTimeAsync(1000);

      expect(h.toast.loading).not.toHaveBeenCalled();
      expect(h.toast.dismiss).not.toHaveBeenCalled();
    });

    it('shows a loading toast after 300ms and dismisses it when the chunk is loaded', async () => {
      vi.useFakeTimers();
      const { release } = slowGate();
      const { lazy, i18n } = await loadModule();

      const done = lazy.showSettingModal();
      await vi.advanceTimersByTimeAsync(299);
      expect(h.toast.loading).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(h.toast.loading).toHaveBeenCalledExactlyOnceWith(i18n.t('common:modalLoading'));
      expect(i18n.t('common:modalLoading')).not.toBe('modalLoading');
      expect(h.toast.dismiss).not.toHaveBeenCalled();

      release();
      await done;

      expect(h.show.setting).toHaveBeenCalledTimes(1);
      expect(h.toast.dismiss).toHaveBeenCalledExactlyOnceWith('loading-id');
    });

    it('dismisses the loading toast when the slow chunk fails', async () => {
      vi.useFakeTimers();
      const { rejectGate } = slowGate();
      const { lazy } = await loadModule();

      const done = lazy.showConnectModal({ mode: 'connect' });
      await vi.advanceTimersByTimeAsync(300);
      expect(h.toast.loading).toHaveBeenCalledTimes(1);

      rejectGate(new Error('late failure'));
      await expect(done).resolves.toBeUndefined();

      expect(h.toast.dismiss).toHaveBeenCalledExactlyOnceWith('loading-id');
      expect(h.toast.error).toHaveBeenCalledTimes(1);
    });

    it('does not dismiss anything when a fast chunk fails', async () => {
      vi.useFakeTimers();
      h.fail = true;
      const { lazy } = await loadModule();

      await expect(lazy.showHistoryModal()).resolves.toBeUndefined();
      await vi.advanceTimersByTimeAsync(1000);

      expect(h.toast.loading).not.toHaveBeenCalled();
      expect(h.toast.dismiss).not.toHaveBeenCalled();
    });
  });
});
