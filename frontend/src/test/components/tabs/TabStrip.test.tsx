import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import TabStrip from '@/components/tabs/TabStrip';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

const dnd = vi.hoisted(() => ({ props: {} as Record<string, any> }));

vi.mock('motion/react', async () => (await import('@/test/_helpers/mockMotion')).motionMock);
vi.mock('@dnd-kit/core', () => ({
  PointerSensor: class {},
  useSensor: (sensor: unknown, options: unknown) => ({ sensor, options }),
  useSensors: (...sensors: unknown[]) => sensors,
  DndContext: ({ children, ...props }: any) => {
    dnd.props = props;
    return <>{children}</>;
  },
  DragOverlay: ({ children }: any) => <div data-testid="overlay">{children}</div>,
}));
vi.mock('@dnd-kit/sortable', () => ({
  horizontalListSortingStrategy: 'horizontal',
  SortableContext: ({ children }: any) => <>{children}</>,
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}));
vi.mock('@dnd-kit/modifiers', () => ({ restrictToHorizontalAxis: 'h', restrictToFirstScrollableAncestor: 's' }));
vi.mock('@dnd-kit/utilities', () => ({ CSS: { Translate: { toString: () => '' } } }));

type State = {
  activeTab: string;
  tabList: Record<string, unknown>;
  addTab: () => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string | null) => void;
  moveTab: (a: string, b: string) => void;
};
const actions = { addTab: vi.fn(), closeTab: vi.fn(), setActiveTab: vi.fn(), moveTab: vi.fn() };
const useStore = create<State>(() => ({ activeTab: 'a', tabList: { a: {} }, ...actions }));
const setTabs = (ids: string[], activeTab = ids[0]) =>
  act(() => useStore.setState({ activeTab, tabList: Object.fromEntries(ids.map(id => [id, {}])) }));

const renderLabel = (id: string) => <span>{`label-${id}`}</span>;
const renderDetail = vi.fn((id: string, active: boolean) => (
  <div data-testid={`detail-${id}`}>{`${id}:${active}`}</div>
));
const renderStrip = () =>
  renderWithProviders(<TabStrip useTabStore={useStore} renderLabel={renderLabel} renderDetail={renderDetail} />);

const rect = (left: number, width: number) => ({ left, width, right: left + width });
const detect = (collisionRect: unknown, rects: Record<string, unknown>) =>
  dnd.props.collisionDetection({
    active: { id: 'a' },
    collisionRect,
    droppableRects: new Map(Object.entries(rects)),
    droppableContainers: ['a', 'b', 'gone'].map(id => ({ id })),
  });

describe('TabStrip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setTabs(['a']);
  });

  it('renders a label per tab and calls the store actions', async () => {
    setTabs(['a', 'b']);
    renderStrip();
    expect(screen.getAllByText(/^label-/)).toHaveLength(2);

    await userEvent.click(screen.getByRole('button', { name: 'Add tab' }));
    expect(actions.addTab).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getAllByRole('button', { name: 'Close tab' })[1]);
    expect(actions.closeTab).toHaveBeenCalledWith('b');

    await userEvent.click(screen.getAllByRole('tab')[1]);
    expect(actions.setActiveTab).toHaveBeenCalledWith('b');
  });

  it('with a single tab there is no close button', () => {
    renderStrip();
    expect(screen.queryByRole('button', { name: 'Close tab' })).not.toBeInTheDocument();
  });

  it('mounts a tab detail on first activation only, then keeps it with active=false', () => {
    setTabs(['a', 'b']);
    renderStrip();
    expect(screen.getByTestId('detail-a')).toHaveTextContent('a:true');
    expect(screen.queryByTestId('detail-b')).not.toBeInTheDocument();

    setTabs(['a', 'b'], 'b');
    expect(screen.getByTestId('detail-b')).toHaveTextContent('b:true');
    expect(screen.getByTestId('detail-a')).toHaveTextContent('a:false');
  });

  it('drops a closed tab from the visited set so it is not remounted as hidden', () => {
    setTabs(['a', 'b']);
    renderStrip();
    setTabs(['b'], 'b');
    expect(screen.queryByTestId('detail-a')).not.toBeInTheDocument();
    expect(screen.getByTestId('detail-b')).toBeInTheDocument();
  });

  it('shows the drag preview only while dragging and moves the tab on drop', () => {
    setTabs(['a', 'b']);
    renderStrip();
    expect(screen.getByTestId('overlay')).toBeEmptyDOMElement();

    act(() => dnd.props.onDragStart({ active: { id: 'a' } }));
    expect(screen.getByTestId('overlay')).toHaveTextContent('label-a');

    act(() => dnd.props.onDragEnd({ active: { id: 'a' }, over: { id: 'b' } }));
    expect(actions.moveTab).toHaveBeenCalledWith('a', 'b');
    expect(screen.getByTestId('overlay')).toBeEmptyDOMElement();
  });

  it('does not move a tab when dropped outside, and clears the preview on cancel', () => {
    setTabs(['a', 'b']);
    renderStrip();
    act(() => dnd.props.onDragStart({ active: { id: 'a' } }));
    act(() => dnd.props.onDragEnd({ active: { id: 'a' }, over: null }));
    expect(actions.moveTab).not.toHaveBeenCalled();

    act(() => dnd.props.onDragStart({ active: { id: 'a' } }));
    act(() => dnd.props.onDragCancel());
    expect(screen.getByTestId('overlay')).toBeEmptyDOMElement();
  });

  describe('collision detection', () => {
    beforeEach(() => {
      setTabs(['a', 'b']);
      renderStrip();
      act(() => dnd.props.onDragStart({ active: { id: 'a' } }));
    });

    it('picks the slot covered by at least 90% of its width, the most covered if several', () => {
      expect(detect(rect(100, 100), { a: rect(0, 100), b: rect(105, 100) })).toEqual([{ id: 'b' }]);
      expect(detect(rect(100, 100), { a: rect(100, 100), b: rect(105, 100) })).toEqual([{ id: 'a' }]);
    });

    it('keeps the previous slot when none is covered enough or a rect is missing', () => {
      detect(rect(100, 100), { b: rect(105, 100) });
      expect(detect(rect(0, 100), { a: rect(300, 100), b: rect(500, 100) })).toEqual([{ id: 'b' }]);
    });

    it('falls back to the active tab when nothing was ever picked', () => {
      act(() => dnd.props.onDragCancel());
      expect(detect(rect(0, 100), { a: rect(300, 100) })).toEqual([{ id: 'a' }]);
    });
  });
});
