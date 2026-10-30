import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTabListStore } from '@/common/stores/tabListStore';
import TabLayout from '@/components/layouts/tab/TabLayout';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

vi.mock('@/components/layouts/tab/components/TabDetail', () => ({ default: () => <div>tab detail</div> }));
vi.mock('@/components/layouts/tab/components/TabLabel', () => ({ default: () => <span>tab label</span> }));
vi.mock('motion/react', async () => (await import('@/test/_helpers/mockMotion')).motionMock);
// A scroller that never attaches the forwarded ref: the scroll-into-view sync must be skipped safely.
vi.mock('@/components/layouts/tab/components/TabScroller', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe('TabLayout without a scroller ref', () => {
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
