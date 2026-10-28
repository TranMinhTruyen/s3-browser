import { act, renderHook } from '@testing-library/react';
import type { MouseEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useAutoLoading } from '@/components/buttons/useAutoLoading';

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

  it('turns loading off when the Promise rejects', async () => {
    let reject!: (e: Error) => void;
    const pending = new Promise<void>((_, r) => (reject = r));
    // The hook does not handle rejections itself: catch the derived finally() promise so the run stays clean.
    const originalFinally = pending.finally.bind(pending);
    pending.finally = (cb?: (() => void) | null) => {
      const derived = originalFinally(cb);
      derived.catch(() => {});
      return derived;
    };
    const onClick = vi.fn(() => pending);
    const { result } = renderHook(() => useAutoLoading(onClick, undefined));

    act(() => result.current.onClickButton(event));
    expect(result.current.isLoading).toBe(true);

    await act(async () => reject(new Error('boom')));

    expect(result.current.isLoading).toBe(false);
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
