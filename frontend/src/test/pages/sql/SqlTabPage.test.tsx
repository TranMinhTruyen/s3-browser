import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { memo, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SqlTabPage from '@/pages/sql/SqlTabPage';
import { useSqlTabStore } from '@/pages/sql/stores/sqlTabStore';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

const detail = vi.hoisted(() => ({ created: 0 }));
const dnd = vi.hoisted(() => ({
  props: {} as Record<string, any>,
  overlayProps: {} as Record<string, any>,
  sortableProps: {} as Record<string, any>,
  sensors: [] as any[],
}));

vi.mock('@/pages/sql/components/SqlTabDetail', () => ({
  default: memo(({ tabId }: { tabId: string }) => {
    const [instance] = useState(() => detail.created++);
    return <div data-testid={`detail-${tabId}`} data-instance={instance} />;
  }),
}));
vi.mock('@/components/tabs/TabDragPreview', () => ({
  default: ({ label, closable }: any) => (
    <div data-testid="preview">
      {label}
      {`:${closable}`}
    </div>
  ),
}));
vi.mock('@/pages/sql/components/SqlTabLabel', () => ({
  default: ({ tabId }: { tabId: string }) => <span>{`label-${tabId}`}</span>,
}));
vi.mock('motion/react', async () => (await import('@/test/_helpers/mockMotion')).motionMock);
vi.mock('@dnd-kit/core', () => {
  class PointerSensor {}
  return {
    PointerSensor,
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

const tabIds = () => Object.keys(useSqlTabStore.getState().tabList);
const active = () => useSqlTabStore.getState().activeTab;
const scrollIntoView = () => vi.mocked(window.HTMLElement.prototype.scrollIntoView);
const add = () => userEvent.click(screen.getByRole('button', { name: 'Add tab' }));

describe('SqlTabPage', () => {
  beforeEach(() => {
    useSqlTabStore.getState().reset();
    detail.created = 0;
  });

  it('adds a tab from the + button and closes it again', async () => {
    renderWithProviders(<SqlTabPage />);
    expect(screen.queryByRole('button', { name: 'Close tab' })).not.toBeInTheDocument();

    await add();
    expect(tabIds()).toHaveLength(2);

    await userEvent.click(screen.getAllByRole('button', { name: 'Close tab' })[0]);
    expect(tabIds()).toHaveLength(1);
  });

  it('closing the active tab hands the selection to the remaining one', async () => {
    renderWithProviders(<SqlTabPage />);
    await add();
    const [first, second] = tabIds();
    expect(active()).toBe(second);

    await userEvent.click(screen.getAllByRole('button', { name: 'Close tab' })[1]);

    expect(tabIds()).toEqual([first]);
    expect(active()).toBe(first);
  });

  it('mounts a tab detail on first activation only, then keeps it mounted when hidden', async () => {
    renderWithProviders(<SqlTabPage />);
    const [first] = tabIds();
    expect(screen.getAllByTestId(/detail-/)).toHaveLength(1);

    await add();
    const second = active();
    expect(screen.getByTestId(`detail-${first}`)).toHaveAttribute('data-instance', '0');
    expect(screen.getByTestId(`detail-${second}`)).toHaveAttribute('data-instance', '1');

    await userEvent.click(screen.getAllByRole('tab')[0]);
    expect(active()).toBe(first);
    expect(screen.getByTestId(`detail-${first}`)).toHaveAttribute('data-instance', '0');
    expect(detail.created).toBe(2);
    expect(screen.getByTestId(`detail-${second}`).parentElement).toHaveStyle({ display: 'none' });
  });

  it('does not mount a tab that was never active', () => {
    renderWithProviders(<SqlTabPage />);
    const [first] = tabIds();
    act(() => {
      useSqlTabStore.setState(s => ({ tabList: { ...s.tabList, extra: { profileId: null } } }));
    });
    expect(screen.queryByTestId('detail-extra')).not.toBeInTheDocument();
    expect(screen.getByTestId(`detail-${first}`)).toBeInTheDocument();
  });

  it('scrolls the active tab into view when tabs change', async () => {
    renderWithProviders(<SqlTabPage />);
    scrollIntoView().mockClear();
    await add();
    expect(scrollIntoView()).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
  });

  describe('single versus multiple tabs', () => {
    it('one tab: not closable, not sortable', () => {
      renderWithProviders(<SqlTabPage />);
      expect(screen.queryByRole('button', { name: 'Close tab' })).not.toBeInTheDocument();
      expect(screen.getByRole('tab')).not.toHaveAttribute('aria-describedby');
    });

    it('several tabs: closable and sortable', async () => {
      renderWithProviders(<SqlTabPage />);
      await add();
      expect(screen.getAllByRole('button', { name: 'Close tab' })).toHaveLength(2);
      for (const tab of screen.getAllByRole('tab')) {
        expect(tab).toHaveAttribute('aria-describedby', 'x');
      }
    });
  });

  describe('drag and drop', () => {
    it('configures items, sensors, modifiers and the screen-reader text', async () => {
      renderWithProviders(<SqlTabPage />);
      await add();
      expect(dnd.sortableProps.items).toEqual(tabIds());
      expect(dnd.sortableProps.strategy).toBe('horizontal');
      expect(dnd.props.accessibility.screenReaderInstructions.draggable).toEqual(expect.any(String));
      expect(dnd.overlayProps.modifiers).toEqual(['h', 's']);
      expect(dnd.overlayProps.dropAnimation).toBeNull();
      expect(dnd.sensors[0].options).toEqual({ activationConstraint: { distance: 5 } });
    });

    it('moves the dragged tab onto the tab it is dropped on, keeping the active tab', async () => {
      renderWithProviders(<SqlTabPage />);
      await add();
      await add();
      const [a, b, c] = tabIds();
      act(() => {
        dnd.props.onDragStart({ active: { id: a } });
        dnd.props.onDragEnd({ active: { id: a }, over: { id: c } });
      });
      expect(tabIds()).toEqual([b, c, a]);
      expect(active()).toBe(c);
    });

    it('does nothing when dropped outside any tab', async () => {
      renderWithProviders(<SqlTabPage />);
      await add();
      const before = tabIds();
      act(() => {
        dnd.props.onDragStart({ active: { id: before[0] } });
        dnd.props.onDragEnd({ active: { id: before[0] }, over: null });
      });
      expect(tabIds()).toEqual(before);
    });

    it('skips scrolling while dragging and resumes after the drag ends', () => {
      renderWithProviders(<SqlTabPage />);
      act(() => dnd.props.onDragStart({ active: { id: tabIds()[0] } }));
      scrollIntoView().mockClear();
      act(() => useSqlTabStore.getState().addTab());
      expect(scrollIntoView()).not.toHaveBeenCalled();

      act(() => dnd.props.onDragEnd({ active: { id: tabIds()[0] }, over: null }));
      act(() => useSqlTabStore.getState().addTab());
      expect(scrollIntoView()).toHaveBeenCalled();
    });

    it('shows the preview only while dragging, with closable for several tabs', async () => {
      renderWithProviders(<SqlTabPage />);
      const [a] = tabIds();
      expect(screen.queryByTestId('preview')).not.toBeInTheDocument();
      act(() => dnd.props.onDragStart({ active: { id: a } }));
      expect(screen.getByTestId('preview')).toHaveTextContent(`label-${a}:false`);
      act(() => dnd.props.onDragCancel());
      expect(screen.queryByTestId('preview')).not.toBeInTheDocument();

      await add();
      act(() => dnd.props.onDragStart({ active: { id: a } }));
      expect(screen.getByTestId('preview')).toHaveTextContent(`label-${a}:true`);
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

      it('picks the slot covered at least 90%, the best ratio, and keeps the previous one otherwise', () => {
        renderWithProviders(<SqlTabPage />);
        act(() => dnd.props.onDragStart({ active: { id: 'a' } }));
        expect(detect({ left: 5, right: 105 }, { a: rect(0), b: rect(100) })).toEqual([{ id: 'a' }]);
        expect(detect({ left: 95, right: 195 }, { a: rect(0), b: rect(100) })).toEqual([{ id: 'b' }]);
        expect(detect({ left: 10, right: 110 }, { a: rect(0), b: rect(10, 100) })).toEqual([{ id: 'b' }]);
        expect(detect({ left: 10, right: 110 }, { b: rect(10, 100), a: rect(0) })).toEqual([{ id: 'b' }]);
        expect(detect({ left: 50, right: 150 }, { a: rect(0), b: rect(100) })).toEqual([{ id: 'b' }]);
      });

      it('falls back to the active id, and forgets the previous over after the drag ends', () => {
        renderWithProviders(<SqlTabPage />);
        expect(detect({ left: 1000, right: 1100 }, { b: rect(100) }, 'z')).toEqual([{ id: 'z' }]);
        act(() => dnd.props.onDragStart({ active: { id: 'a' } }));
        detect({ left: 100, right: 200 }, { b: rect(100) });
        act(() => dnd.props.onDragEnd({ active: { id: 'a' }, over: null }));
        expect(detect({ left: 1000, right: 1100 }, { b: rect(100) }, 'y')).toEqual([{ id: 'y' }]);
      });
    });

    describe('keyboard reorder (Ctrl+Shift+Left/Right)', () => {
      const press = async (tab: HTMLElement, key: 'ArrowLeft' | 'ArrowRight') => {
        await userEvent.click(tab);
        await userEvent.keyboard(`{Control>}{Shift>}{${key}}{/Shift}{/Control}`);
      };

      it('swaps a tab with its neighbour and stops at both ends', async () => {
        renderWithProviders(<SqlTabPage />);
        await add();
        await add();
        const [a, b, c] = tabIds();

        await press(screen.getAllByRole('tab')[1], 'ArrowLeft');
        expect(tabIds()).toEqual([b, a, c]);
        expect(active()).toBe(b);

        await press(screen.getAllByRole('tab')[0], 'ArrowLeft');
        expect(tabIds()).toEqual([b, a, c]);

        await press(screen.getAllByRole('tab')[2], 'ArrowRight');
        expect(tabIds()).toEqual([b, a, c]);

        await press(screen.getAllByRole('tab')[0], 'ArrowRight');
        expect(tabIds()).toEqual([a, b, c]);
      });
    });
  });
});
