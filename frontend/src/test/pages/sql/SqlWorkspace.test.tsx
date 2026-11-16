import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SqlWorkspace from '@/pages/sql/SqlWorkspace';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

vi.mock('@/pages/sql/navbar/SqlNavbar', () => ({ default: () => <div>sql navbar</div> }));
vi.mock('@/pages/sql/SqlTabPage', () => ({ default: () => <div>sql tab page</div> }));

describe('SqlWorkspace', () => {
  it('shows the profile navbar and the tab page side by side', () => {
    renderWithProviders(<SqlWorkspace />);
    expect(screen.getByText('sql navbar')).toBeInTheDocument();
    expect(screen.getByText('sql tab page')).toBeInTheDocument();
  });
});
