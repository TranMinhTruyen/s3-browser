// common/stores/createStore.ts
import { create, StateCreator } from 'zustand';
import { devtools } from 'zustand/middleware';

export function createStore<T>(storeCreator: StateCreator<T, [['zustand/devtools', never]], [], T>, name: string) {
  return create<T>()(
    devtools(storeCreator, {
      name,
      enabled: import.meta.env.DEV,
    })
  );
}
