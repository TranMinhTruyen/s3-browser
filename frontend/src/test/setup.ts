import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// The Wails runtime prints a "Browser Environment Detected" warning when it is first imported without a WebView
// bridge. Import it once here with a no-op bridge (removed right after, since code under test checks for it), so the
// module is cached and the output stays clean. No test reaches the real backend.
Object.defineProperty(window, 'chrome', { configurable: true, value: { webview: { postMessage() {} } } });
await import('@wailsio/runtime');
delete (window as unknown as { chrome?: unknown }).chrome;

// The suite runs ~90 files in parallel; on a loaded machine the default 1s of findBy*/waitFor is too tight.
// This only raises the ceiling: a query that succeeds still returns at once.
configure({ asyncUtilTimeout: 4000 });

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
