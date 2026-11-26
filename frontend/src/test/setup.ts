import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Runtime Wails thật in cảnh báo "Browser Environment Detected" khi được tải ngoài ứng dụng desktop, và test không được
// gọi đến backend. Thay bằng bản giả lập nhẹ đáp ứng những gì ứng dụng và bindings được sinh tự động cần dùng;
// test cần hành vi khác có thể ghi đè bằng `vi.mock('@wailsio/runtime', ...)` riêng.
vi.mock('@wailsio/runtime', () => {
  class CancelError extends Error {
    constructor(message?: string, options?: ErrorOptions) {
      super(message, options);
      this.name = 'CancelError';
    }
  }

  // Promise reject bằng CancelError khi bị hủy (đây là hành vi `callIPC` cần).
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

// Bộ test chạy song song khoảng 100 file; trên máy bận, timeout mặc định 1 giây của findBy*/waitFor quá ngắn.
// 2 giây là đủ: toàn bộ bộ test đã chạy liên tiếp 3 lần mà không timeout ngẫu nhiên (không cần đến 4 giây).
// Chỉ tăng giới hạn tối đa: truy vấn thành công vẫn trả kết quả ngay.
configure({ asyncUtilTimeout: 2000 });

// jsdom chưa có các API trình duyệt mà Mantine sử dụng.
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

// jsdom không có FontFaceSet; Textarea tự đổi kích thước của Mantine theo dõi API này.
Object.defineProperty(document, 'fonts', {
  configurable: true,
  value: { addEventListener() {}, removeEventListener() {} },
});

window.HTMLElement.prototype.scrollTo = vi.fn();
window.HTMLElement.prototype.scrollIntoView = vi.fn();

afterEach(() => {
  cleanup();
});
