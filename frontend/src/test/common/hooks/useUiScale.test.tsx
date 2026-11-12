import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type UiSizeKey } from '@/common/cnst/settingConst';
import { useRemeasureOnScale, useUiScale } from '@/common/hooks/useUiScale';
import { useSettingStore } from '@/common/stores/settingStore';

const setSize = (size: UiSizeKey) => act(() => useSettingStore.setState(s => ({ draft: { ...s.draft, size } })));

describe('useUiScale', () => {
  beforeEach(() => {
    useSettingStore.setState({ draft: { ...DEFAULT_SETTINGS } });
  });

  it.each([
    ['small', 0.875],
    ['medium', 1],
    ['large', 1.125],
  ] as const)('returns the scale of the %s size', (size, scale) => {
    useSettingStore.setState({ draft: { ...DEFAULT_SETTINGS, size } });
    expect(renderHook(() => useUiScale()).result.current).toBe(scale);
  });

  it('follows the draft size', () => {
    const { result } = renderHook(() => useUiScale());
    expect(result.current).toBe(1);
    setSize('large');
    expect(result.current).toBe(1.125);
    setSize('small');
    expect(result.current).toBe(0.875);
  });

  it('does not render again when another setting changes', () => {
    let renders = 0;
    renderHook(() => {
      renders++;
      return useUiScale();
    });
    const before = renders;
    act(() => useSettingStore.setState(s => ({ draft: { ...s.draft, theme: 'dark' } })));
    expect(renders).toBe(before);
  });
});

describe('useRemeasureOnScale', () => {
  it('skips the mount and measures once for each scale change', () => {
    const virtualizer = { measure: vi.fn() };
    const { rerender } = renderHook(({ scale }) => useRemeasureOnScale(virtualizer, scale), {
      initialProps: { scale: 1 },
    });
    expect(virtualizer.measure).not.toHaveBeenCalled();

    rerender({ scale: 1 });
    expect(virtualizer.measure).not.toHaveBeenCalled();

    rerender({ scale: 1.125 });
    expect(virtualizer.measure).toHaveBeenCalledTimes(1);

    rerender({ scale: 1.125 });
    expect(virtualizer.measure).toHaveBeenCalledTimes(1);

    rerender({ scale: 0.875 });
    expect(virtualizer.measure).toHaveBeenCalledTimes(2);
  });

  it('does not measure when only the virtualizer instance changes', () => {
    const first = { measure: vi.fn() };
    const second = { measure: vi.fn() };
    const { rerender } = renderHook(({ v }) => useRemeasureOnScale(v, 1), { initialProps: { v: first } });
    rerender({ v: second });
    expect(first.measure).not.toHaveBeenCalled();
    expect(second.measure).not.toHaveBeenCalled();
  });
});
