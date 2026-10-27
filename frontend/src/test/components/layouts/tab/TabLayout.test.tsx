import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useTabListStore } from '@/common/stores/tabListStore';
import TabLayout from '@/components/layouts/tab/TabLayout';
import { renderWithProviders } from '@/test/renderWithProviders';

vi.mock('@/components/layouts/tab/components/TabDetail', () => ({ default: () => <div>tab detail</div> }));
vi.mock('@/components/layouts/tab/components/TabLabel', () => ({ default: () => <span>tab label</span> }));

describe('TabLayout', () => {
  beforeEach(() => {
    useTabListStore.getState().reset();
  });

  it('adds a tab from the add button and closes it again', async () => {
    renderWithProviders(<TabLayout />);
    expect(screen.queryByRole('button', { name: 'Close tab' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Add tab' }));
    expect(Object.keys(useTabListStore.getState().tabList)).toHaveLength(2);

    await userEvent.click(screen.getAllByRole('button', { name: 'Close tab' })[0]);
    expect(Object.keys(useTabListStore.getState().tabList)).toHaveLength(1);
  });

  it('scrolls the active tab into view and notifies the scroller when tabs change', async () => {
    renderWithProviders(<TabLayout />);
    const container = document.querySelector('.mantine-Scroller-container')!;
    const onScroll = vi.fn();
    container.addEventListener('scroll', onScroll);
    vi.mocked(window.HTMLElement.prototype.scrollIntoView).mockClear();

    await userEvent.click(screen.getByRole('button', { name: 'Add tab' }));

    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    expect(onScroll).toHaveBeenCalled();
  });

  it('shows the detail of every tab and switches the active tab on click', async () => {
    renderWithProviders(<TabLayout />);
    await userEvent.click(screen.getByRole('button', { name: 'Add tab' }));
    const [first] = Object.keys(useTabListStore.getState().tabList);

    await userEvent.click(screen.getAllByRole('tab')[0]);

    expect(useTabListStore.getState().activeTab).toBe(first);
    expect(screen.getAllByText('tab detail')).toHaveLength(2);
  });
});
