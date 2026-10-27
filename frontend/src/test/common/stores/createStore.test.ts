import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadCreateAppStore() {
  vi.resetModules();
  return (await import('@/common/stores/createStore')).createAppStore;
}

describe('createAppStore', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete window.__stores;
    delete window.__storeState;
  });

  it('creates a working store and registers it on window in dev', async () => {
    const createAppStore = await loadCreateAppStore();
    const useA = createAppStore<{ n: number; inc: () => void }>(
      set => ({
        n: 0,
        inc: () => set(s => ({ n: s.n + 1 }), undefined, 'a/inc'),
      }),
      'A'
    );
    useA.getState().inc();

    expect(useA.getState().n).toBe(1);
    expect(window.__stores?.A).toBe(useA);
    expect(window.__storeState?.()).toEqual({ A: expect.objectContaining({ n: 1 }) });
  });

  it('keeps the existing registry and snapshot function for later stores', async () => {
    const createAppStore = await loadCreateAppStore();
    createAppStore(() => ({ x: 1 }), 'First');
    const snapshot = window.__storeState;
    createAppStore(() => ({ y: 2 }), 'Second');

    expect(window.__storeState).toBe(snapshot);
    expect(Object.keys(window.__stores ?? {})).toEqual(['First', 'Second']);
  });

  it('snapshot falls back to an empty registry when __stores is removed', async () => {
    const createAppStore = await loadCreateAppStore();
    createAppStore(() => ({ x: 1 }), 'Only');
    delete window.__stores;

    expect(window.__storeState?.()).toEqual({});
  });

  it('does not touch window outside dev', async () => {
    vi.stubEnv('DEV', false);
    const createAppStore = await loadCreateAppStore();
    const useStore = createAppStore(() => ({ x: 1 }), 'Prod');

    expect(useStore.getState().x).toBe(1);
    expect(window.__stores).toBeUndefined();
    expect(window.__storeState).toBeUndefined();
  });
});
