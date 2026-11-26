import { vi } from 'vitest';

/**
 * Thay thế `@wailsio/runtime` trong các test cần tự định nghĩa thành viên riêng (ví dụ `Browser`, `Events`), đồng thời
 * cho phép bindings được sinh tự động tải: lúc import chúng chỉ cần `Create`, `Call` và `CancellablePromise`.
 */
export function wailsRuntimeMock<T extends Record<string, unknown>>(extra: T) {
  const any = (source: unknown) => source;
  return {
    Create: { Any: any, Array: () => any, Map: () => any, Nullable: () => any, Events: {} },
    Call: { ByID: vi.fn(), ByName: vi.fn() },
    CancellablePromise: Promise,
    ...extra,
  };
}
