import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useTabListStore } from '@/common/stores/tabListStore';
import TabLayout from '@/components/layouts/tab/TabLayout';
import { renderWithProviders } from '@/test/renderWithProviders';

vi.mock('@/components/layouts/tab/components/TabDetail', () => ({ default: () => <div>tab detail</div> }));
vi.mock('@/components/layouts/tab/components/TabLabel', () => ({ default: () => <span>tab label</span> }));
// A scroller without the `.mantine-Scroller-container` element: the scroll sync must be skipped.
vi.mock('@mantine/core', async importOriginal => ({
  ...(await importOriginal<typeof import('@mantine/core')>()),
  Scroller: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe('TabLayout without a scroller container', () => {
  beforeEach(() => {
    useTabListStore.getState().reset();
  });

  it('still adds tabs without scrolling anything into view', async () => {
    renderWithProviders(<TabLayout />);
    vi.mocked(window.HTMLElement.prototype.scrollIntoView).mockClear();

    await userEvent.click(screen.getByRole('button', { name: 'Add tab' }));

    expect(Object.keys(useTabListStore.getState().tabList)).toHaveLength(2);
    expect(window.HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
});
