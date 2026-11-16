import { renderHook } from '@testing-library/react';
import { ConnectS3ByProfile } from '@wails/S3Browser/internal/handlers/buckethandler';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callIPC } from '@/common/utils/ipcUtils';
import { useConnectProfile } from '@/pages/s3/hooks/useConnectProfile';
import { type ConnectionProfile, useProfileStore } from '@/pages/s3/stores/profileStore';

vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));
vi.mock('@wails/S3Browser/internal/handlers/buckethandler', () => ({ ConnectS3ByProfile: vi.fn() }));
vi.mock('@wails/S3Browser/internal/handlers/profilehandler', () => ({ GetAllConnectionProfile: vi.fn() }));

const profile = { id: 'p1', name: 'one', isConnected: false } as ConnectionProfile;
const stored = () => useProfileStore.getState().connectionProfiles.p1;

describe('useConnectProfile', () => {
  beforeEach(() => {
    useProfileStore.setState({ connectionProfiles: { p1: profile } });
  });

  it('connects through the backend, marks the profile connected and resolves true', async () => {
    vi.mocked(callIPC).mockResolvedValue({ isConnected: true } as never);
    const { result } = renderHook(() => useConnectProfile());

    await expect(result.current('p1', profile)).resolves.toBe(true);

    expect(callIPC).toHaveBeenCalledExactlyOnceWith(ConnectS3ByProfile, ['p1'], { signal: expect.any(AbortSignal) });
    expect(stored()).toEqual({ ...profile, isConnected: true });
  });

  it.each([
    ['callIPC returns null', null],
    ['the backend reports not connected', { isConnected: false }],
  ])('resolves false and keeps the profile disconnected when %s', async (_name, output) => {
    vi.mocked(callIPC).mockResolvedValue(output as never);
    const { result } = renderHook(() => useConnectProfile());

    await expect(result.current('p1', profile)).resolves.toBe(false);

    expect(stored()?.isConnected).toBe(false);
  });

  it('cancels the call when the caller unmounts and resolves false without touching the profile', async () => {
    let signal: AbortSignal | undefined;
    vi.mocked(callIPC).mockImplementation(async (_binding, _args, options) => {
      signal = options?.signal;
      return new Promise(resolve => options?.signal?.addEventListener('abort', () => resolve(null as never)));
    });
    const { result, unmount } = renderHook(() => useConnectProfile());

    const pending = result.current('p1', profile);
    expect(signal?.aborted).toBe(false);
    unmount();

    await expect(pending).resolves.toBe(false);
    expect(signal?.aborted).toBe(true);
    expect(stored()?.isConnected).toBe(false);
  });

  it('returns a stable function across renders', () => {
    const { result, rerender } = renderHook(() => useConnectProfile());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
