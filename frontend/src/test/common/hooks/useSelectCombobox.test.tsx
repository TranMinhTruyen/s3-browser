import { MantineProvider } from '@mantine/core';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useSelectCombobox } from '@/common/hooks/useSelectCombobox';

const wrapper = ({ children }: { children: ReactNode }) => <MantineProvider>{children}</MantineProvider>;

describe('useSelectCombobox', () => {
  it('uncontrolled: starts from defaultValue, submit sets value, closes dropdown, and reports', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useSelectCombobox({ defaultValue: 'a', onChange }), { wrapper });
    expect(result.current.current).toBe('a');

    act(() => result.current.combobox.openDropdown());
    expect(result.current.combobox.dropdownOpened).toBe(true);

    act(() => result.current.onSubmitOption('b'));
    expect(result.current.current).toBe('b');
    expect(result.current.combobox.dropdownOpened).toBe(false);
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('defaults to null when neither value nor defaultValue is given', () => {
    const { result } = renderHook(() => useSelectCombobox({}), { wrapper });
    expect(result.current.current).toBeNull();

    act(() => result.current.onSubmitOption('x'));
    expect(result.current.current).toBe('x');
  });

  it('onClear sets the value to null', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useSelectCombobox({ defaultValue: 'a', onChange }), { wrapper });

    act(() => result.current.onClear());

    expect(result.current.current).toBeNull();
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('controlled: value follows props and is not changed internally', () => {
    const onChange = vi.fn();
    const { result, rerender } = renderHook(({ value }) => useSelectCombobox({ value, onChange }), {
      wrapper,
      initialProps: { value: 'a' as string | null },
    });

    act(() => result.current.onSubmitOption('b'));
    expect(onChange).toHaveBeenCalledWith('b');
    expect(result.current.current).toBe('a');

    rerender({ value: 'b' });
    expect(result.current.current).toBe('b');
  });

  it('onClickToggle toggles the dropdown', () => {
    const { result } = renderHook(() => useSelectCombobox({}), { wrapper });

    act(() => result.current.onClickToggle());
    expect(result.current.combobox.dropdownOpened).toBe(true);
    act(() => result.current.onClickToggle());
    expect(result.current.combobox.dropdownOpened).toBe(false);
  });

  it('opening by keyboard and by mouse both open the dropdown', () => {
    const { result } = renderHook(() => useSelectCombobox({}), { wrapper });

    act(() => result.current.combobox.openDropdown('keyboard'));
    expect(result.current.combobox.dropdownOpened).toBe(true);

    act(() => result.current.combobox.closeDropdown());
    expect(result.current.combobox.dropdownOpened).toBe(false);

    act(() => result.current.combobox.openDropdown('mouse'));
    expect(result.current.combobox.dropdownOpened).toBe(true);
  });

  it.each([
    ['keyboard', true],
    ['mouse', true],
    ['keyboard', false],
  ] as const)('opening by %s with focusSearch=%s', (source, focusSearch) => {
    const { result } = renderHook(() => useSelectCombobox({ focusSearch }), { wrapper });
    const spy = vi.spyOn(result.current.combobox, 'focusSearchInput');
    act(() => result.current.combobox.openDropdown(source));
    expect(spy).toHaveBeenCalledTimes(focusSearch ? 1 : 0);
  });

  it('calls onClose when the dropdown closes, not when it opens', () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useSelectCombobox({ onClose }), { wrapper });
    act(() => result.current.combobox.openDropdown());
    expect(onClose).not.toHaveBeenCalled();
    act(() => result.current.combobox.closeDropdown());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes without error when onClose is not given', () => {
    const { result } = renderHook(() => useSelectCombobox({}), { wrapper });
    act(() => result.current.combobox.openDropdown());
    act(() => result.current.combobox.closeDropdown());
    expect(result.current.combobox.dropdownOpened).toBe(false);
  });
});
