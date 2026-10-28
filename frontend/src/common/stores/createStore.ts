// common/stores/createStore.ts
import { create, StateCreator, StoreApi, UseBoundStore } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

type AnyStore = UseBoundStore<StoreApi<unknown>>;

declare global {
  interface Window {
    /** Dev-only registry of every store created through {@link createAppStore}, keyed by store name. */
    __stores?: Record<string, AnyStore>;
    /** Dev-only snapshot of every registered store, keyed by store name. */
    __storeState?: () => Record<string, unknown>;
  }
}

/**
 * Creates a zustand store with devtools (dev only) and immer.
 * In dev the store is also exposed on `window.__stores[name]`.
 *
 * @param storeCreator - state and actions; actions call `set(update, undefined, 'scope/action')`.
 * @param name - unique store name used by devtools and `window.__stores`.
 * @returns the bound store hook.
 */
export function createAppStore<T>(
  storeCreator: StateCreator<T, [['zustand/devtools', never], ['zustand/immer', never]], [], T>,
  name: string
) {
  const store = create<T>()(
    devtools(immer(storeCreator), {
      name,
      enabled: import.meta.env.DEV,
    })
  );

  if (import.meta.env.DEV) {
    // The WebView2 inspector carries no Redux DevTools extension, so the devtools
    // middleware above has nothing to talk to. Expose the store on `window` instead:
    //   __stores.MasterData.getState()
    //   __stores.MasterData.subscribe(console.log)
    //   __storeState()
    const registry = (window.__stores ??= {});
    registry[name] = store as unknown as AnyStore;
    window.__storeState ??= () =>
      Object.fromEntries(Object.entries(window.__stores ?? {}).map(([key, value]) => [key, value.getState()]));
  }

  return store;
}
