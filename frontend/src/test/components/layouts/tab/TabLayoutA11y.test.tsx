import { act, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTabListStore } from '@/common/stores/tabListStore';
import TabLayout from '@/components/layouts/tab/TabLayout';
import { renderWithProviders } from '@/test/renderWithProviders';

// Real dnd-kit here: the screen reader description element is rendered by DndContext itself.
vi.mock('@/components/layouts/tab/components/TabDetail', () => ({ default: () => <div>tab detail</div> }));
vi.mock('@/components/layouts/tab/components/TabLabel', () => ({ default: () => <span>tab label</span> }));
vi.mock('motion/react', async () => (await import('@/test/_helpers/mockMotion')).motionMock);

describe('TabLayout screen reader instructions', () => {
  beforeEach(() => {
    useTabListStore.getState().reset();
  });

  it('describes draggable tabs with the drag-tab tooltip instead of the dnd-kit default', () => {
    renderWithProviders(<TabLayout />);

    const description = document.querySelector('[id^="DndDescribedBy-"]');
    expect(description).toBeInTheDocument();
    expect(description).toHaveTextContent('Drag to reorder (Ctrl+Shift+←/→)');
    expect(description).not.toHaveTextContent('To pick up a draggable item');
  });

  it('points the sortable tabs at that description', async () => {
    renderWithProviders(<TabLayout />);
    act(() => useTabListStore.getState().addTab());

    const tabs = await screen.findAllByRole('tab');
    const id = document.querySelector('[id^="DndDescribedBy-"]')!.id;
    for (const tab of tabs) expect(tab).toHaveAttribute('aria-describedby', id);
  });
});
