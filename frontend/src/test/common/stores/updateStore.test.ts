import {
  CheckUpdate,
  DownloadUpdate,
  GetUpdateState,
  InstallUpdate,
} from '@wails/S3Browser/internal/handlers/updatehandler';
import type { UpdateStateOutput } from '@wails/S3Browser/models';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUpdateStore } from '@/common/stores/updateStore';
import { callIPC, invalidateLoads } from '@/common/utils/ipcUtils';
import ConfirmModal from '@/components/modals/confirm/ConfirmModal';
import { useDownloaderStore } from '@/pages/s3/stores/downloaderStore';
import { useUploaderStore } from '@/pages/s3/stores/uploaderStore';

vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));
vi.mock('@/components/modals/confirm/ConfirmModal', () => ({ default: { show: vi.fn() } }));
vi.mock('@wails/S3Browser/internal/handlers/updatehandler', () => ({
  CheckUpdate: vi.fn(),
  DownloadUpdate: vi.fn(),
  GetUpdateState: vi.fn(),
  InstallUpdate: vi.fn(),
}));

const state = () => useUpdateStore.getState();
const out = (patch: Partial<UpdateStateOutput> = {}) =>
  ({ supported: true, state: 'idle', currentVersion: '1.0.0', written: 0, total: 0, ...patch }) as UpdateStateOutput;

describe('updateStore', () => {
  beforeEach(() => {
    state().reset();
    useUploaderStore.getState().reset();
    useDownloaderStore.getState().reset();
    vi.clearAllMocks();
  });

  it('starts unsupported and idle', () => {
    expect(state()).toMatchObject({ supported: false, state: 'idle', currentVersion: '', written: 0, total: 0 });
  });

  describe('load', () => {
    it('reads the backend state quietly', async () => {
      vi.mocked(callIPC).mockResolvedValueOnce(out({ state: 'available', version: '1.1.0', releaseUrl: 'https://r' }));

      await state().load();

      expect(callIPC).toHaveBeenCalledExactlyOnceWith(GetUpdateState, [], { scope: 'Update/load', showMessage: false });
      expect(state()).toMatchObject({
        supported: true,
        state: 'available',
        currentVersion: '1.0.0',
        version: '1.1.0',
        releaseUrl: 'https://r',
      });
    });

    it('keeps the state when the call returns null', async () => {
      vi.mocked(callIPC).mockResolvedValueOnce(null);

      await state().load();

      expect(state().supported).toBe(false);
    });
  });

  describe('setState', () => {
    it('takes the pushed state, including download progress and error code', () => {
      state().setState(out({ state: 'error', written: 5, total: 10, errorCode: 'UPE003' }));

      expect(state()).toMatchObject({ state: 'error', written: 5, total: 10, errorCode: 'UPE003' });
    });

    it('ignores an empty payload', () => {
      state().setState(undefined as never);

      expect(state().state).toBe('idle');
    });
  });

  it.each([
    ['check', CheckUpdate, 'Update/check'],
    ['download', DownloadUpdate, 'Update/download'],
  ] as const)('%s calls the binding and takes the returned state', async (name, binding, scope) => {
    vi.mocked(callIPC).mockResolvedValueOnce(out({ state: 'downloading', written: 1, total: 2 }));

    await state()[name]();

    expect(callIPC).toHaveBeenCalledExactlyOnceWith(binding, [], { scope });
    expect(state()).toMatchObject({ state: 'downloading', written: 1, total: 2 });
  });

  it('check keeps the state when the call fails (null)', async () => {
    vi.mocked(callIPC).mockResolvedValueOnce(null);

    await state().check();

    expect(state().state).toBe('idle');
  });

  describe('install', () => {
    it('does nothing when the user cancels the confirmation', async () => {
      vi.mocked(ConfirmModal.show).mockResolvedValueOnce(false as never);

      await state().install();

      expect(callIPC).not.toHaveBeenCalled();
    });

    it('asks with the info message when nothing is running, then installs', async () => {
      vi.mocked(ConfirmModal.show).mockResolvedValueOnce(true as never);
      vi.mocked(callIPC).mockResolvedValueOnce(out({ state: 'ready', version: '1.1.0' }));

      await state().install();

      expect(ConfirmModal.show).toHaveBeenCalledExactlyOnceWith({
        type: 'info',
        confirmCode: 'C000009',
        params: { count: 0 },
      });
      expect(callIPC).toHaveBeenCalledExactlyOnceWith(InstallUpdate, [], { scope: 'Update/install' });
      expect(state().state).toBe('ready');
    });

    it('warns with the number of running uploads and downloads', async () => {
      useUploaderStore.setState({ uploadItems: { u1: {}, u2: {} } as never });
      useDownloaderStore.setState({ downloadingIds: ['d1'] });
      vi.mocked(ConfirmModal.show).mockResolvedValueOnce(true as never);
      vi.mocked(callIPC).mockResolvedValueOnce(null);

      await state().install();

      expect(ConfirmModal.show).toHaveBeenCalledExactlyOnceWith({
        type: 'warning',
        confirmCode: 'C000010',
        params: { count: 3 },
      });
      expect(state().state).toBe('idle');
    });
  });

  it('reset cancels pending loads and clears the state', () => {
    state().setState(out({ state: 'error', version: '2', releaseUrl: 'https://r', errorCode: 'UPE001' }));

    state().reset();

    expect(invalidateLoads).toHaveBeenCalledWith('Update');
    expect(state()).toMatchObject({ supported: false, state: 'idle', version: undefined, releaseUrl: undefined });
    expect(state().errorCode).toBeUndefined();
  });
});
