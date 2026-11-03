import { act, renderHook } from '@testing-library/react';
import type { MouseEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useAutoLoading } from '@/common/hooks/useAutoLoading';

// The tsconfig has no Node types; unhandled rejections can only be observed through Node's process.
const nodeGlobals = globalThis as unknown as {
  process: {
    on: (name: 'unhandledRejection', fn: (reason: unknown) => void) => void;
    off: (name: 'unhandledRejection', fn: (reason: unknown) => void) => void;
  };
  setImmediate: (fn: (value?: unknown) => void) => void;
};
const event = {} as MouseEvent<HTMLButtonElement>;

describe('useAutoLoading', () => {
  it('turns loading on while a returned Promise is pending and off when it resolves', async () => {
    let resolve!: () => void;
    const onClick = vi.fn(() => new Promise<void>(r => (resolve = r)));
    const { result } = renderHook(() => useAutoLoading(onClick, undefined));
    expect(result.current.isLoading).toBe(false);

    act(() => result.current.onClickButton(event));
    expect(onClick).toHaveBeenCalledWith(event);
    expect(result.current.isLoading).toBe(true);

    await act(async () => resolve());
    expect(result.current.isLoading).toBe(false);
  });

  it('turns loading off when the Promise rejects without an unhandled rejection', async () => {
    const unhandled = vi.fn();
    nodeGlobals.process.on('unhandledRejection', unhandled);
    try {
      let reject!: (e: Error) => void;
      const pending = new Promise<void>((_, r) => (reject = r));
      // The caller owns the rejection of its own promise and still receives the original error.
      const callerResult = expect(pending).rejects.toThrow('boom');
      const onClick = vi.fn(() => pending);
      const { result } = renderHook(() => useAutoLoading(onClick, undefined));

      act(() => result.current.onClickButton(event));
      expect(result.current.isLoading).toBe(true);

      await act(async () => reject(new Error('boom')));
      // Let Node run its unhandled-rejection check (it runs after the microtask queue drains).
      await new Promise(r => nodeGlobals.setImmediate(r));
      await callerResult;

      expect(result.current.isLoading).toBe(false);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      nodeGlobals.process.off('unhandledRejection', unhandled);
    }
  });

  it('ignores synchronous handlers', () => {
    const onClick = vi.fn(() => 1);
    const { result } = renderHook(() => useAutoLoading(onClick, undefined));

    act(() => result.current.onClickButton(event));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(result.current.isLoading).toBe(false);
  });

  it('does nothing when onClick is undefined', () => {
    const { result } = renderHook(() => useAutoLoading(undefined, undefined));

    act(() => result.current.onClickButton(event));
    expect(result.current.isLoading).toBe(false);
  });

  it.each([true, false])('explicit loading=%s wins over the auto state', async explicit => {
    let resolve!: () => void;
    const onClick = vi.fn(() => new Promise<void>(r => (resolve = r)));
    const { result } = renderHook(() => useAutoLoading(onClick, explicit));

    act(() => result.current.onClickButton(event));
    expect(result.current.isLoading).toBe(explicit);
    await act(async () => resolve());
    expect(result.current.isLoading).toBe(explicit);
  });
});
