import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SqlNavbar from '@/pages/sql/navbar/SqlNavbar';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

vi.mock('@/pages/sql/navbar/SqlHeaderButtonGroup', () => ({ default: () => <div>header buttons</div> }));
vi.mock('@/pages/sql/navbar/DbProfiles', () => ({ default: () => <div>profile list</div> }));

describe('SqlNavbar', () => {
  it('shows the header buttons above the profile list, separated by a divider', () => {
    renderWithProviders(<SqlNavbar />);

    const header = screen.getByText('header buttons');
    const list = screen.getByText('profile list');
    expect(header.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });
});
