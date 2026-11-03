import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { memo, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTabListStore } from '@/common/stores/tabListStore';
import TabLayout from '@/components/layouts/tab/TabLayout';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

const detailRenders = vi.hoisted(() => {
  const state = { count: 0, created: 0, bump: () => void (state.count += 1) };
  return state;
});
const dnd = vi.hoisted(() => ({
  props: {} as Record<string, any>,
  overlayProps: {} as Record<string, any>,
  sortableProps: {} as Record<string, any>,
  sensors: [] as any[],
}));

// Like the real TabDetail, the mock is memoized.
vi.mock('@/components/layouts/tab/components/TabDetail', () => ({
  default: memo(({ tabId }: { tabId: string }) => {
    detailRenders.bump();
    // Local state: proves a hidden tab keeps its instance instead of being mounted again.
    const [instance] = useState(() => detailRenders.created++);
    return (
      <div data-testid={`detail-${tabId}`} data-instance={instance}>
        tab detail
      </div>
    );
  }),
}));
vi.mock('@/components/layouts/tab/components/TabDragPreview', () => ({
  default: ({ tabId, closable }: any) => <div data-testid="preview">{`${tabId}:${closable}`}</div>,
}));
vi.mock('@/components/layouts/tab/components/TabLabel', () => ({ default: () => <span>tab label</span> }));
vi.mock('motion/react', async () => (await import('@/test/_helpers/mockMotion')).motionMock);
vi.mock('@dnd-kit/core', () => {
  class PointerSensor {}
  return {
    PointerSensor,
    closestCenter: () => [],
    useSensor: (sensor: unknown, options: unknown) => ({ sensor, options }),
    useSensors: (...sensors: unknown[]) => {
      dnd.sensors = sensors;
      return sensors;
    },
    DndContext: ({ children, ...props }: any) => {
      dnd.props = props;
      return <>{children}</>;
    },
    DragOverlay: ({ children, ...props }: any) => {
      dnd.overlayProps = props;
      return <div data-testid="overlay">{children}</div>;
    },
  };
});
vi.mock('@dnd-kit/sortable', () => ({
  horizontalListSortingStrategy: 'horizontal',
  SortableContext: ({ children, ...props }: any) => {
    dnd.sortableProps = props;
    return <>{children}</>;
  },
  useSortable: () => ({
    attributes: { role: 'button', tabIndex: 0, 'aria-describedby': 'x' },
    listeners: {},
    setNodeRef: () => {},
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}));
vi.mock('@dnd-kit/modifiers', () => ({ restrictToHorizontalAxis: 'h', restrictToFirstScrollableAncestor: 's' }));
vi.mock('@dnd-kit/utilities', () => ({ CSS: { Translate: { toString: () => '' } } }));

const tabIds = () => Object.keys(useTabListStore.getState().tabList);
const scrollIntoView = () => vi.mocked(window.HTMLElement.prototype.scrollIntoView);

describe('TabLayout', () => {
  beforeEach(() => {
    useTabListStore.getState().reset();
    detailRenders.count = 0;
    detailRenders.created = 0;
  });

  it('adds a tab from the add button and closes it again', async () => {
    renderWithProviders(<TabLayout />);
    expect(screen.queryByRole('button', { name: 'Close tab' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Add tab' }));
    expect(tabIds()).toHaveLength(2);

    await userEvent.click(screen.getAllByRole('button', { name: 'Close tab' })[0]);
    expect(tabIds()).toHaveLength(1);
  });

  it('scrolls the active tab into view when tabs change', async () => {
    renderWithProviders(<TabLayout />);
    scrollIntoView().mockClear();

    await userEvent.click(screen.getByRole('button', { name: 'Add tab' }));

    expect(scrollIntoView()).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
  });

  it('shows the detail of every tab and switches the active tab on click', async () => {
    renderWithProviders(<TabLayout />);
    await userEvent.click(screen.getByRole('button', { name: 'Add tab' }));
    const [first] = tabIds();

    await userEvent.click(screen.getAllByRole('tab')[0]);

    expect(useTabListStore.getState().activeTab).toBe(first);
    expect(screen.getAllByText('tab detail')).toHaveLength(2);
  });

  it('does not re-render the tab details when only the active tab changes', async () => {
    renderWithProviders(<TabLayout />);
    await userEvent.click(screen.getByRole('button', { name: 'Add tab' }));
    const rendersBefore = detailRenders.count;

    await userEvent.click(screen.getAllByRole('tab')[0]);

    expect(detailRenders.count).toBe(rendersBefore);
  });

  describe('single versus multiple tabs', () => {
    it('with one tab: not closable, not sortable, no drag hint', () => {
      renderWithProviders(<TabLayout />);
      expect(screen.queryByRole('button', { name: 'Close tab' })).not.toBeInTheDocument();
      expect(screen.getByRole('tab')).not.toHaveAttribute('title');
      expect(screen.getByRole('tab')).not.toHaveAttribute('aria-describedby');
    });

    it('with several tabs: closable and sortable with drag hint', async () => {
      renderWithProviders(<TabLayout />);
      await userEvent.click(screen.getByRole('button', { name: 'Add tab' }));
      expect(screen.getAllByRole('button', { name: 'Close tab' })).toHaveLength(2);
      for (const tab of screen.getAllByRole('tab')) {
        expect(tab).toHaveAttribute('title', 'Drag to reorder (Ctrl+Shift+←/→)');
        expect(tab).toHaveAttribute('aria-describedby', 'x');
      }
    });

    it('goes back to non-sortable after closing down to one tab', async () => {
      renderWithProviders(<TabLayout />);
      await userEvent.click(screen.getByRole('button', { name: 'Add tab' }));
      await userEvent.click(screen.getAllByRole('button', { name: 'Close tab' })[0]);
      expect(screen.getByRole('tab')).not.toHaveAttribute('title');
      expect(screen.queryByRole('button', { name: 'Close tab' })).not.toBeInTheDocument();
    });
  });

  describe('drag and drop', () => {
    it('configures sortable items, sensors and modifiers', async () => {
      renderWithProviders(<TabLayout />);
      await userEvent.click(screen.getByRole('button', { name: 'Add tab' }));

      expect(dnd.sortableProps.items).toEqual(tabIds());
      expect(dnd.sortableProps.strategy).toBe('horizontal');
      expect(dnd.props.modifiers).toBeUndefined();
      expect(dnd.props.accessibility).toEqual({
        screenReaderInstructions: { draggable: 'Drag to reorder (Ctrl+Shift+←/→)' },
      });
      expect(dnd.overlayProps.modifiers).toEqual(['h', 's']);
      expect(dnd.overlayProps.dropAnimation).toBeNull();
      expect(dnd.sensors[0].options).toEqual({ activationConstraint: { distance: 5 } });
      expect(dnd.sensors).toHaveLength(1);
      expect(screen.getAllByRole('tab')).toHaveLength(2);
    });

    it('moves the dragged tab to the position of the tab it is dropped on, keeping the active tab', async () => {
      renderWithProviders(<TabLayout />);
      await userEvent.click(screen.getByRole('button', { name: 'Add tab' }));
      await userEvent.click(screen.getByRole('button', { name: 'Add tab' }));
      const [a, b, c] = tabIds();
      expect(useTabListStore.getState().activeTab).toBe(c);

      act(() => {
        dnd.props.onDragStart({ active: { id: a } });
        dnd.props.onDragEnd({ active: { id: a }, over: { id: c } });
      });

      expect(tabIds()).toEqual([b, c, a]);
      expect(useTabListStore.getState().activeTab).toBe(c);
    });

    it('does nothing when dropped outside any tab', async () => {
      renderWithProviders(<TabLayout />);
      await userEvent.click(screen.getByRole('button', { name: 'Add tab' }));
      const before = tabIds();

      act(() => {
        dnd.props.onDragStart({ active: { id: before[0] } });
        dnd.props.onDragEnd({ active: { id: before[0] }, over: null });
      });

      expect(tabIds()).toEqual(before);
    });

    it('skips scrolling into view while dragging and resumes after drag end', () => {
      renderWithProviders(<TabLayout />);
      act(() => dnd.props.onDragStart({ active: { id: tabIds()[0] } }));
      scrollIntoView().mockClear();

      act(() => useTabListStore.getState().addTab());
      expect(scrollIntoView()).not.toHaveBeenCalled();

      act(() => dnd.props.onDragEnd({ active: { id: tabIds()[0] }, over: null }));
      act(() => useTabListStore.getState().addTab());
      expect(scrollIntoView()).toHaveBeenCalled();
    });

    it('renders the drag preview in the overlay (portal to body) only while dragging', () => {
      renderWithProviders(<TabLayout />);
      const [a] = tabIds();
      expect(screen.getByTestId('overlay').parentElement).toBe(document.body);
      expect(screen.queryByTestId('preview')).not.toBeInTheDocument();

      act(() => dnd.props.onDragStart({ active: { id: a } }));
      expect(screen.getByTestId('preview')).toHaveTextContent(`${a}:false`);

      act(() => dnd.props.onDragEnd({ active: { id: a }, over: null }));
      expect(screen.queryByTestId('preview')).not.toBeInTheDocument();
    });

    it('passes closable to the preview when there are several tabs', async () => {
      renderWithProviders(<TabLayout />);
      await userEvent.click(screen.getByRole('button', { name: 'Add tab' }));
      const [a] = tabIds();
      act(() => dnd.props.onDragStart({ active: { id: a } }));
      expect(screen.getByTestId('preview')).toHaveTextContent(`${a}:true`);
    });

    it('clears the preview when the drag is cancelled', () => {
      renderWithProviders(<TabLayout />);
      act(() => dnd.props.onDragStart({ active: { id: tabIds()[0] } }));
      expect(screen.getByTestId('preview')).toBeInTheDocument();
      act(() => dnd.props.onDragCancel());
      expect(screen.queryByTestId('preview')).not.toBeInTheDocument();
    });

    describe('keyboard reorder (Ctrl+Shift+Left/Right)', () => {
      const pressMove = async (tab: HTMLElement, key: 'ArrowLeft' | 'ArrowRight') => {
        await userEvent.click(tab);
        await userEvent.keyboard(`{Control>}{Shift>}{${key}}{/Shift}{/Control}`);
      };

      const selected = () => screen.getAllByRole('tab').map(tab => tab.getAttribute('aria-selected'));

      it('swaps a middle tab with its neighbour, keeping it active and focused', async () => {
        renderWithProviders(<TabLayout />);
        await userEvent.click(screen.getByRole('button', { name: 'Add tab' }));
        await userEvent.click(screen.getByRole('button', { name: 'Add tab' }));
        const [a, b, c] = tabIds();

        const moved = screen.getAllByRole('tab')[1];
        await pressMove(moved, 'ArrowLeft');
        expect(tabIds()).toEqual([b, a, c]);
        expect(useTabListStore.getState().activeTab).toBe(b);
        expect(selected()).toEqual(['true', 'false', 'false']);
        expect(screen.getAllByRole('tab')[0]).toHaveFocus();

        await pressMove(screen.getAllByRole('tab')[0], 'ArrowRight');
        expect(tabIds()).toEqual([a, b, c]);
        expect(useTabListStore.getState().activeTab).toBe(b);
        expect(selected()).toEqual(['false', 'true', 'false']);
        expect(screen.getAllByRole('tab')[1]).toHaveFocus();
      });

      it('does not wrap around for the first tab moving left or the last tab moving right', async () => {
        renderWithProviders(<TabLayout />);
        await userEvent.click(screen.getByRole('button', { name: 'Add tab' }));
        const before = tabIds();

        await pressMove(screen.getAllByRole('tab')[0], 'ArrowLeft');
        expect(tabIds()).toEqual(before);
        expect(useTabListStore.getState().activeTab).toBe(before[0]);
        expect(selected()).toEqual(['true', 'false']);

        await pressMove(screen.getAllByRole('tab')[1], 'ArrowRight');
        expect(tabIds()).toEqual(before);
        expect(useTabListStore.getState().activeTab).toBe(before[1]);
        expect(selected()).toEqual(['false', 'true']);
      });

      it.each([
        ['Ctrl only', '{Control>}{ArrowLeft}{/Control}'],
        ['Shift only', '{Shift>}{ArrowLeft}{/Shift}'],
        ['plain arrow', '{ArrowLeft}'],
      ])('%s keeps the order and lets Mantine switch to the neighbour tab', async (_name, keys) => {
        renderWithProviders(<TabLayout />);
        await userEvent.click(screen.getByRole('button', { name: 'Add tab' }));
        const before = tabIds();

        await userEvent.click(screen.getAllByRole('tab')[1]);
        await userEvent.keyboard(keys);

        expect(tabIds()).toEqual(before);
        expect(useTabListStore.getState().activeTab).toBe(before[0]);
      });
    });

    describe('collisionDetection', () => {
      const rect = (left: number, width = 100) => ({ left, right: left + width, width });
      const detect = (
        collisionRect: { left: number; right: number },
        rects: Record<string, ReturnType<typeof rect>>,
        activeId = 'a'
      ) =>
        dnd.props.collisionDetection({
          active: { id: activeId },
          collisionRect,
          droppableRects: new Map(Object.entries(rects)),
          droppableContainers: Object.keys({ ...rects, ghost: 0 }).map(id => ({ id })),
        });

      it('picks the slot covered at least 90%', () => {
        renderWithProviders(<TabLayout />);
        act(() => dnd.props.onDragStart({ active: { id: 'a' } }));

        expect(detect({ left: 5, right: 105 }, { a: rect(0), b: rect(100) })).toEqual([{ id: 'a' }]);
        expect(detect({ left: 95, right: 195 }, { a: rect(0), b: rect(100) })).toEqual([{ id: 'b' }]);
      });

      it('picks the slot with the highest ratio when several reach the threshold', () => {
        renderWithProviders(<TabLayout />);
        // x covers 90% of slot a and 100% of slot b (and c is not covered at all).
        const result = detect({ left: 10, right: 110 }, { a: rect(0), b: rect(10, 100), c: rect(500) });
        expect(result).toEqual([{ id: 'b' }]);
        // A later slot with a lower ratio does not replace the best one.
        expect(detect({ left: 10, right: 110 }, { b: rect(10, 100), a: rect(0) })).toEqual([{ id: 'b' }]);
      });

      it('keeps the previous over when no slot reaches the threshold', () => {
        renderWithProviders(<TabLayout />);
        act(() => dnd.props.onDragStart({ active: { id: 'a' } }));
        detect({ left: 100, right: 200 }, { a: rect(0), b: rect(100) });

        expect(detect({ left: 50, right: 150 }, { a: rect(0), b: rect(100) })).toEqual([{ id: 'b' }]);
      });

      it('falls back to the active id when there is no previous over', () => {
        renderWithProviders(<TabLayout />);
        expect(detect({ left: 1000, right: 1100 }, { b: rect(100) }, 'z')).toEqual([{ id: 'z' }]);
      });

      it('forgets the previous over after the drag ends', () => {
        renderWithProviders(<TabLayout />);
        act(() => dnd.props.onDragStart({ active: { id: 'a' } }));
        detect({ left: 100, right: 200 }, { b: rect(100) });
        act(() => dnd.props.onDragEnd({ active: { id: 'a' }, over: null }));

        expect(detect({ left: 1000, right: 1100 }, { b: rect(100) }, 'z')).toEqual([{ id: 'z' }]);
      });
    });

    it('renders the tabs inside the custom scroller viewport, which is not draggable', () => {
      const { container } = renderWithProviders(<TabLayout />);
      expect(container.querySelector('.mantine-Scroller-container')).not.toBeInTheDocument();
      expect(container.querySelector('[data-draggable]')).not.toBeInTheDocument();
      expect(screen.getByRole('tab').closest('div[style*="overflow-x"]')).toBeInTheDocument();
    });

    it('scrolls the element marked data-active (inside the scroller) into view', () => {
      const { container } = renderWithProviders(<TabLayout />);
      scrollIntoView().mockClear();
      act(() => useTabListStore.getState().addTab());

      const target = container.querySelector('[data-active]') as HTMLElement;
      expect(scrollIntoView().mock.contexts).toContain(target);
    });

    it('scrolls the real active tab, not a tab that is still exiting', () => {
      const { container } = renderWithProviders(<TabLayout />);
      const viewport = screen.getByRole('tab').closest('div[style*="overflow-x"]')!;
      // A closing tab stays in the DOM (data-active, data-exiting) before the real active tab.
      const ghost = screen.getByRole('tab').cloneNode(true) as HTMLElement;
      ghost.setAttribute('data-exiting', '');
      viewport.prepend(ghost);
      scrollIntoView().mockClear();

      act(() => useTabListStore.getState().addTab());

      const real = container.querySelector('[data-active]:not([data-exiting])');
      expect(real).not.toBe(ghost);
      expect(scrollIntoView().mock.contexts).toContain(real);
      expect(scrollIntoView().mock.contexts).not.toContain(ghost);
    });

    it('resumes scrolling into view after a cancelled drag', () => {
      renderWithProviders(<TabLayout />);
      act(() => dnd.props.onDragStart({ active: { id: tabIds()[0] } }));
      act(() => dnd.props.onDragCancel());
      scrollIntoView().mockClear();

      act(() => useTabListStore.getState().addTab());

      expect(scrollIntoView()).toHaveBeenCalled();
    });
  });

  describe('lazy mounting of tab details', () => {
    it('mounts a tab detail only after the tab has been active, then keeps it mounted', async () => {
      renderWithProviders(<TabLayout />);
      expect(screen.getAllByText('tab detail')).toHaveLength(1);

      // Adding a tab activates it, so both tabs are visited.
      await userEvent.click(screen.getByRole('button', { name: 'Add tab' }));
      expect(screen.getAllByText('tab detail')).toHaveLength(2);

      // Going back to the first tab keeps the second one mounted.
      await userEvent.click(screen.getAllByRole('tab')[0]);
      expect(screen.getAllByText('tab detail')).toHaveLength(2);
    });

    it('does not mount the detail of a tab that was never active', () => {
      renderWithProviders(<TabLayout />);
      const [a] = tabIds();
      // Add a tab, then switch back before the new one is ever rendered as active.
      act(() => {
        useTabListStore.getState().addTab();
        useTabListStore.getState().setActiveTab(a);
      });
      expect(tabIds()).toHaveLength(2);
      expect(screen.getAllByText('tab detail')).toHaveLength(1);

      act(() => useTabListStore.getState().setActiveTab(tabIds()[1]));
      expect(screen.getAllByText('tab detail')).toHaveLength(2);
    });

    it('drops closed tabs when visiting a new tab without rendering extra details', async () => {
      renderWithProviders(<TabLayout />);
      await userEvent.click(screen.getByRole('button', { name: 'Add tab' }));
      await userEvent.click(screen.getAllByRole('button', { name: 'Close tab' })[0]);
      expect(screen.getAllByText('tab detail')).toHaveLength(1);

      await userEvent.click(screen.getByRole('button', { name: 'Add tab' }));
      expect(tabIds()).toHaveLength(2);
      expect(screen.getAllByText('tab detail')).toHaveLength(2);
    });

    it('mounts nothing when there is no active tab', () => {
      renderWithProviders(<TabLayout />);
      act(() => useTabListStore.getState().setActiveTab(null));
      expect(screen.getAllByText('tab detail')).toHaveLength(1);
    });
  });

  describe('scrolling the active tab into view', () => {
    it('does not scroll when tabs are only reordered', async () => {
      renderWithProviders(<TabLayout />);
      await userEvent.click(screen.getByRole('button', { name: 'Add tab' }));
      const [a, b] = tabIds();
      scrollIntoView().mockClear();

      act(() => useTabListStore.getState().moveTab(a, b));

      expect(tabIds()).toEqual([b, a]);
      expect(scrollIntoView()).not.toHaveBeenCalled();
    });

    it('scrolls when only the active tab changes', async () => {
      renderWithProviders(<TabLayout />);
      await userEvent.click(screen.getByRole('button', { name: 'Add tab' }));
      scrollIntoView().mockClear();

      act(() => useTabListStore.getState().setActiveTab(tabIds()[0]));

      expect(scrollIntoView()).toHaveBeenCalledTimes(1);
    });

    it('scrolls when a tab is added', () => {
      renderWithProviders(<TabLayout />);
      scrollIntoView().mockClear();
      act(() => useTabListStore.getState().addTab());
      expect(scrollIntoView()).toHaveBeenCalled();
    });
  });

  describe('hidden tabs (Activity)', () => {
    const tabState = { currentView: 'bucketList' as const, prefix: '', selectionItem: [], deletingItems: [] };
    const twoTabs = () => useTabListStore.setState({ activeTab: 'a', tabList: { a: tabState, b: tabState } });

    it('does not mount the content of a tab that was never active', () => {
      twoTabs();
      renderWithProviders(<TabLayout />);

      expect(screen.getByTestId('detail-a')).toBeInTheDocument();
      expect(screen.queryByTestId('detail-b')).not.toBeInTheDocument();
      expect(detailRenders.created).toBe(1);
    });

    it('hides the content of the inactive tab instead of unmounting it, and shows it again as the same instance', () => {
      twoTabs();
      renderWithProviders(<TabLayout />);

      act(() => useTabListStore.getState().setActiveTab('b'));
      expect(screen.getByTestId('detail-b')).toBeVisible();
      expect(screen.getByTestId('detail-a')).toBeInTheDocument();
      expect(screen.getByTestId('detail-a')).not.toBeVisible();

      act(() => useTabListStore.getState().setActiveTab('a'));
      expect(screen.getByTestId('detail-a')).toBeVisible();
      expect(screen.getByTestId('detail-b')).not.toBeVisible();
      expect(screen.getByTestId('detail-a')).toHaveAttribute('data-instance', '0');
      expect(detailRenders.created).toBe(2);
    });

    it('unmounts the content when its tab is closed', async () => {
      twoTabs();
      renderWithProviders(<TabLayout />);
      act(() => useTabListStore.getState().setActiveTab('b'));

      await userEvent.click(screen.getAllByRole('button', { name: 'Close tab' })[0]);

      expect(tabIds()).toEqual(['b']);
      expect(screen.queryByTestId('detail-a')).not.toBeInTheDocument();
      expect(screen.getByTestId('detail-b')).toBeVisible();
    });
  });
});
