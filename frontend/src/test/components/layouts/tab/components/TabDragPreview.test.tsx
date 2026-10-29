import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TabDragPreview from '@/components/layouts/tab/components/TabDragPreview';
import { renderWithProviders } from '@/test/renderWithProviders';

vi.mock('@/components/layouts/tab/components/TabLabel', () => ({
  default: ({ tabId }: { tabId: string }) => <span>{`label ${tabId}`}</span>,
}));

describe('TabDragPreview', () => {
  it('renders the tab label for the given tab id without a tab role', () => {
    renderWithProviders(<TabDragPreview tabId="t1" closable={false} />);
    expect(screen.getByText('label t1')).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });

  it('renders a non-interactive close icon when closable', () => {
    const { container } = renderWithProviders(<TabDragPreview tabId="t1" closable />);
    const close = container.querySelector('.mantine-CloseButton-root') as HTMLElement;
    expect(close).toBeInTheDocument();
    expect(close.style.pointerEvents).toBe('none');
  });

  it('renders no close icon when not closable', () => {
    const { container } = renderWithProviders(<TabDragPreview tabId="t1" closable={false} />);
    expect(container.querySelector('.mantine-CloseButton-root')).not.toBeInTheDocument();
  });
});
