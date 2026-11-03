import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// The real Wails runtime prints a "Browser Environment Detected" warning when loaded outside the desktop app, and no
// test may reach the backend. Replace it with a light stand-in for everything the app and the generated bindings use;
// a test that needs different behavior overrides it with its own `vi.mock('@wailsio/runtime', ...)`.
vi.mock('@wailsio/runtime', () => {
  class CancelError extends Error {
    constructor(message?: string, options?: ErrorOptions) {
      super(message, options);
      this.name = 'CancelError';
    }
  }

  // A promise that rejects with a CancelError once canceled (what `callIPC` relies on).
  class CancellablePromise<T> extends Promise<T> {
    static get [Symbol.species]() {
      return Promise;
    }

    private rejectWith: (reason: unknown) => void = () => {};

    constructor(executor: (resolve: (value: T) => void, reject: (reason?: unknown) => void) => void) {
      let rejectFn: (reason: unknown) => void = () => {};
      super((resolve, reject) => {
        rejectFn = reject;
        executor(resolve, reject);
      });
      this.rejectWith = rejectFn;
    }

    cancel(cause?: unknown) {
      this.rejectWith(new CancelError('', { cause }));
      return Promise.resolve();
    }

    cancelOn(signal: AbortSignal) {
      if (signal.aborted) void this.cancel(signal.reason);
      else signal.addEventListener('abort', () => void this.cancel(signal.reason), { once: true });
      return this;
    }
  }

  const any = (source: unknown) => source;
  const Create = { Any: any, Array: () => any, Map: () => any, Nullable: () => any, Events: {} };

  return {
    CancelError,
    CancellablePromise,
    Create,
    Call: { ByID: vi.fn(), ByName: vi.fn() },
    Events: { On: vi.fn(() => () => {}), Off: vi.fn(), Emit: vi.fn() },
    Window: {
      IsMaximised: vi.fn(async () => false),
      Minimise: vi.fn(),
      ToggleMaximise: vi.fn(),
      Close: vi.fn(),
    },
  };
});

// The suite runs ~100 files in parallel; on a loaded machine the default 1s of findBy*/waitFor is too tight.
// 2s was enough: the whole suite ran 3 times in a row with no timeout flake (4s was not needed).
// This only raises the ceiling: a query that succeeds still returns at once.
configure({ asyncUtilTimeout: 2000 });

// jsdom lacks these browser APIs used by Mantine.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
});

// jsdom has no FontFaceSet; Mantine's autosize Textarea listens to it.
Object.defineProperty(document, 'fonts', {
  configurable: true,
  value: { addEventListener() {}, removeEventListener() {} },
});

window.HTMLElement.prototype.scrollTo = vi.fn();
window.HTMLElement.prototype.scrollIntoView = vi.fn();

afterEach(() => {
  cleanup();
});
