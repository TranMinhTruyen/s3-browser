import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import TabDragPreview from '@/components/tabs/TabDragPreview';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

describe('TabDragPreview', () => {
  it('renders the tab label for the given tab id without a tab role', () => {
    renderWithProviders(<TabDragPreview label={<span>label t1</span>} closable={false} />);
    expect(screen.getByText('label t1')).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });

  it('renders a non-interactive close icon when closable', () => {
    const { container } = renderWithProviders(<TabDragPreview label={<span>label t1</span>} closable />);
    const close = container.querySelector('.mantine-CloseButton-root') as HTMLElement;
    expect(close).toBeInTheDocument();
    expect(close.style.pointerEvents).toBe('none');
  });

  it('renders no close icon when not closable', () => {
    const { container } = renderWithProviders(<TabDragPreview label={<span>label t1</span>} closable={false} />);
    expect(container.querySelector('.mantine-CloseButton-root')).not.toBeInTheDocument();
  });
});
