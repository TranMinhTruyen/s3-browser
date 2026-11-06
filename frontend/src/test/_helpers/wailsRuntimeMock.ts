import { vi } from 'vitest';

/**
 * Stand-in for `@wailsio/runtime` for tests that must define their own members (e.g. `Browser`, `Events`) and still
 * let the generated bindings load: they only need `Create`, `Call` and `CancellablePromise` at import time.
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
