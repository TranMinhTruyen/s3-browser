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

  it('set, setAll and get', () => {
    expect(state().get('REGION')).toEqual([]);
    state().set('REGION', rows);
    expect(state().get('REGION')).toEqual(rows);
    state().setAll({ OTHER: rows } as never);
    expect(state().get('REGION')).toEqual(rows);
    expect(state().get('OTHER' as never)).toEqual(rows);
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
    expect(state().get('REGION')).toEqual(rows);
  });

  it('loadMissing only asks for codes not loaded yet', async () => {
    state().set('REGION', rows);
    await state().loadMissing(['REGION', 'OTHER'] as never);
    expect(callIPCMock).toHaveBeenCalledExactlyOnceWith(expect.anything(), [['OTHER']], expect.anything());

    callIPCMock.mockClear();
    await state().loadMissing(['REGION']);
    expect(callIPCMock).not.toHaveBeenCalled();
  });

  it('loadRegion stores region data, loadAll delegates to it', async () => {
    callIPCMock.mockResolvedValueOnce(null);
    await state().loadRegion();
    expect(state().getRegion()).toEqual({});

    callIPCMock.mockResolvedValueOnce({ regionData: { aws: rows } });
    await state().loadAll();
    expect(state().getRegion()).toEqual({ aws: rows });
  });

  it('reset clears the data and invalidates the scope', () => {
    state().set('REGION', rows);
    expect(state().reset()).toBe(true);
    expect(state().masterData).toEqual({});
    expect(invalidateLoads).toHaveBeenCalledWith('MasterData');
  });
});
