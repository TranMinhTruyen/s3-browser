import { renderHook } from '@testing-library/react';
import type { UpdateStateOutput } from '@wails/S3Browser/models';
import { Events } from '@wailsio/runtime';
import { isValidElement, type ReactElement } from 'react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/common/cnst/settingConst';
import { useAppUpdate } from '@/common/hooks/useAppUpdate';
import { useSettingStore } from '@/common/stores/settingStore';
import { useUpdateStore } from '@/common/stores/updateStore';
import UpdateProgress from '@/components/display/UpdateProgress';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn() }) }));
vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));
vi.mock('@/components/modals/confirm/ConfirmModal', () => ({ default: { show: vi.fn() } }));
vi.mock('@wailsio/runtime', async () =>
  (await import('@/test/_helpers/wailsRuntimeMock')).wailsRuntimeMock({ Events: { On: vi.fn() } })
);

type ToastOptions = {
  id: string;
  duration: number;
  description?: ReactElement<{ written: number; total: number }>;
  action?: { label: string; onClick: (e: unknown) => void };
};
const lastToast = () => {
  const [title, options] = vi.mocked(toast).mock.calls.at(-1) as unknown as [string, ToastOptions];
  return { title, options };
};

type Handler = (e: { data: UpdateStateOutput }) => void;
const eventHandler = () => vi.mocked(Events.On).mock.calls[0][1] as unknown as Handler;
const payload = (patch: Partial<UpdateStateOutput>) =>
  ({ supported: true, state: 'idle', currentVersion: '1', written: 0, total: 0, ...patch }) as UpdateStateOutput;

const load = vi.fn();
const download = vi.fn();
const install = vi.fn();
const unsubscribe = vi.fn();
const setUpdate = (patch: Partial<UpdateStateOutput>) =>
  useUpdateStore.setState({ supported: true, version: '1.1.0', written: 0, total: 0, ...patch } as never);

describe('useAppUpdate', () => {
  beforeEach(() => {
    useUpdateStore.getState().reset();
    useSettingStore.setState({ saved: { ...DEFAULT_SETTINGS, autoUpdate: false } });
    vi.clearAllMocks();
    vi.mocked(Events.On).mockReturnValue(unsubscribe);
    useUpdateStore.setState({ load, download, install });
  });

  describe('subscription', () => {
    it('loads the state, listens to the event and stops on unmount', () => {
      const { unmount } = renderHook(() => useAppUpdate());

      expect(load).toHaveBeenCalledTimes(1);
      expect(Events.On).toHaveBeenCalledExactlyOnceWith('update:state-changed', expect.any(Function));

      unmount();
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('stores a pushed state', () => {
      renderHook(() => useAppUpdate());

      eventHandler()({ data: payload({ state: 'available', version: '2' }) });

      expect(useUpdateStore.getState()).toMatchObject({ state: 'available', version: '2' });
    });

    it('toasts the download failure with the backend message when the download was running', () => {
      useUpdateStore.setState({ state: 'downloading' });
      renderHook(() => useAppUpdate());

      eventHandler()({ data: payload({ state: 'error', errorCode: 'UPE004' }) });

      expect(toast.error).toHaveBeenCalledExactlyOnceWith(
        'The update has no checksum or the checksum does not match, the file was deleted.'
      );
    });

    it('replaces the version placeholder of the download failure message', () => {
      useUpdateStore.setState({ state: 'downloading' });
      renderHook(() => useAppUpdate());

      eventHandler()({ data: payload({ state: 'error', errorCode: 'UPE006', version: '2.5.0' }) });

      expect(toast.error).toHaveBeenCalledExactlyOnceWith('Version 2.5.0 has no installer for this machine.');
    });

    it.each([
      ['error without code while downloading', 'downloading', { state: 'error' }],
      ['error with code while not downloading', 'checking', { state: 'error', errorCode: 'UPE001' }],
      ['non-error while downloading', 'downloading', { state: 'ready' }],
    ] as const)('does not toast an error for %s', (_n, previous, next) => {
      useUpdateStore.setState({ state: previous });
      renderHook(() => useAppUpdate());

      eventHandler()({ data: payload(next) });

      expect(toast.error).not.toHaveBeenCalled();
    });
  });

  describe('toast', () => {
    it('does nothing when updates are not supported', () => {
      useUpdateStore.setState({ supported: false, state: 'available' });
      renderHook(() => useAppUpdate());

      expect(toast).not.toHaveBeenCalled();
      expect(toast.dismiss).not.toHaveBeenCalled();
    });

    it('announces an available version with a Download button when auto update is off', () => {
      setUpdate({ state: 'available' });
      renderHook(() => useAppUpdate());

      const { title, options } = lastToast();
      expect(title).toBe('Version 1.1.0 is available');
      expect(options).toMatchObject({ id: 'app-update', duration: Infinity });
      expect(options.action?.label).toBe('Download');

      options.action?.onClick({});
      expect(download).toHaveBeenCalledTimes(1);
    });

    it('has no button for an available version when auto update is on', () => {
      useSettingStore.setState({ saved: { ...DEFAULT_SETTINGS, autoUpdate: true } });
      setUpdate({ state: 'available' });
      renderHook(() => useAppUpdate());

      expect(lastToast().options.action).toBeUndefined();
    });

    it.each([
      [2048, 1024],
      [0, 1024],
    ])('shows the download progress (total %i, written %i)', (total, written) => {
      setUpdate({ state: 'downloading', written, total });
      renderHook(() => useAppUpdate());

      const { title, options } = lastToast();
      expect(title).toBe('Downloading version 1.1.0');
      expect(options).toMatchObject({ id: 'app-update', duration: Infinity });
      expect(options.action).toBeUndefined();
      expect(isValidElement(options.description)).toBe(true);
      expect(options.description?.type).toBe(UpdateProgress);
      expect(options.description?.props).toEqual({ written, total });
    });

    it('offers Update when ready and keeps the toast when the click is handled', () => {
      setUpdate({ state: 'ready' });
      renderHook(() => useAppUpdate());

      const { title, options } = lastToast();
      expect(title).toBe('Version 1.1.0 is ready to install');
      expect(options.action?.label).toBe('Update');

      const preventDefault = vi.fn();
      options.action?.onClick({ preventDefault });
      expect(preventDefault).toHaveBeenCalledTimes(1);
      expect(install).toHaveBeenCalledTimes(1);
    });

    it.each(['idle', 'checking', 'upToDate', 'error'] as const)('dismisses the toast in state %s', state => {
      setUpdate({ state });
      renderHook(() => useAppUpdate());

      expect(toast.dismiss).toHaveBeenCalledWith('app-update');
      expect(toast).not.toHaveBeenCalled();
    });
  });
});
