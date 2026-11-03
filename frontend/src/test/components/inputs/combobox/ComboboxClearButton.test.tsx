import { createEvent, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ComboboxClearButton from '@/components/inputs/combobox/ComboboxClearButton';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

describe('ComboboxClearButton', () => {
  it('prevents default on mousedown so the target keeps focus', () => {
    renderWithProviders(<ComboboxClearButton onClear={vi.fn()} />);
    const button = screen.getByRole('button');

    const down = createEvent.mouseDown(button);
    fireEvent(button, down);

    expect(down.defaultPrevented).toBe(true);
  });

  it('stops propagation on click and calls onClear', () => {
    const onClear = vi.fn();
    const onParentClick = vi.fn();
    renderWithProviders(
      <div role="presentation" onClick={onParentClick}>
        <ComboboxClearButton onClear={onClear} />
      </div>
    );

    fireEvent.click(screen.getByRole('button'));

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onParentClick).not.toHaveBeenCalled();
  });
});
