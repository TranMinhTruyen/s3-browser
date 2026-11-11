import { act, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import S3TabPage from '@/pages/s3/S3TabPage';
import { useTabListStore } from '@/pages/s3/stores/tabListStore';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

// Real dnd-kit here: the screen reader description element is rendered by DndContext itself.
vi.mock('@/pages/s3/components/TabDetail', () => ({ default: () => <div>tab detail</div> }));
vi.mock('@/pages/s3/components/TabLabel', () => ({ default: () => <span>tab label</span> }));
vi.mock('motion/react', async () => (await import('@/test/_helpers/mockMotion')).motionMock);

describe('S3TabPage screen reader instructions', () => {
  beforeEach(() => {
    useTabListStore.getState().reset();
  });

  it('describes draggable tabs with the drag-tab tooltip instead of the dnd-kit default', () => {
    renderWithProviders(<S3TabPage />);

    const description = document.querySelector('[id^="DndDescribedBy-"]');
    expect(description).toBeInTheDocument();
    expect(description).toHaveTextContent('Drag to reorder (Ctrl+Shift+←/→)');
    expect(description).not.toHaveTextContent('To pick up a draggable item');
  });

  it('points the sortable tabs at that description', async () => {
    renderWithProviders(<S3TabPage />);
    act(() => useTabListStore.getState().addTab());

    const tabs = await screen.findAllByRole('tab');
    const id = document.querySelector('[id^="DndDescribedBy-"]')!.id;
    for (const tab of tabs) expect(tab).toHaveAttribute('aria-describedby', id);
  });
});
