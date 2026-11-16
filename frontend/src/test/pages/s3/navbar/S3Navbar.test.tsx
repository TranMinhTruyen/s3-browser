import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import S3Navbar from '@/pages/s3/navbar/S3Navbar';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

vi.mock('@/pages/s3/navbar/S3HeaderButtonGroup', () => ({
  default: () => <div>header buttons</div>,
}));
vi.mock('@/pages/s3/navbar/ConnectionProfiles', () => ({ default: () => <div>profiles</div> }));

describe('S3Navbar', () => {
  it('renders the header buttons above the connection profiles', () => {
    renderWithProviders(<S3Navbar />);

    const header = screen.getByText('header buttons');
    const profiles = screen.getByText('profiles');
    expect(header.compareDocumentPosition(profiles) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
