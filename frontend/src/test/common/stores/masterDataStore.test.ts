import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMasterDataStore } from '@/common/stores/masterDataStore';
import { callIPC, invalidateLoads } from '@/common/utils/ipcUtils';

vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));
vi.mock('@wails/S3Browser/internal/handlers/masterhandler', () => ({
  GetMasterData: vi.fn(),
  GetRegionData: vi.fn(),
}));

const rows = [{ value: 'us-east-1' }] as never;
const callIPCMock = vi.mocked(callIPC);
const state = () => useMasterDataStore.getState();

describe('masterDataStore', () => {
  beforeEach(() => {
    state().reset();
    vi.clearAllMocks();
  });

  it('setAll merges and keeps codes it does not carry', () => {
    state().setAll({ REGION: rows });
    state().setAll({ OTHER: rows } as never);
    expect(state().masterData).toEqual({ REGION: rows, OTHER: rows });
  });

  it('load does nothing without keys', async () => {
    await state().load([]);
    expect(callIPCMock).not.toHaveBeenCalled();
  });

  it('load ignores a failed call', async () => {
    callIPCMock.mockResolvedValueOnce(null);
    await state().load(['REGION']);
    expect(state().masterData).toEqual({});
  });

  it('load stores the returned master data', async () => {
    callIPCMock.mockResolvedValueOnce({ masterData: { REGION: rows } });
    await state().load(['REGION']);
    expect(state().masterData.REGION).toEqual(rows);
  });

  it('loadRegion stores region data, loadAll delegates to it', async () => {
    callIPCMock.mockResolvedValueOnce(null);
    await state().loadRegion();
    expect(state().regionData).toEqual({});

    callIPCMock.mockResolvedValueOnce({ regionData: { aws: rows } });
    await state().loadAll();
    expect(state().regionData).toEqual({ aws: rows });
  });

  it('reset clears the data and invalidates the scope', () => {
    state().setAll({ REGION: rows });
    expect(state().reset()).toBe(true);
    expect(state().masterData).toEqual({});
    expect(invalidateLoads).toHaveBeenCalledWith('MasterData');
  });
});
