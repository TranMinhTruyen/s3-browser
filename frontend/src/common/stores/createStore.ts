// common/stores/createStore.ts
import { create, StateCreator, StoreApi, UseBoundStore } from 'zustand';
import { devtools } from 'zustand/middleware';

type AnyStore = UseBoundStore<StoreApi<unknown>>;

declare global {
  interface Window {
    /** Dev-only registry of every store created through {@link createStore}, keyed by store name. */
    __stores?: Record<string, AnyStore>;
    /** Dev-only snapshot of every registered store, keyed by store name. */
    __storeState?: () => Record<string, unknown>;
  }
}

export function createStore<T>(storeCreator: StateCreator<T, [['zustand/devtools', never]], [], T>, name: string) {
  const store = create<T>()(
    devtools(storeCreator, {
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
