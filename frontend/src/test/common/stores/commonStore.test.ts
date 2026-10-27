import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_WIDTH, MIN_WIDTH, useCommonStore } from '@/common/stores/commonStore';
import { invalidateLoads } from '@/common/utils/ipcUtils';

vi.mock('@/common/utils/ipcUtils', () => ({ invalidateLoads: vi.fn(), callIPC: vi.fn() }));

describe('commonStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes the width limits', () => {
    expect([MIN_WIDTH, MAX_WIDTH]).toEqual([240, 480]);
  });

  it('has no state besides its actions', () => {
    expect(Object.keys(useCommonStore.getState())).toEqual(['reset']);
  });

  it('reset invalidates the pending loads of its scope', () => {
    useCommonStore.getState().reset();
    expect(invalidateLoads).toHaveBeenCalledWith('common');
  });
});
