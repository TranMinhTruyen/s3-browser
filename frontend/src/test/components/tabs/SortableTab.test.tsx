import { Tabs } from '@mantine/core';
import { act, createEvent, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SortableTab from '@/components/tabs/SortableTab';
import { motionState } from '@/test/_helpers/mockMotion';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

const sortable = vi.hoisted(() => ({
  isDragging: false,
  transform: null as { x: number; y: number; scaleX: number; scaleY: number } | null,
  onPointerDown: undefined as undefined | (() => void),
  ids: [] as string[],
  disabled: [] as boolean[],
}));

const renderLabel = () => <span>tab label</span>;

vi.mock('motion/react', async () => (await import('@/test/_helpers/mockMotion')).motionMock);
vi.mock('@dnd-kit/sortable', () => ({
  useSortable: ({ id, disabled }: { id: string; disabled?: boolean }) => {
    sortable.ids.push(id);
    sortable.disabled.push(Boolean(disabled));
    return {
      attributes: {
        role: 'button',
        tabIndex: 0,
        'aria-pressed': false,
        'aria-describedby': 'DndDescribedBy-0',
        'aria-roledescription': 'sortable',
      },
      listeners: disabled ? undefined : { onPointerDown: () => sortable.onPointerDown?.() },
      setNodeRef: () => {},
      transform: sortable.transform,
      transition: 'transform 200ms',
      isDragging: sortable.isDragging,
    };
  },
}));
vi.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Translate: { toString: (t: { x: number; y: number } | null) => (t ? `translate3d(${t.x}px, ${t.y}px, 0)` : '') },
  },
}));

const renderTab = (closable: boolean, onClickClose = vi.fn(), isSortable = true, onMoveTab = vi.fn()) => {
  renderWithProviders(
    <Tabs value="t1">
      <Tabs.List>
        <SortableTab
          tabId="t1"
          renderLabel={renderLabel}
          closable={closable}
          sortable={isSortable}
          onClickClose={onClickClose}
          onMoveTab={onMoveTab}
        />
      </Tabs.List>
    </Tabs>
  );
  return onClickClose;
};

describe('SortableTab', () => {
  beforeEach(() => {
    sortable.isDragging = false;
    sortable.transform = null;
    sortable.onPointerDown = undefined;
    sortable.ids.length = 0;
    sortable.disabled.length = 0;
    motionState.reducedMotion = false;
    motionState.isPresent = true;
  });

  it('registers itself with dnd-kit using the tab id', () => {
    renderTab(true);
    expect(sortable.ids).toContain('t1');
  });

  it('keeps the tab role and only the aria hints from dnd-kit', () => {
    renderTab(true);
    const tab = screen.getByRole('tab');
    expect(tab).toHaveAttribute('role', 'tab');
    expect(tab).toHaveAttribute('aria-describedby', 'DndDescribedBy-0');
    expect(tab).toHaveAttribute('aria-roledescription', 'sortable');
    expect(tab).not.toHaveAttribute('aria-pressed');
    expect(tab).toHaveAttribute('title', 'Drag to reorder (Ctrl+Shift+←/→)');
    expect(tab).toHaveTextContent('tab label');
  });

  it('forwards dnd-kit listeners to the tab', async () => {
    const onPointerDown = vi.fn();
    sortable.onPointerDown = onPointerDown;
    renderTab(true);
    await userEvent.pointer({ keys: '[MouseLeft>]', target: screen.getByRole('tab') });
    expect(onPointerDown).toHaveBeenCalled();
  });

  it('is visible when not dragging', () => {
    renderTab(true);
    const wrapper = screen.getByRole('tab').parentElement!;
    expect(wrapper).toHaveAttribute('data-animate', '"visible"');
    expect(wrapper.parentElement!.style.visibility).toBe('');
  });

  it('only holds its slot while dragging (hidden, no lift) and follows the dnd-kit transform', () => {
    sortable.isDragging = true;
    sortable.transform = { x: 12, y: 0, scaleX: 1, scaleY: 1 };
    renderTab(true);
    const wrapper = screen.getByRole('tab', { hidden: true }).parentElement!;
    expect(wrapper).toHaveAttribute('data-animate', '"visible"');
    expect(wrapper.style.boxShadow).not.toBe('var(--mantine-shadow-md)');
    expect(wrapper.parentElement!.style.visibility).toBe('hidden');
    expect(wrapper.parentElement!.style.zIndex).toBe('');
    expect(wrapper.parentElement!.style.transform).toBe('translate3d(12px, 0px, 0px)');
    expect(wrapper.parentElement!.style.transition).toBe('transform 200ms');
  });

  it('shows the close button and passes tab id and event when clicked', async () => {
    const onClickClose = renderTab(true);
    await userEvent.click(screen.getByRole('button', { name: 'Close tab' }));
    expect(onClickClose).toHaveBeenCalledTimes(1);
    expect(onClickClose.mock.calls[0][0]).toBe('t1');
    expect(onClickClose.mock.calls[0][1]).toHaveProperty('type', 'click');
  });

  it('hides the close button when not closable', () => {
    renderTab(false);
    expect(screen.queryByRole('button', { name: 'Close tab' })).not.toBeInTheDocument();
  });

  describe('sortable', () => {
    it('enables dnd-kit, the grab cursor, hint title, listeners and aria when sortable', async () => {
      const onPointerDown = vi.fn();
      sortable.onPointerDown = onPointerDown;
      renderTab(true, vi.fn(), true);
      const tab = screen.getByRole('tab');
      expect(sortable.disabled.every(d => !d)).toBe(true);
      expect(tab).toHaveAttribute('title', 'Drag to reorder (Ctrl+Shift+←/→)');
      expect(tab).toHaveAttribute('aria-roledescription', 'sortable');
      expect(tab).toHaveAttribute('aria-describedby', 'DndDescribedBy-0');
      expect(tab.style.cursor).toBe('grab');
      await userEvent.pointer({ keys: '[MouseLeft>]', target: tab });
      expect(onPointerDown).toHaveBeenCalled();
    });

    it('disables dnd-kit and drops title, cursor, listeners and aria when not sortable', async () => {
      const onPointerDown = vi.fn();
      sortable.onPointerDown = onPointerDown;
      renderTab(false, vi.fn(), false);
      const tab = screen.getByRole('tab');
      expect(sortable.disabled.every(Boolean)).toBe(true);
      expect(tab).not.toHaveAttribute('title');
      expect(tab).not.toHaveAttribute('aria-roledescription');
      expect(tab).not.toHaveAttribute('aria-describedby');
      expect(tab.style.cursor).not.toBe('grab');
      expect(tab.style.touchAction).not.toBe('none');
      await userEvent.pointer({ keys: '[MouseLeft>]', target: tab });
      expect(onPointerDown).not.toHaveBeenCalled();
    });
  });

  describe('keyboard reorder', () => {
    const focusTab = async () => {
      const tab = screen.getByRole('tab');
      await userEvent.click(tab);
      return tab;
    };

    it.each([
      ['ArrowLeft', -1],
      ['ArrowRight', 1],
    ] as const)('Ctrl+Shift+%s calls onMoveTab with %i and keeps focus on the tab', async (key, offset) => {
      const onMoveTab = vi.fn();
      renderTab(true, vi.fn(), true, onMoveTab);
      const tab = await focusTab();
      await userEvent.keyboard(`{Control>}{Shift>}{${key}}{/Shift}{/Control}`);
      expect(onMoveTab).toHaveBeenCalledTimes(1);
      expect(onMoveTab).toHaveBeenCalledWith('t1', offset);
      await act(async () => {
        await Promise.resolve();
      });
      expect(tab).toHaveFocus();
    });

    it('prevents the default action and stops propagation', () => {
      renderTab(true);
      const tab = screen.getByRole('tab');
      const event = createEvent.keyDown(tab, { key: 'ArrowRight', ctrlKey: true, shiftKey: true });
      const stop = vi.spyOn(event, 'stopPropagation');
      fireEvent(tab, event);
      expect(event.defaultPrevented).toBe(true);
      expect(stop).toHaveBeenCalled();
    });

    it('restores focus after the tab loses it in the same microtask turn', async () => {
      renderTab(true);
      const tab = await focusTab();
      fireEvent.keyDown(tab, { key: 'ArrowLeft', ctrlKey: true, shiftKey: true });
      tab.blur();
      await act(async () => {
        await Promise.resolve();
      });
      expect(tab).toHaveFocus();
    });

    it.each([
      ['without Ctrl', { key: 'ArrowLeft', shiftKey: true }],
      ['without Shift', { key: 'ArrowLeft', ctrlKey: true }],
      ['with another key', { key: 'ArrowUp', ctrlKey: true, shiftKey: true }],
    ])('does nothing %s', (_name, init) => {
      const onMoveTab = vi.fn();
      renderTab(true, vi.fn(), true, onMoveTab);
      const tab = screen.getByRole('tab');
      const event = createEvent.keyDown(tab, init);
      fireEvent(tab, event);
      expect(onMoveTab).not.toHaveBeenCalled();
    });

    it('does nothing when not sortable', () => {
      const onMoveTab = vi.fn();
      renderTab(false, vi.fn(), false, onMoveTab);
      fireEvent.keyDown(screen.getByRole('tab'), { key: 'ArrowLeft', ctrlKey: true, shiftKey: true });
      expect(onMoveTab).not.toHaveBeenCalled();
    });

    describe('inside real Mantine Tabs (neighbour activation must not leak)', () => {
      const renderTabs = (isSortable = true) => {
        const onChange = vi.fn();
        const onMoveTab = vi.fn();
        renderWithProviders(
          <Tabs value="t2" onChange={onChange}>
            <Tabs.List>
              {['t1', 't2', 't3'].map(id => (
                <SortableTab
                  key={id}
                  tabId={id}
                  renderLabel={renderLabel}
                  closable
                  sortable={isSortable}
                  onClickClose={vi.fn()}
                  onMoveTab={onMoveTab}
                />
              ))}
            </Tabs.List>
          </Tabs>
        );
        return { onChange, onMoveTab, tabs: screen.getAllByRole('tab') };
      };

      it.each([
        ['ArrowLeft', 0, -1],
        ['ArrowRight', 2, 1],
      ] as const)('Ctrl+Shift+%s moves the tab without selecting the neighbour', async (key, neighbour, offset) => {
        const { onChange, onMoveTab, tabs } = renderTabs();
        tabs[1].focus();
        await userEvent.keyboard(`{Control>}{Shift>}{${key}}{/Shift}{/Control}`);
        expect(onMoveTab).toHaveBeenCalledWith('t2', offset);
        expect(onChange).not.toHaveBeenCalled();
        expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
        expect(tabs[neighbour]).toHaveAttribute('aria-selected', 'false');
        expect(tabs[1]).toHaveFocus();
      });

      it.each([
        ['first tab, Ctrl+Shift+ArrowLeft', 0, 'ArrowLeft'],
        ['last tab, Ctrl+Shift+ArrowRight', 2, 'ArrowRight'],
      ] as const)('%s does not wrap around or select another tab', async (_name, index, key) => {
        const { onChange, tabs } = renderTabs();
        tabs[index].focus();
        await userEvent.keyboard(`{Control>}{Shift>}{${key}}{/Shift}{/Control}`);
        expect(onChange).not.toHaveBeenCalled();
        expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
        expect(tabs[index]).toHaveFocus();
      });

      it.each([
        ['Ctrl only', '{Control>}{ArrowRight}{/Control}'],
        ['Shift only', '{Shift>}{ArrowRight}{/Shift}'],
      ])('%s leaves the arrow key to Mantine (focus + select the neighbour)', async (_name, keys) => {
        const { onChange, onMoveTab, tabs } = renderTabs();
        tabs[1].focus();
        await userEvent.keyboard(keys);
        expect(onMoveTab).not.toHaveBeenCalled();
        expect(onChange).toHaveBeenCalledTimes(1);
      });

      it('a plain arrow key still lets Mantine move to the neighbour tab', async () => {
        const { onChange, onMoveTab, tabs } = renderTabs();
        tabs[1].focus();
        await userEvent.keyboard('{ArrowRight}');
        expect(onMoveTab).not.toHaveBeenCalled();
        expect(onChange).toHaveBeenCalledTimes(1);
      });

      it('not sortable: Ctrl+Shift+Arrow is not handled (no move, no preventDefault)', () => {
        const { onMoveTab, tabs } = renderTabs(false);
        const event = createEvent.keyDown(tabs[1], { key: 'ArrowRight', ctrlKey: true, shiftKey: true });
        fireEvent(tabs[1], event);
        expect(onMoveTab).not.toHaveBeenCalled();
      });
    });

    it.each([' ', 'Enter'])('still selects the tab with %j', async key => {
      renderTab(true);
      const tab = await focusTab();
      sortable.onPointerDown = undefined;
      await userEvent.keyboard(key === ' ' ? ' ' : '{Enter}');
      expect(tab).toHaveAttribute('aria-selected', 'true');
    });
  });

  describe('exit animation', () => {
    it('collapses on exit by default', () => {
      renderTab(true);
      expect(screen.getByRole('tab').parentElement).toHaveAttribute('data-exit', 'collapse');
    });

    it('has no data-exiting while the tab is present', () => {
      renderTab(true);
      expect(screen.getByRole('tab')).not.toHaveAttribute('data-exiting');
    });

    it('sets data-exiting on the tab while it plays its exit animation', () => {
      motionState.isPresent = false;
      renderTab(true);
      expect(screen.getByRole('tab')).toHaveAttribute('data-exiting');
    });

    it('only fades (hidden) on exit when the user prefers reduced motion', () => {
      motionState.reducedMotion = true;
      renderTab(true);
      expect(screen.getByRole('tab').parentElement).toHaveAttribute('data-exit', 'hidden');
    });
  });
});
