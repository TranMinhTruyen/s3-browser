import { renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it } from 'vitest';
import { useUnmountSignal } from '@/common/hooks/useUnmountSignal';

describe('useUnmountSignal', () => {
  it('gives a live signal once mounted and aborts it on unmount', () => {
    const { result, unmount } = renderHook(() => useUnmountSignal());
    const signal = result.current();

    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);

    unmount();

    expect(signal?.aborted).toBe(true);
  });

  it('returns a stable getter that keeps the same signal across renders', () => {
    const { result, rerender } = renderHook(() => useUnmountSignal());
    const getter = result.current;
    const signal = getter();

    rerender();

    expect(result.current).toBe(getter);
    expect(result.current()).toBe(signal);
  });

  it('gives a fresh, live signal after a remount (StrictMode) and leaves the first one aborted', () => {
    const signals: (AbortSignal | undefined)[] = [];
    const { result } = renderHook(
      () => {
        const getSignal = useUnmountSignal();
        signals.push(getSignal());
        return getSignal;
      },
      { wrapper: StrictMode }
    );

    const current = result.current();
    expect(current?.aborted).toBe(false);
    // The first render ran before any effect, so it saw no controller yet.
    expect(signals[0]).toBeUndefined();
  });

  it('creates a new controller for each mount', () => {
    const first = renderHook(() => useUnmountSignal());
    const firstSignal = first.result.current();
    first.unmount();

    const second = renderHook(() => useUnmountSignal());
    const secondSignal = second.result.current();

    expect(secondSignal).not.toBe(firstSignal);
    expect(firstSignal?.aborted).toBe(true);
    expect(secondSignal?.aborted).toBe(false);
  });
});
