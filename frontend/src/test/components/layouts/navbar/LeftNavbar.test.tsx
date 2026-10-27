import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LeftNavbar from '@/components/layouts/navbar/LeftNavbar';
import { renderWithProviders } from '@/test/renderWithProviders';

vi.mock('@/components/layouts/navbar/components/HeaderButtonGroup', () => ({
  default: () => <div>header buttons</div>,
}));
vi.mock('@/components/layouts/navbar/components/ConnectionProfiles', () => ({ default: () => <div>profiles</div> }));

describe('LeftNavbar', () => {
  it('renders the header buttons above the connection profiles', () => {
    renderWithProviders(<LeftNavbar />);

    const header = screen.getByText('header buttons');
    const profiles = screen.getByText('profiles');
    expect(header.compareDocumentPosition(profiles) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
