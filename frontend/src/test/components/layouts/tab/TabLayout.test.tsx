import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { memo } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTabListStore } from '@/common/stores/tabListStore';
import TabLayout from '@/components/layouts/tab/TabLayout';
import { renderWithProviders } from '@/test/renderWithProviders';

const detailRenders = vi.hoisted(() => {
  const state = { count: 0, bump: () => void (state.count += 1) };
  return state;
});
const dnd = vi.hoisted(() => ({
  props: {} as Record<string, any>,
  sortableProps: {} as Record<string, any>,
  sensors: [] as any[],
}));

// Like the real TabDetail, the mock is memoized.
vi.mock('@/components/layouts/tab/components/TabDetail', () => ({
  default: memo(() => {
    detailRenders.bump();
    return <div>tab detail</div>;
  }),
}));
vi.mock('@/components/layouts/tab/components/TabLabel', () => ({ default: () => <span>tab label</span> }));
vi.mock('motion/react', async () => (await import('@/test/_helpers/mockMotion')).motionMock);
vi.mock('@dnd-kit/core', () => {
  class PointerSensor {}
  class KeyboardSensor {}
  return {
    PointerSensor,
    KeyboardSensor,
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
  };
});
vi.mock('@dnd-kit/sortable', () => ({
  horizontalListSortingStrategy: 'horizontal',
  sortableKeyboardCoordinates: () => undefined,
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
vi.mock('@dnd-kit/modifiers', () => ({ restrictToHorizontalAxis: 'h', restrictToParentElement: 'p' }));
vi.mock('@dnd-kit/utilities', () => ({ CSS: { Translate: { toString: () => '' } } }));

const tabIds = () => Object.keys(useTabListStore.getState().tabList);
const scrollIntoView = () => vi.mocked(window.HTMLElement.prototype.scrollIntoView);

describe('TabLayout', () => {
  beforeEach(() => {
    useTabListStore.getState().reset();
    detailRenders.count = 0;
  });

  it('adds a tab from the add button and closes it again', async () => {
    renderWithProviders(<TabLayout />);
    expect(screen.queryByRole('button', { name: 'Close tab' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Add tab' }));
    expect(tabIds()).toHaveLength(2);

    await userEvent.click(screen.getAllByRole('button', { name: 'Close tab' })[0]);
    expect(tabIds()).toHaveLength(1);
  });

  it('scrolls the active tab into view and notifies the scroller when tabs change', async () => {
    renderWithProviders(<TabLayout />);
    const container = document.querySelector('.mantine-Scroller-container')!;
    const onScroll = vi.fn();
    container.addEventListener('scroll', onScroll);
    scrollIntoView().mockClear();

    await userEvent.click(screen.getByRole('button', { name: 'Add tab' }));

    expect(scrollIntoView()).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    expect(onScroll).toHaveBeenCalled();
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

  describe('drag and drop', () => {
    it('configures sortable items, sensors and modifiers', async () => {
      renderWithProviders(<TabLayout />);
      await userEvent.click(screen.getByRole('button', { name: 'Add tab' }));

      expect(dnd.sortableProps.items).toEqual(tabIds());
      expect(dnd.sortableProps.strategy).toBe('horizontal');
      expect(dnd.props.modifiers).toEqual(['h', 'p']);
      expect(dnd.sensors[0].options).toEqual({ activationConstraint: { distance: 5 } });
      expect(dnd.sensors[1].options).toHaveProperty('coordinateGetter');
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

    it('resumes scrolling into view after a cancelled drag', () => {
      renderWithProviders(<TabLayout />);
      act(() => dnd.props.onDragStart({ active: { id: tabIds()[0] } }));
      act(() => dnd.props.onDragCancel());
      scrollIntoView().mockClear();

      act(() => useTabListStore.getState().addTab());

      expect(scrollIntoView()).toHaveBeenCalled();
    });
  });
});
