import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useProfileStore } from '@/common/stores/profileStore';
import { callIPC, invalidateLoads } from '@/common/utils/ipcUtils';

vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));
vi.mock('@wails/S3Browser/internal/handlers/profilehandler', () => ({ GetAllConnectionProfile: vi.fn() }));

const profile = { id: 'p1', name: 'one' } as never;
const callIPCMock = vi.mocked(callIPC);
const state = () => useProfileStore.getState();

describe('profileStore', () => {
  beforeEach(() => {
    state().reset();
    vi.clearAllMocks();
  });

  it('loadConnectionProfiles stores the output', async () => {
    callIPCMock.mockResolvedValueOnce({ connectionProfiles: { p1: profile } });
    await expect(state().loadConnectionProfiles()).resolves.toBe(true);
    expect(state().connectionProfiles).toEqual({ p1: profile });
  });

  it('loadConnectionProfiles falls back to an empty map', async () => {
    useProfileStore.setState({ connectionProfiles: { p1: profile } });
    callIPCMock.mockResolvedValueOnce({});
    await state().loadConnectionProfiles();
    expect(state().connectionProfiles).toEqual({});
  });

  it('loadConnectionProfiles keeps the state when the call fails', async () => {
    useProfileStore.setState({ connectionProfiles: { p1: profile } });
    callIPCMock.mockResolvedValueOnce(null);
    await expect(state().loadConnectionProfiles()).resolves.toBe(false);
    expect(state().connectionProfiles).toEqual({ p1: profile });
  });

  it('getConnectionProfileById', () => {
    useProfileStore.setState({ connectionProfiles: { p1: profile } });
    expect(state().getConnectionProfileById('p1')).toEqual(profile);
    expect(state().getConnectionProfileById('nope')).toBeUndefined();
    expect(state().getConnectionProfileById(null)).toBeNull();
    expect(state().getConnectionProfileById()).toBeNull();
  });

  it('update and delete', () => {
    state().updateConnectionProfiles('p1', profile);
    expect(state().connectionProfiles.p1).toEqual(profile);
    state().deleteConnectionProfiles('p1');
    expect(state().connectionProfiles).toEqual({});
  });

  it('reset invalidates the scope', () => {
    state().reset();
    expect(invalidateLoads).toHaveBeenCalledWith('profile');
  });
});
