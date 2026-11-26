// common/stores/createStore.ts
import { create, StateCreator, StoreApi, UseBoundStore } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

type AnyStore = UseBoundStore<StoreApi<unknown>>;

declare global {
  interface Window {
/** Registry chỉ dùng khi phát triển, chứa mọi store được tạo qua {@link createAppStore}, lập chỉ mục theo tên store. */
    __stores?: Record<string, AnyStore>;
/** Ảnh chụp chỉ dùng khi phát triển của mọi store đã đăng ký, lập chỉ mục theo tên store. */
    __storeState?: () => Record<string, unknown>;
  }
}

/**
 * Tạo zustand store có devtools (chỉ trong môi trường phát triển) và immer.
 * Trong môi trường phát triển, store cũng được đưa ra `window.__stores[name]`.
 *
 * @param storeCreator - state và action; action gọi `set(update, undefined, 'scope/action')`.
 * @param name - tên store duy nhất, dùng cho devtools và `window.__stores`.
 * @returns hook đã liên kết với store.
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
    // Inspector của WebView2 không có tiện ích Redux DevTools nên middleware devtools ở trên không có nơi kết nối.
    // Thay vào đó, đưa store ra `window`:
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
