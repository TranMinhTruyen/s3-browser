import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import S3TabPage from '@/pages/s3/S3TabPage';
import { useTabListStore } from '@/pages/s3/stores/tabListStore';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

vi.mock('@/pages/s3/components/TabDetail', () => ({ default: () => <div>tab detail</div> }));
vi.mock('@/pages/s3/components/TabLabel', () => ({ default: () => <span>tab label</span> }));
vi.mock('motion/react', async () => (await import('@/test/_helpers/mockMotion')).motionMock);
// A scroller that never attaches the forwarded ref: the scroll-into-view sync must be skipped safely.
vi.mock('@/components/tabs/TabScroller', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe('S3TabPage without a scroller ref', () => {
  beforeEach(() => {
    useTabListStore.getState().reset();
  });

  it('still adds tabs without scrolling anything into view', async () => {
    renderWithProviders(<S3TabPage />);
    vi.mocked(window.HTMLElement.prototype.scrollIntoView).mockClear();

    await userEvent.click(screen.getByRole('button', { name: 'Add tab' }));

    expect(Object.keys(useTabListStore.getState().tabList)).toHaveLength(2);
    expect(window.HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
});
