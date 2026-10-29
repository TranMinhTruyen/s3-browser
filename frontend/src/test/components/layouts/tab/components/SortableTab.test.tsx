import { Tabs } from '@mantine/core';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SortableTab from '@/components/layouts/tab/components/SortableTab';
import { renderWithProviders } from '@/test/renderWithProviders';

const sortable = vi.hoisted(() => ({
  isDragging: false,
  transform: null as { x: number; y: number; scaleX: number; scaleY: number } | null,
  onPointerDown: undefined as undefined | (() => void),
  ids: [] as string[],
}));

vi.mock('motion/react', async () => (await import('@/test/_helpers/mockMotion')).motionMock);
vi.mock('@dnd-kit/sortable', () => ({
  useSortable: ({ id }: { id: string }) => {
    sortable.ids.push(id);
    return {
      attributes: {
        role: 'button',
        tabIndex: 0,
        'aria-pressed': false,
        'aria-describedby': 'DndDescribedBy-0',
        'aria-roledescription': 'sortable',
      },
      listeners: { onPointerDown: () => sortable.onPointerDown?.() },
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
vi.mock('@/components/layouts/tab/components/TabLabel', () => ({ default: () => <span>tab label</span> }));

const renderTab = (closable: boolean, onClickClose = vi.fn()) => {
  renderWithProviders(
    <Tabs value="t1">
      <Tabs.List>
        <SortableTab tabId="t1" closable={closable} onClickClose={onClickClose} />
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
    expect(tab).toHaveAttribute('title', 'Drag to reorder');
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
    expect(wrapper.parentElement!.style.transform).toBe('translate3d(12px, 0px, 0)');
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
});
